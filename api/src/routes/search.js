import { Router } from 'express';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { search as mlSearch } from '../lib/ml.js';
import { getSignedPhotoUrl } from '../lib/r2.js';
import redis, { isRedisHealthy, TTL, SEARCH_RATE_LIMIT } from '../lib/redis.js';

// We need the raw S3 client to stream objects — r2.js doesn't export it.
// Import separately so r2.js stays focused on its own responsibilities.
import { S3Client } from '@aws-sdk/client-s3';

const r2Stream = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const router = Router();

// Controlled concurrency — same pattern as photos.js
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

// UUID v4 format validation — catches bad input before Postgres throws
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
    return UUID_REGEX.test(str);
}

// Redis rate limit using atomic INCR pattern.
// Returns { allowed: bool, retryAfter: seconds }
// INCR is atomic — no race condition between check and increment.
async function checkRateLimit(userId) {
    const key = `ratelimit:search:${userId}`;
    const count = await redis.incr(key);

    if (count === 1) {
        // First request in this window — set expiry
        await redis.expire(key, TTL.RATE_LIMIT);
    }

    if (count > SEARCH_RATE_LIMIT) {
        // Get remaining TTL so we can tell the client when to retry
        const ttl = await redis.ttl(key);
        return { allowed: false, retryAfter: ttl };
    }

    return { allowed: true, retryAfter: 0 };
}

// Fetch an object from R2 as a readable stream with a timeout.
// If the stream doesn't start within timeoutMs, rejects with a timeout error.
// Used by the zip endpoint to stream photos directly into archiver.
async function getR2Stream(storageKey, timeoutMs = 15000) {
    const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: storageKey,
    });

    const response = await r2Stream.send(command);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`R2 stream timeout for key: ${storageKey}`));
        }, timeoutMs);

        response.Body.once('readable', () => {
            clearTimeout(timeout);
            resolve(response.Body);
        });

        response.Body.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/search
// Runs ML face search for the authenticated user in a thread.
// Stores results in Redis (ephemeral) and photo_faces (permanent).
// Returns metadata only — no URLs generated here.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
    try {
        if (!isRedisHealthy()) {
            return res.status(503).json({ error: 'Search service temporarily unavailable' });
        }

        const { thread_id, threshold } = req.body;
        const userId = req.user.id;

        // ── Input validation ──────────────────────────────────────────────────
        if (!thread_id) {
            return res.status(400).json({ error: 'thread_id is required' });
        }
        if (!isValidUUID(thread_id)) {
            return res.status(400).json({ error: 'thread_id must be a valid UUID' });
        }

        // ── Thread existence check ────────────────────────────────────────────
        // Also fetches community_id for the membership check below.
        // One query instead of two — join gives us both in one round-trip.
        const threadResult = await pool.query(
            `SELECT t.id, t.community_id, t.title
             FROM threads t
             WHERE t.id = $1`,
            [thread_id]
        );
        if (threadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        const thread = threadResult.rows[0];

        // ── Community membership check ────────────────────────────────────────
        // User must be a member of the community that owns this thread.
        // Non-members cannot run face searches — ML inference is expensive
        // and this event's photos are private to its community.
        const memberResult = await pool.query(
            `SELECT user_id FROM community_members
             WHERE community_id = $1 AND user_id = $2`,
            [thread.community_id, userId]
        );
        if (memberResult.rows.length === 0) {
            return res.status(403).json({ error: 'You are not a member of this community' });
        }

        // ── User embedding check ──────────────────────────────────────────────
        // Check before hitting ML — saves a network round-trip and gives a
        // cleaner error message than letting ML raise a ValueError.
        const embeddingResult = await pool.query(
            'SELECT id FROM user_face_embeddings WHERE user_id = $1',
            [userId]
        );
        if (embeddingResult.rows.length === 0) {
            return res.status(422).json({
                error: 'Face not registered. Submit selfies at POST /api/users/me/face first',
            });
        }

        // ── Rate limit check ──────────────────────────────────────────────────
        // 5 searches per 10 minutes per user, Redis-backed.
        // Checked after all cheap DB validations — don't burn rate limit tokens
        // on requests that would have failed anyway.
        const { allowed, retryAfter } = await checkRateLimit(userId);
        if (!allowed) {
            return res.status(429).json({
                error: `Search rate limit exceeded. Try again in ${retryAfter} seconds`,
                retry_after: retryAfter,
            });
        }

        // ── ML search ─────────────────────────────────────────────────────────
        // threshold defaults to 0.45 in ML if not provided.
        // limit: 100 — cap results to prevent unbounded response at scale.
        const mlResult = await mlSearch(userId, thread_id, threshold);

        // ── Early return — zero matches ───────────────────────────────────────
        if (mlResult.total === 0) {
            return res.json({
                search_key: null,
                matches: [],
                total: 0,
                thread_id,
            });
        }

        // ── Persist to photo_faces (durable) ─────────────────────────────────
        // Write to DB first — if Redis write fails after this, the user's
        // profile still shows the photos. Better failure mode than the reverse.
        // ON CONFLICT: re-searching the same thread updates confidence and bbox.
        const photoFacesValues = mlResult.matches.map(m => [
            m.photo_id,
            userId,
            m.similarity,
            JSON.stringify(m.bbox),
        ]);

        // Build parameterised bulk upsert — one query regardless of match count
        const placeholders = photoFacesValues.map((_, i) => {
            const base = i * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`;
        }).join(', ');

        const flatValues = photoFacesValues.flat();

        await pool.query(
            `INSERT INTO photo_faces (photo_id, user_id, confidence, bbox)
             VALUES ${placeholders}
             ON CONFLICT (photo_id, user_id)
             DO UPDATE SET
                 confidence = EXCLUDED.confidence,
                 bbox       = EXCLUDED.bbox,
                 matched_at = now()`,
            flatValues
        );

        // ── Store in Redis (ephemeral) ────────────────────────────────────────
        // Opaque UUID key — client cannot guess other users' search results.
        // Stores photo_id, similarity, bbox per match.
        // storage_key is NOT stored in Redis — fetched fresh from DB at download time.
        const searchKey = randomUUID();
        const redisPayload = JSON.stringify({
            user_id:   userId,
            thread_id,
            matches:   mlResult.matches, // [{ photo_id, similarity, bbox }]
        });

        await redis.set(
            `search:${searchKey}`,
            redisPayload,
            'EX',
            TTL.SEARCH_RESULTS
        );

        // ── Response — metadata only, no URLs ────────────────────────────────
        res.json({
            search_key: searchKey,
            matches:    mlResult.matches,  // [{ photo_id, similarity, bbox }]
            total:      mlResult.total,
            thread_id,
        });

    } catch (err) {
        // ML returns HTTP 400 when user has no embedding — shouldn't reach here
        // because we check above, but defensive fallback.
        if (err.response?.status === 400) {
            return res.status(422).json({
                error: err.response.data?.detail ?? 'Face search failed',
            });
        }
        next(err);
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/search/download
// Selective signed URL generation — client picks exactly which photos to download.
// Verifies requested photo_ids against Redis search results for security.
// Only generates signed URLs for explicitly requested photos.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/download', authenticate, async (req, res, next) => {
    try {
        if (!isRedisHealthy()) {
            return res.status(503).json({ error: 'Download service temporarily unavailable' });
        }

        const { search_key, photo_ids } = req.body;
        const userId = req.user.id;

        if (!search_key) {
            return res.status(400).json({ error: 'search_key is required' });
        }
        if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
            return res.status(400).json({ error: 'photo_ids must be a non-empty array' });
        }

        // ── Read search results from Redis ────────────────────────────────────
        const raw = await redis.get(`search:${search_key}`);
        if (!raw) {
            return res.status(410).json({
                error: 'Search session expired. Please run a new search',
            });
        }

        const session = JSON.parse(raw);

        // ── Ownership check — user owns this search session ───────────────────
        if (session.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // ── Verify every requested photo_id is in this search result ──────────
        // Client cannot request photos that weren't returned by their own search.
        const validPhotoIds = new Set(session.matches.map(m => m.photo_id));
        const unauthorised = photo_ids.filter(id => !validPhotoIds.has(id));
        if (unauthorised.length > 0) {
            return res.status(403).json({
                error: 'One or more photo_ids are not part of this search result',
            });
        }

        // ── Fetch storage_keys from DB ────────────────────────────────────────
        // Scoped to both the requested photo_ids AND thread_id — double safety.
        // storage_key fetched here, used for signing, never returned to client.
        const photoResult = await pool.query(
            `SELECT id, storage_key
             FROM photos
             WHERE id = ANY($1::uuid[])
             AND thread_id = $2`,
            [photo_ids, session.thread_id]
        );

        const photoMap = Object.fromEntries(photoResult.rows.map(p => [p.id, p]));

        // ── Generate signed download URLs with controlled concurrency ──────────
        const downloads = await mapWithConcurrency(photo_ids, 10, async (photoId) => {
            const photo = photoMap[photoId];
            if (!photo) return null; // photo deleted between search and download

            const download_url = await getSignedPhotoUrl(photo.storage_key, 60 * 60); // 1 hour
            return { photo_id: photoId, download_url };
        });

        res.json({ downloads: downloads.filter(Boolean) });

    } catch (err) {
        next(err);
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/search/zip
// Streams all matched photos as a zip directly to the client.
// No intermediate R2 storage — archiver pipes R2 reads straight to HTTP response.
// Skipped photos (R2 timeout/failure) are listed in skipped.txt with recovery URLs.
// Connection stays open until the last byte is sent.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/zip', authenticate, async (req, res, next) => {
    try {
        if (!isRedisHealthy()) {
            return res.status(503).json({ error: 'Download service temporarily unavailable' });
        }

        const { search_key } = req.body;
        const userId = req.user.id;

        if (!search_key) {
            return res.status(400).json({ error: 'search_key is required' });
        }

        // ── Read search results from Redis ────────────────────────────────────
        const raw = await redis.get(`search:${search_key}`);
        if (!raw) {
            return res.status(410).json({
                error: 'Search session expired. Please run a new search',
            });
        }

        const session = JSON.parse(raw);

        // ── Ownership check ───────────────────────────────────────────────────
        if (session.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // ── Extend Redis TTL before starting the download ─────────────────────
        // Zip can take time — extend to 30 min so the session outlives the download.
        await redis.expire(`search:${search_key}`, TTL.SEARCH_ZIP);

        // ── Fetch photo rows for all matched photo_ids ────────────────────────
        // Deduplicate photo_ids — ML returns one row per face, not per photo.
        const uniquePhotoIds = [...new Set(session.matches.map(m => m.photo_id))];

        const photoResult = await pool.query(
            `SELECT id, storage_key, thread_id, uploaded_at
             FROM photos
             WHERE id = ANY($1::uuid[])
             AND thread_id = $2`,
            [uniquePhotoIds, session.thread_id]
        );

        if (photoResult.rows.length === 0) {
            return res.status(404).json({ error: 'No photos found for this search result' });
        }

        const photoMap = Object.fromEntries(photoResult.rows.map(p => [p.id, p]));

        // ── Set response headers before streaming begins ──────────────────────
        // Must be set before any data is written to the response.
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="vibemeet-photos.zip"');
        res.setHeader('Transfer-Encoding', 'chunked');

        // ── Set up archiver in store mode ─────────────────────────────────────
        // Store mode = no compression on zip entries.
        // JPEGs are already compressed — deflating them wastes CPU for near-zero gain.
        const archive = archiver('zip', { store: true });
        const skipped = []; // { photoId, reason }

        // Pipe archiver output directly to HTTP response stream
        archive.pipe(res);

        // ── Stream each photo from R2 into the archive ────────────────────────
        // Sequential — not parallel — to keep memory flat.
        // Parallel streaming would buffer multiple photos simultaneously.
        for (const photoId of uniquePhotoIds) {
            const photo = photoMap[photoId];

            if (!photo) {
                // Photo was deleted between search and zip
                skipped.push({ photoId, reason: 'Photo no longer exists' });
                continue;
            }

            try {
                const stream = await getR2Stream(photo.storage_key, 15000);
                // Filename in zip: {photoId}.jpg — unique, no collisions
                archive.append(stream, { name: `${photoId}.jpg` });
                // Wait for this entry to finish before fetching the next
                // This keeps memory flat — one photo in flight at a time
                await new Promise((resolve, reject) => {
                    stream.once('end', resolve);
                    stream.once('error', reject);
                });
            } catch (err) {
                console.error(`[ZIP] failed to stream photo ${photoId}: ${err.message}`);
                skipped.push({ photoId, reason: err.message });
            }
        }

        // ── Add skipped.txt if any photos failed ──────────────────────────────
        if (skipped.length > 0) {
            // Generate recovery URLs for skipped photos — 1 hour signed URLs
            // pointing to the recovery endpoint on photos.js
            const recoveryBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

            const skippedLines = await Promise.all(
                skipped.map(async ({ photoId, reason }) => {
                    const photo = photoMap[photoId];
                    const threadTitle = photo
                        ? `Thread ID: ${photo.thread_id}`
                        : 'Thread: unknown';

                    return [
                        `Photo ID: ${photoId}`,
                        threadTitle,
                        `Reason skipped: ${reason}`,
                        `Recovery URL: ${recoveryBaseUrl}/api/photos/${photoId}/download`,
                        `Note: You must be logged in to use the recovery URL.`,
                        '─'.repeat(60),
                    ].join('\n');
                })
            );

            const skippedContent = [
                'SKIPPED PHOTOS',
                '==============',
                `${skipped.length} photo(s) could not be included in this download.`,
                'Use the recovery URLs below to download them individually.',
                'Recovery URLs require authentication — open them in the app.',
                '',
                ...skippedLines,
            ].join('\n');

            archive.append(Buffer.from(skippedContent, 'utf-8'), { name: 'skipped.txt' });
        }

        // ── Finalise archive — flushes and closes the response stream ──────────
        await archive.finalize();

    } catch (err) {
        // Headers may already be sent if streaming started — can't send a JSON error.
        // Log it and destroy the response so the client sees a broken download
        // rather than a silent hang.
        if (res.headersSent) {
            console.error(`[ZIP] fatal error mid-stream: ${err.message}`);
            res.destroy(err);
        } else {
            next(err);
        }
    }
});

export default router;
