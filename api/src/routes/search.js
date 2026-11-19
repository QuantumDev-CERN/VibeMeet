import { Router } from 'express';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { search as mlSearch } from '../lib/ml.js';
import { getSignedPhotoUrl, getObjectStream } from '../lib/storage.js';
import redis, { isRedisHealthy, TTL, SEARCH_RATE_LIMIT } from '../lib/redis.js';

const router = Router();

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

async function checkRateLimit(userId) {
    const key = `ratelimit:search:${userId}`;
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, TTL.RATE_LIMIT);
    }

    if (count > SEARCH_RATE_LIMIT) {
        const ttl = await redis.ttl(key);
        return { allowed: false, retryAfter: ttl };
    }
    return { allowed: true, retryAfter: 0 };
}

router.post('/', authenticate, validateUUID('thread_id', { source: 'body' }), async (req, res, next) => {
    try {
        if (!isRedisHealthy()) {
            return res.status(503).json({ error: 'Search service temporarily unavailable' });
        }
        const { thread_id, threshold } = req.body;
        const userId = req.user.id;
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

        const memberResult = await pool.query(
            `SELECT user_id FROM community_members
             WHERE community_id = $1 AND user_id = $2`,
            [thread.community_id, userId]
        );
        if (memberResult.rows.length === 0) {
            return res.status(403).json({ error: 'You are not a member of this community' });
        }
        const embeddingResult = await pool.query(
            'SELECT id FROM user_face_embeddings WHERE user_id = $1 AND active = true',
            [userId]
        );
        if (embeddingResult.rows.length === 0) {
            return res.status(422).json({
                error: 'Face not registered. Submit selfies at POST /api/users/me/face first',
            });
        }
        const { allowed, retryAfter } = await checkRateLimit(userId);
        if (!allowed) {
            return res.status(429).json({
                error: `Search rate limit exceeded. Try again in ${retryAfter} seconds`,
                retry_after: retryAfter,
            });
        }

        const mlResult = await mlSearch(userId, thread_id, threshold);

        if (mlResult.total === 0) {
            return res.json({
                search_key: null,
                matches: [],
                total: 0,
                thread_id,
            });
        }

        const bestMatchPerPhoto = new Map();
        for (const m of mlResult.matches) {
            const existing = bestMatchPerPhoto.get(m.photo_id);
            if (!existing || m.similarity > existing.similarity) {
                bestMatchPerPhoto.set(m.photo_id, m);
            }
        }

        const photoFacesValues = [...bestMatchPerPhoto.values()].map(m => [
            m.photo_id,
            userId,
            m.similarity,
            JSON.stringify(m.bbox),
        ]);

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

        const dedupedMatches = [...bestMatchPerPhoto.values()];

        // Full photo rows for the matches, so Your Frames renders straight from
        // the search answer instead of the thread's scoped photo list.
        const photoResult = await pool.query(
            `SELECT id, thread_id, uploaded_by, storage_key, storage_key_thumb,
                    indexed, face_count, uploaded_at
             FROM photos WHERE id = ANY($1::uuid[])`,
            [dedupedMatches.map((m) => m.photo_id)]
        );
        const matchedPhotoRows = await mapWithConcurrency(photoResult.rows, 10, async (photo) => {
            const [thumbnail_url, download_url] = await Promise.all([
                getSignedPhotoUrl(photo.storage_key_thumb, 5 * 60), // thumbnails: 5 min
                getSignedPhotoUrl(photo.storage_key, 60 * 60),      // downloads: 1 hour
            ]);
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
        const photoById = Object.fromEntries(matchedPhotoRows.map((p) => [p.id, p]));
        const enrichedMatches = dedupedMatches
            .map((m) => ({ ...m, photo: photoById[m.photo_id] }))
            .filter((m) => m.photo);
        // Lean list for the download session — no signed URLs in Redis.
        const leanMatches = enrichedMatches.map(({ photo, ...rest }) => rest);

        const searchKey = randomUUID();
        const redisPayload = JSON.stringify({
            user_id:   userId,
            thread_id,
            matches:   leanMatches, // [{ photo_id, similarity, bbox }]
        });

        await redis.set(
            `search:${searchKey}`,
            redisPayload,
            'EX',
            TTL.SEARCH_RESULTS
        );

        res.json({
            search_key: searchKey,
            matches:    enrichedMatches,       // [{ photo_id, similarity, bbox, photo }]
            total:      enrichedMatches.length, // distinct photos, not raw face rows
            thread_id,
        });

    } catch (err) {
        if (err.response?.status === 400) {
            return res.status(422).json({
                error: err.response.data?.detail ?? 'Face search failed',
            });
        }
        next(err);
    }
});

router.post('/zip', authenticate, async (req, res, next) => {
    try {
        if (!isRedisHealthy()) {
            return res.status(503).json({ error: 'Search service temporarily unavailable' });
        }

        const { search_key, photo_ids } = req.body;
        const userId = req.user.id;

        if (!search_key) {
            return res.status(400).json({ error: 'search_key is required' });
        }

        const raw = await redis.get(`search:${search_key}`);
        if (!raw) {
            return res.status(410).json({
                error: 'Search session expired. Please run a new search',
            });
        }

        const session = JSON.parse(raw);

        if (session.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await redis.expire(`search:${search_key}`, TTL.SEARCH_ZIP);

        // Optional subset: when photo_ids is a non-empty array, zip only
        // those — each must be part of this search result. Otherwise zip
        // the whole roll, as before.
        const validPhotoIds = new Set(session.matches.map(m => m.photo_id));
        const requestedIds = Array.isArray(photo_ids) && photo_ids.length > 0
            ? [...new Set(photo_ids)]
            : [...validPhotoIds];
        const unauthorised = requestedIds.filter(id => !validPhotoIds.has(id));
        if (unauthorised.length > 0) {
            return res.status(403).json({
                error: 'One or more photo_ids are not part of this search result',
            });
        }

        const uniquePhotoIds = requestedIds;

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

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="vibemeet-photos.zip"');
        res.setHeader('Transfer-Encoding', 'chunked');

        const archive = archiver('zip', { store: true });
        const skipped = []; // { photoId, reason }

        archive.pipe(res);

        for (const photoId of uniquePhotoIds) {
            const photo = photoMap[photoId];

            if (!photo) {
                skipped.push({ photoId, reason: 'Photo no longer exists' });
                continue;
            }

            try {
                const stream = await getObjectStream(photo.storage_key, 15000);
                archive.append(stream, { name: `${photoId}.jpg` });
                await new Promise((resolve, reject) => {
                    stream.once('end', resolve);
                    stream.once('error', reject);
                });
            } catch (err) {
                console.error(`[ZIP] failed to stream photo ${photoId}: ${err.message}`);
                skipped.push({ photoId, reason: err.message });
            }
        }

        if (skipped.length > 0) {
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
                '',
                ...skippedLines,
            ].join('\n');

            archive.append(Buffer.from(skippedContent, 'utf-8'), { name: 'skipped.txt' });
        }

        await archive.finalize();

    } catch (err) {
        if (res.headersSent) {
            console.error(`[ZIP] fatal error mid-stream: ${err.message}`);
            res.destroy(err);
        } else {
            next(err);
        }
    }
});

export default router;
