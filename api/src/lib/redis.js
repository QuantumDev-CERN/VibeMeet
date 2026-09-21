import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

export const TTL = {
    SEARCH_RESULTS:  10 * 60,       // how long a search session lives
    SEARCH_ZIP:      30 * 60,       // extended when zip starts, outlives download
    RATE_LIMIT:      10 * 60,       // sliding window for search rate limit
};

export const SEARCH_RATE_LIMIT = 5;

const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        if (times > 10) {
            return null;
        }
        return Math.min(times * 200, 5000);
    },
    lazyConnect: false,
});

client.on('connect', () => {
    console.log('[Redis] connected');
});

client.on('ready', () => {
    console.log('[Redis] ready');
});

client.on('error', (err) => {
    console.error('[Redis] error:', err.message);
});

client.on('reconnecting', (delay) => {
    console.warn(`[Redis] reconnecting in ${delay}ms`);
});

client.on('close', () => {
    console.warn('[Redis] connection closed');
});

export function isRedisHealthy() {
    return client.status === 'ready';
}

export default client;
