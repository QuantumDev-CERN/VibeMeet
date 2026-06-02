import { Router } from 'express' ;
import multer from 'multer';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { uploadPhoto, deletePhoto, getSignedPhotoUrl } from '../lib/r2.js';
import { processPhoto } from '../lib/ml.js';


const router = Router();

//Defining Magic bites to validate the image ContentType
const MAGIC_BYTES = {
    'image/jpeg': {
        offset: 0,
        bytes: [0xff, 0xd8, 0xff],

    },
    'image/png': {
        offset: 0,
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    },
    'image/webp': {
        offset: 8,
        bytes: [0x57, 0x45, 0x42, 0x50],
    },
};

const ALLOWED_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

//Constraints
const MAX_FILE_SIZE = 10*1024*1024;
const FREE_TIER_LIMIT = 30;
const SIGNED_URL_TTL = 3600;
const SIGNED_URL_CONCURRENCY = 10;


//Validate magic bytes against binary of buffer
function validateMagicBytes(buffer) {
    for (const [mimetype, { offset, bytes }] of Object.entries(MAGIC_BYTES)) {
        if (buffer.length < offset + bytes.length) continue;
        const match = bytes.every((byte, i) => buffer[offset + i] === byte);
        if(match) return mimetype;
    }
    const err = new Error('File is not a valid image (invalid magic bytes)');
    err.status = 400;
    throw err;

}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE},
});

//Controlled concurrency helper
//Runs async tasks over an array with at most 'limit' running in parallel

async function mapWithConcurrency(items, limit, asyncFn){
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


// POST /api/photos

router.post('/', authenticate, upload.single('file'), async (req, res, next) => {
    let storageKey = null; //track for R2 cleanup if anything after upload fails
    let photoId = null;

    try {
        const { thread_id } = req.body;
        const userId = req.user.id;


        if(!thread_id) return res.status(400).json({ error: 'thread_id is required'});
        if(!req.file) return res.status(400).json({ error: 'file is required'});


        const detectMime = validateMagicBytes(req.file.buffer);
        const ext = ALLOWED_EXTENSIONS[detectMime];




        //verify existence of thread_id
        const threadResult = await pool.query(
            'SELECT id FROM threads WHERE id = $1',
            [thread_id]
        );
        if (threadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Thread not found'});
        }

        //Advisory lock - serializes upload per user

        const client = await pool.connect();
        try{
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
                [userId]
            );

            //User locked now safe to check and insert
            const insertResult = await client.query(
                `INSERT INTO photos (thread_id, uploaded_by, storage_key, url)
                SELECT $1, $2, 'pending', 'pending'
                WHERE (
                SELECT COUNT(*) FROM photos WHERE uploaded_by = $2) < $3 
                RETURNING id`,
                [thread_id, userId, FREE_TIER_LIMIT]
            );


            await client.query('COMMIT');

            if (insertResult.rows.length === 0) {
                return res.status(403).json({ error: `Free tier limit reached (${FREE_TIER_LIMIT} photos)` });
            }

            photoId = insertResult.rows[0].id;
        } catch ( err ) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        //Upload to R2
        let key, url;
        try{
            ({ key, url } = await uploadPhoto(req.file.buffer, detectMime, thread_id, ext));
            storageKey = key;
        } catch (r2Err) {
            //R2 failed
            await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
            throw r2Err;
        }

        //Update placeholder row with real storage_key and url

        const finalResult = await pool.query(
            `UPDATE photos SET storage_key =$1, url = $2
            WHERE id = $3
            RETURNING id, thread_id, uploaded_by, indexed, face_count, uploaded_at`,
            [key, url, photoId]
        );

        const photo = finalResult.rows[0];

        // Trigger ML 
        processPhoto(photo.id, thread_id, url).catch((err) => {
            console.error(`[ML] processing failed for photo ${photo.id}: ${err.message}`);
        });


        res.status(201).json({ photo });
    } catch ( err ) {
        // R2 upload succeeded but something after it failed — clean up orphaned file
        if (storageKey) {
            deletePhoto(storageKey).catch((e) => {
                console.error(`[R2] cleanup failed for key ${storageKey}: ${e.message}`);
            });
        }
        next(err);
    }
});

// GET /api/photos/thread/:threadId

router.get('/thread/:threadId', async (req, res, next) => {
    try {
        const { threadId } = req.params;

        const result = await pool.query(
            `SELECT id, thread_id, uploaded_by, indexed, face_count, uploaded_at
            FROM photos WHERE thread_id = $1 ORDER BY uploaded_at DESC`,
            [threadId]
        );

        const photos = await mapWithConcurrency(result.rows, SIGNED_URL_CONCURRENCY, async (photo) => {
            const thumbnail_url = photo.url;
            const download_url = await getSignedPhotoUrl(photo.storage_key, SIGNED_URL_TTL);
            return {
                id: photo.id,
                thread_id: photo.thread_id,
                uploaded_by: photo.uploaded_by,
                indexed: photo.indexed,
                face_count: photo.face_count,
                uploaded_at: photo.uploaded_at,
                thumbnail_url,
                download_url,
            };
        });

        res.json({ photos });
    } catch (err) {
        next(err);
    }
});

export default router;
