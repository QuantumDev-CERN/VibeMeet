import axios from 'axios';
import FormData from 'form-data';

// The ML service scales to zero, so the first call after idle waits for a cold
// start (container boot + model load). Timeouts are generous on purpose.
const PROCESS_PHOTO_TIMEOUT_MS = 200_000; // Azure ingress allows ~240s
const INDEX_USER_TIMEOUT_MS    = 120_000;
const WARMUP_TIMEOUT_MS        = 90_000;

const mlclient = axios.create({
    baseURL: process.env.ML_SERVICE_URL,
});

// Read the key per request so it doesn't depend on dotenv load order.
mlclient.interceptors.request.use((config) => {
    config.headers['X-ML-Key'] = process.env.ML_API_KEY ?? '';
    return config;
});

function isTransient(err) {
    const status = err.response?.status;
    return !err.response || status === 502 || status === 503 || status === 504;
}

async function withOneRetry(fn) {
    try {
        return await fn();
    } catch (err) {
        if (!isTransient(err)) throw err;
        await new Promise((r) => setTimeout(r, 5000));
        return fn();
    }
}

// Fire-and-forget: starts the container so it's warm by the time it's needed.
export function warmUp() {
    mlclient.get('/health', { timeout: WARMUP_TIMEOUT_MS }).catch(() => {});
}

export async function processPhoto(photoID, threadID, storageKey){
    const { data } = await mlclient.post('/process-photo', {
        photo_id: photoID,
        thread_id: threadID,
        storage_key: storageKey,
    }, { timeout: PROCESS_PHOTO_TIMEOUT_MS });
    return data; // { success: true, face_found: N }
}

export async function indexUser(userId, buffers, mimetypes){
    // FormData is single-use, so rebuild it for every attempt.
    const attempt = async () => {
        const form = new FormData();
        form.append('user_id', userId);

        buffers.forEach((buf, i) => {
            form.append('selfies', buf, {
                filename: `selfie_${i}.jpg`,
                contentType: mimetypes[i] ?? 'image/jpeg',
            });
        });

        const { data } = await mlclient.post('/index-user', form, {
            headers: form.getHeaders(), //Sets correct Content-Type
            timeout: INDEX_USER_TIMEOUT_MS,
        });
        return data; // { success: true, selfies_used: N }
    };
    return withOneRetry(attempt);
}