import pool from '../db.js';
import { processPhoto } from './ml.js';

// Replaces the Python poller + RQ worker. The ML service now scales to zero,
// so nothing may poll it on a timer. Indexing is triggered by uploads, with
// retries tracked in the same photos columns the old worker used.
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [15_000, 60_000, 180_000, 300_000];

async function attempt(photoId, threadId, storageKey) {
    try {
        await processPhoto(photoId, threadId, storageKey);
        await pool.query(
            `UPDATE photos
             SET retry_count = 0, last_error = NULL, last_attempted_at = now()
             WHERE id = $1`,
            [photoId]
        );
        return { ok: true, retries: 0 };
    } catch (err) {
        const message = String(err.response?.data?.detail ?? err.message ?? 'unknown error').slice(0, 2000);
        console.error(`[ML] processing failed for photo ${photoId}: ${message}`);
        const { rows } = await pool.query(
            `UPDATE photos
             SET retry_count = retry_count + 1, last_error = $2, last_attempted_at = now()
             WHERE id = $1
             RETURNING retry_count`,
            [photoId, message]
        );
        return { ok: false, retries: rows[0]?.retry_count ?? MAX_RETRIES };
    }
}

// Fire-and-forget. Never throws.
export function queueIndexing(photoId, threadId, storageKey) {
    attempt(photoId, threadId, storageKey)
        .then(({ ok, retries }) => {
            if (ok) return;
            if (retries >= MAX_RETRIES) {
                console.warn(`[ML] photo ${photoId} hit MAX_RETRIES (${MAX_RETRIES}), giving up`);
                return;
            }
            const delay = RETRY_DELAYS_MS[Math.min(retries - 1, RETRY_DELAYS_MS.length - 1)];
            setTimeout(() => queueIndexing(photoId, threadId, storageKey), delay);
        })
        .catch((err) => console.error(`[ML] indexing bookkeeping failed for ${photoId}: ${err.message}`));
}

// Retry timers die if the API restarts or sleeps, so on boot re-queue anything
// that was left unindexed. Runs once per boot, not on a timer.
export async function sweepStuckPhotos() {
    const { rows } = await pool.query(
        `SELECT id, thread_id, storage_key
         FROM photos
         WHERE indexed = false
           AND retry_count < $1
           AND storage_key <> 'pending'
           AND uploaded_at < now() - interval '2 minutes'
         ORDER BY uploaded_at ASC
         LIMIT 20`,
        [MAX_RETRIES]
    );
    rows.forEach((r) => queueIndexing(r.id, r.thread_id, r.storage_key));
    if (rows.length) console.log(`[ML] re-queued ${rows.length} unindexed photo(s) on startup`);
}
