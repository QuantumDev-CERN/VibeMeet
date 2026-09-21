import { Router } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { indexUser } from '../lib/ml.js';
import { getSignedPhotoUrl } from '../lib/storage.js';

const router = Router();

const MIN_SELFIES    = 2;
const MAX_SELFIES    = 5;
const MAX_FILE_SIZE  = 5 * 1024 * 1024;  // 5MB per selfie
const THUMB_TTL      = 5 * 60;           // 5 min — history feed thumbnails
const DEFAULT_PAGE   = 1;
const DEFAULT_LIMIT  = 20;
const MAX_LIMIT      = 100;

const MAGIC_BYTES = {
    'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
    'image/png':  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
};

function detectMime(buffer) {
    for (const [mimetype, { offset, bytes }] of Object.entries(MAGIC_BYTES)) {
        if (buffer.length < offset + bytes.length) continue;
        if (bytes.every((byte, i) => buffer[offset + i] === byte)) return mimetype;
    }
    return null;
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

router.get('/me', authenticate, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, username, email, avatar_url, created_at
             FROM users
             WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        next(err);
    }
});


router.post('/me/face', authenticate, upload.array('selfies', MAX_SELFIES), async (req, res, next) => {
    try {
        const files  = req.files ?? [];
        const userId = req.user.id;

        if (files.length < MIN_SELFIES) {
            return res.status(400).json({
                error: `At least ${MIN_SELFIES} selfies are required for reliable face indexing`,
            });
        }
        const validFiles = [];
        for (const file of files) {
            const mime = detectMime(file.buffer);
            if (!mime) {
                return res.status(400).json({
                    error: 'One or more files are not valid images (invalid magic bytes)',
                });
            }
            validFiles.push({ buffer: file.buffer, mime });
        }

        const existingResult = await pool.query(
            'SELECT id FROM user_face_embeddings WHERE user_id = $1 AND active = true',
            [userId]
        );
        const isUpdate = existingResult.rows.length > 0;

        const buffers   = validFiles.map(f => f.buffer);
        const mimetypes = validFiles.map(f => f.mime);

        const mlResult = await indexUser(userId, buffers, mimetypes);

        res.json({
            message:      isUpdate ? 'Face updated successfully' : 'Face registered successfully',
            selfies_used: mlResult.selfies_used,
            updated:      isUpdate,
        });

    } catch (err) {
        if (err.response?.status === 400) {
            return res.status(422).json({
                error: err.response.data?.detail ?? 'No valid face detected in the selfies provided',
            });
        }
        next(err);
    }
});

router.get('/me/photos', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;

        const page  = Math.max(1, parseInt(req.query.page,  10) || DEFAULT_PAGE);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT)
        );
        const offset = (page - 1) * limit;

        const result = await pool.query(
            `SELECT
                pf.photo_id,
                pf.confidence,
                pf.confirmed,
                pf.bbox,
                pf.matched_at,
                p.thread_id,
                p.uploaded_by,
                p.storage_key_thumb,
                p.face_count,
                p.uploaded_at,
                t.title         AS thread_title,
                t.event_date    AS thread_event_date,
                t.location      AS thread_location,
                c.id            AS community_id,
                c.name          AS community_name,
                c.slug          AS community_slug
             FROM photo_faces pf
             JOIN photos      p  ON p.id  = pf.photo_id
             JOIN threads     t  ON t.id  = p.thread_id
             JOIN communities c  ON c.id  = t.community_id
             WHERE pf.user_id = $1
               AND pf.confirmed IS NOT false
             ORDER BY p.uploaded_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM photo_faces
             WHERE user_id = $1
               AND confirmed IS NOT false`,
            [userId]
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const photos = await mapWithConcurrency(result.rows, 10, async (row) => {
            const thumbnail_url = await getSignedPhotoUrl(row.storage_key_thumb, THUMB_TTL);

            return {
                photo_id:          row.photo_id,
                confidence:        row.confidence,
                confirmed:         row.confirmed,  // null | true
                bbox:              row.bbox,
                matched_at:        row.matched_at,
                uploaded_at:       row.uploaded_at,
                face_count:        row.face_count,
                uploaded_by:       row.uploaded_by,
                thumbnail_url,
                thread: {
                    id:         row.thread_id,
                    title:      row.thread_title,
                    event_date: row.thread_event_date,
                    location:   row.thread_location,
                },
                community: {
                    id:   row.community_id,
                    name: row.community_name,
                    slug: row.community_slug,
                },
            };
        });

        res.json({
            photos,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit),
                has_next:    page * limit < total,
                has_prev:    page > 1,
            },
        });

    } catch (err) {
        next(err);
    }
});

router.patch('/me/photos/:photoId/confirm', authenticate, validateUUID('photoId'), async (req, res, next) => {
    try {
        const { photoId } = req.params;
        const { action }  = req.body;
        const userId      = req.user.id;

        if (!action || !['confirm', 'reject'].includes(action)) {
            return res.status(400).json({
                error: "action must be 'confirm' or 'reject'",
            });
        }

        const confirmed = action === 'confirm'; // true or false

        const result = await pool.query(
            `UPDATE photo_faces
             SET confirmed = $1
             WHERE photo_id = $2 AND user_id = $3
             RETURNING photo_id, user_id, confidence, confirmed, matched_at`,
            [confirmed, photoId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Match not found',
            });
        }

        res.json({ match: result.rows[0] });

    } catch (err) {
        next(err);
    }
});

router.delete('/me/face', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;

        const result = await pool.query(
            `UPDATE user_face_embeddings
             SET active = false
             WHERE user_id = $1 AND active = true
             RETURNING id`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'No active face registration found',
            });
        }

        res.json({ message: 'Face registration removed. You will no longer appear in future searches.' });

    } catch (err) {
        next(err);
    }
});

export default router;
