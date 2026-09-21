import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { uploadPhoto, deletePhoto, getSignedPhotoUrl } from '../lib/storage.js';
import { processPhoto } from '../lib/ml.js';

const router = Router();

// Magic bytes — detect real file type from binary, never trust Content-Type header
const MAGIC_BYTES = {
    'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
    'image/png':  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
};

const MAX_FILE_SIZE         = 10 * 1024 * 1024; // 10MB — raw upload before processing
const FREE_TIER_LIMIT       = 30;
const SIGNED_URL_CONCURRENCY = 10;

const THUMB_SIGNED_TTL    = 5 * 60;    // 5 min — thumbnails are for UI preview only
const DOWNLOAD_SIGNED_TTL = 60 * 60;   // 1 hour — actual file downloads

const DOWNLOAD_WIDTH   = 2560;
const DOWNLOAD_QUALITY = 88;

const THUMB_WIDTH   = 400;
const THUMB_QUALITY = 70;

function validateMagicBytes(buffer) {
    for (const [mimetype, { offset, bytes }] of Object.entries(MAGIC_BYTES)) {
        if (buffer.length < offset + bytes.length) continue;
        if (bytes.every((byte, i) => buffer[offset + i] === byte)) return mimetype;
    }
    const err = new Error('File is not a valid image (invalid magic bytes)');
    err.status = 400;
    throw err;
}

async function processImageVariants(buffer) {
    const [downloadBuffer, thumbBuffer] = await Promise.all([
        sharp(buffer)
            .resize(DOWNLOAD_WIDTH, null, {
                fit: 'inside',          // preserve aspect ratio, never upscale
                withoutEnlargement: true,
            })
            .jpeg({ quality: DOWNLOAD_QUALITY, mozjpeg: true })
            .withMetadata({ exif: {} }) // strip all EXIF including GPS
            .toBuffer(),

        sharp(buffer)
            .resize(THUMB_WIDTH, null, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
            .withMetadata({ exif: {} })
            .toBuffer(),
    ]);

    return { downloadBuffer, thumbBuffer };
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
});

async function mapWithConcurrency(items, limit, asyncFn) {
    const results = [];
    let index = 0;

    async function runWorker() {
        while (index < items.length) {
            const current = index++;
            results[current] = await asyncFn(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
    await Promise.all(workers);
    return results;
}


router.post('/', authenticate, upload.single('file'), async (req, res, next) => {
    let storageKeyDownload = null;
    let storageKeyThumb    = null;
    let photoId            = null;

    try {
        const { thread_id } = req.body;
        const userId = req.user.id;

        if (!thread_id) return res.status(400).json({ error: 'thread_id is required' });
        if (!req.file)  return res.status(400).json({ error: 'file is required' });

        const detectedMime = validateMagicBytes(req.file.buffer);

        const threadResult = await pool.query(
            'SELECT id FROM threads WHERE id = $1',
            [thread_id]
        );
        if (threadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
                [userId]
            );

            const insertResult = await client.query(
                `INSERT INTO photos (thread_id, uploaded_by, storage_key, url, storage_key_thumb, url_thumb)
                 SELECT $1, $2, 'pending', 'pending', 'pending', 'pending'
                 WHERE (
                     SELECT COUNT(*) FROM photos WHERE uploaded_by = $2
                 ) < $3
                 RETURNING id`,
                [thread_id, userId, FREE_TIER_LIMIT]
            );

            await client.query('COMMIT');

            if (insertResult.rows.length === 0) {
                return res.status(403).json({ error: `Free tier limit reached (${FREE_TIER_LIMIT} photos)` });
            }

            photoId = insertResult.rows[0].id;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        let downloadBuffer, thumbBuffer;
        try {
            ({ downloadBuffer, thumbBuffer } = await processImageVariants(req.file.buffer));
        } catch (sharpErr) {
            await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
            photoId = null;
            throw sharpErr;
        }

        let downloadResult, thumbResult;
        try {
            ([downloadResult, thumbResult] = await Promise.all([
                uploadPhoto(downloadBuffer, 'image/jpeg', thread_id, 'download.jpg'),
                uploadPhoto(thumbBuffer,    'image/jpeg', thread_id, 'thumb.jpg'),
            ]));
            storageKeyDownload = downloadResult.key;
            storageKeyThumb    = thumbResult.key;
        } catch (r2Err) {
            await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
            photoId = null;
            throw r2Err;
        }
        const finalResult = await pool.query(
            `UPDATE photos
             SET storage_key = $1, url = $2, storage_key_thumb = $3, url_thumb = $4
             WHERE id = $5
             RETURNING id, thread_id, uploaded_by, indexed, face_count, uploaded_at`,
            [downloadResult.key, downloadResult.url, thumbResult.key, thumbResult.url, photoId]
        );

        const photo = finalResult.rows[0];
        processPhoto(photo.id, thread_id, downloadResult.url).catch((err) => {
            console.error(`[ML] processing failed for photo ${photo.id}: ${err.message}`);
        });
        res.status(201).json({ photo });

    } catch (err) {
        const cleanup = [];
        if (storageKeyDownload) cleanup.push(
            deletePhoto(storageKeyDownload).catch(e =>
                console.error(`[R2] cleanup failed for key ${storageKeyDownload}: ${e.message}`)
            )
        );
        if (storageKeyThumb) cleanup.push(
            deletePhoto(storageKeyThumb).catch(e =>
                console.error(`[R2] cleanup failed for key ${storageKeyThumb}: ${e.message}`)
            )
        );
        if (cleanup.length) await Promise.all(cleanup);
        next(err);
    }
});

router.get('/thread/:threadId', authenticate, validateUUID('threadId'), async (req, res, next) => {
    try {
        const { threadId } = req.params;
        const userId = req.user.id;

        const threadResult = await pool.query(
            `SELECT id, community_id FROM threads WHERE id = $1`,
            [threadId]
        );
        if (threadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        const thread = threadResult.rows[0];

        const memberResult = await pool.query(
            `SELECT user_id FROM community_members
             WHERE community_id = $1 AND user_id = $2`,
            [thread.community_id, userId]
        );
        if (memberResult.rows.length === 0) {
            return res.status(403).json({ error: 'You are not a member of this community' });
        }

        const result = await pool.query(
            `SELECT id, thread_id, uploaded_by, storage_key, storage_key_thumb,
                    indexed, face_count, uploaded_at
             FROM photos
             WHERE thread_id = $1
             ORDER BY uploaded_at DESC`,
            [threadId]
        );

        const photos = await mapWithConcurrency(result.rows, SIGNED_URL_CONCURRENCY, async (photo) => {
            const [thumbnail_url, download_url] = await Promise.all([
                getSignedPhotoUrl(photo.storage_key_thumb, THUMB_SIGNED_TTL),
                getSignedPhotoUrl(photo.storage_key,       DOWNLOAD_SIGNED_TTL),
            ]);

            return {
                id:           photo.id,
                thread_id:    photo.thread_id,
                uploaded_by:  photo.uploaded_by,
                indexed:      photo.indexed,
                face_count:   photo.face_count,
                uploaded_at:  photo.uploaded_at,
                thumbnail_url,
                download_url,
            };
        });

        res.json({ photos });
    } catch (err) {
        next(err);
    }
});

router.get('/:photoId/download', authenticate, validateUUID('photoId'), async (req, res, next) => {
    try {
        const { photoId } = req.params;
        const userId = req.user.id;

        const photoResult = await pool.query(
            'SELECT id, storage_key FROM photos WHERE id = $1',
            [photoId]
        );
        if (photoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const faceResult = await pool.query(
            'SELECT photo_id FROM photo_faces WHERE photo_id = $1 AND user_id = $2',
            [photoId, userId]
        );
        if (faceResult.rows.length === 0) {
            return res.status(403).json({ error: 'You do not appear in this photo' });
        }

        const download_url = await getSignedPhotoUrl(
            photoResult.rows[0].storage_key,
            DOWNLOAD_SIGNED_TTL
        );

        res.json({ download_url });
    } catch (err) {
        next(err);
    }
});

export default router;
