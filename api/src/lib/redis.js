import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

// TTLs in seconds — single source of truth, referenced in search.js
export const TTL = {
    SEARCH_RESULTS:  10 * 60,       // 10 min — how long a search session lives
    SEARCH_ZIP:      30 * 60,       // 30 min — extended when zip starts, outlives download
    RATE_LIMIT:      10 * 60,       // 10 min — sliding window for search rate limit
};

// Max searches per user within the RATE_LIMIT window
export const SEARCH_RATE_LIMIT = 5;

const client = new Redis(process.env.REDIS_URL, {
    // ioredis retries forever by default — cap it so we surface the error fast
    // on startup if Redis genuinely isn't running
    maxRetriesPerRequest: 3,

    // Reconnect strategy — exponential backoff capped at 5 seconds.
    // This covers transient Redis restarts without hammering the server.
    retryStrategy(times) {
        if (times > 10) {
            // After 10 consecutive failures stop retrying and surface the error.
            // The API stays up — Redis being down degrades search/download
            // but auth, upload, and community features still work.
            return null;
        }
        return Math.min(times * 200, 5000);
    },

    // ioredis emits an error event on connection failure — without a listener
    // Node throws an unhandled error and crashes the process.
    // We handle it here so the API degrades gracefully instead of crashing.
    lazyConnect: false,
});

client.on('connect', () => {
    console.log('[Redis] connected');
});

client.on('ready', () => {
    console.log('[Redis] ready');
});

client.on('error', (err) => {
    // Log but do not crash — callers check isRedisHealthy() before using client
    console.error('[Redis] error:', err.message);
});

client.on('reconnecting', (delay) => {
    console.warn(`[Redis] reconnecting in ${delay}ms`);
});

client.on('close', () => {
    console.warn('[Redis] connection closed');
});

// Callers use this guard before any Redis operation so a Redis outage
// returns a clean 503 instead of a cryptic ioredis timeout error
export function isRedisHealthy() {
    return client.status === 'ready';
}

export default client;
