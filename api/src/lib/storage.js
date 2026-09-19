/**
 * storage.js — provider-agnostic S3-compatible object storage.
 *
 * Replaces the old R2-only lib/r2.js. Anything speaking the S3 API works here:
 * Backblaze B2 (10 GB free, no card), MinIO (self-hosted, no signup),
 * Cloudflare R2, Supabase Storage, AWS S3. Switching providers is an .env
 * change, not a code change.
 *
 * Three things this does that the old r2.js did not:
 *
 * 1. LAZY CLIENT INIT. index.js calls dotenv.config() *after* its import block,
 *    but ES module imports are evaluated before the importing module's body
 *    runs. r2.js built its S3Client at module top-level, so it read
 *    process.env.R2_* before .env had been loaded — the credentials were
 *    undefined unless the vars happened to already be in the shell. Building
 *    the client on first use instead of at import time removes that ordering
 *    trap entirely.
 *
 * 2. CHECKSUM COMPAT. AWS SDK v3 (>= ~3.729) sends x-amz-checksum-* /
 *    x-amz-sdk-checksum-algorithm headers by default. Backblaze B2 and several
 *    other S3-compatible providers reject those with
 *    `400 InvalidArgument: Unsupported header 'x-amz-checksum-crc32'`, and the
 *    x-amz-checksum-mode on GET can surface as SignatureDoesNotMatch. Forcing
 *    both knobs to WHEN_REQUIRED restores pre-3.729 behaviour. This is the
 *    single most common reason "my B2 credentials don't work" — it is not a
 *    credentials problem.
 *
 * 3. PATH-STYLE ADDRESSING by default. MinIO requires it, B2 accepts it, R2
 *    accepts it. Set S3_FORCE_PATH_STYLE=false if a provider needs
 *    virtual-hosted style.
 */

import {
    S3Client,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// ── Config resolution ────────────────────────────────────────────────────────

// Read the first env var that has a non-empty value.
// The R2_* names are accepted as fallbacks so an existing .env keeps working
// through the migration — new deployments should use the S3_* names.
function pick(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (value !== undefined && value !== '') return value;
    }
    return undefined;
}

let cachedConfig = null;
let cachedClient = null;

function resolveConfig() {
    if (cachedConfig) return cachedConfig;

    const bucket = pick('S3_BUCKET', 'R2_BUCKET_NAME');
    const accessKeyId = pick('S3_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
    const secretAccessKey = pick('S3_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
    const region = pick('S3_REGION') ?? 'auto';

    // Explicit endpoint wins. If only the legacy R2_ACCOUNT_ID is present,
    // reconstruct the R2 endpoint from it so nothing breaks mid-migration.
    const legacyR2Account = pick('R2_ACCOUNT_ID');
    const endpoint =
        pick('S3_ENDPOINT') ??
        (legacyR2Account ? `https://${legacyR2Account}.r2.cloudflarestorage.com` : undefined);

    const missing = [];
    if (!bucket) missing.push('S3_BUCKET');
    if (!endpoint) missing.push('S3_ENDPOINT');
    if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID');
    if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
    if (missing.length) {
        throw new Error(
            `Storage is not configured — missing ${missing.join(', ')}. ` +
            `See docs/STORAGE.md for Backblaze B2 and MinIO setup.`
        );
    }

    // Default true: required by MinIO, accepted by B2 and R2.
    const forcePathStyle = pick('S3_FORCE_PATH_STYLE') !== 'false';

    // Durable base URL written into photos.url. It must still resolve days
    // later, because ml/Queue.py re-reads that column when retrying a stuck
    // photo — a signed URL would have expired by then. Derived path-style from
    // the endpoint if not given explicitly.
    const publicBaseUrl = (
        pick('S3_PUBLIC_URL', 'R2_PUBLIC_URL') ?? `${endpoint}/${bucket}`
    ).replace(/\/+$/, '');

    cachedConfig = {
        bucket,
        endpoint,
        region,
        forcePathStyle,
        publicBaseUrl,
        credentials: { accessKeyId, secretAccessKey },
    };
    return cachedConfig;
}

function getClient() {
    if (cachedClient) return cachedClient;
    const config = resolveConfig();

    cachedClient = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials: config.credentials,
        // See note 2 in the file header — this is what makes B2 work with a
        // current AWS SDK. Overridable in case a provider wants full checksums.
        requestChecksumCalculation: pick('S3_REQUEST_CHECKSUM') ?? 'WHEN_REQUIRED',
        responseChecksumValidation: pick('S3_RESPONSE_CHECKSUM') ?? 'WHEN_REQUIRED',
    });
    return cachedClient;
}

// Exported for tests and for the startup health check.
export function getStorageConfig() {
    const { credentials, ...safe } = resolveConfig();
    return safe;
}

// ── Public API — same three functions r2.js exported, same signatures ────────

export async function uploadPhoto(buffer, mimetype, threadId, ext) {
    // storage_key format : photos/{threadId}/{uuid}.{ext}
    // ext passed explicitly from magic byte detection — never derived from mimetype here
    // namespacing by threadId keeps the bucket browsable and makes bulk deletes easy
    const key = `photos/${threadId}/${randomUUID()}.${ext}`;
    const config = resolveConfig();

    // Upload handles large files automatically — single API for all sizes.
    // Default part size is 5 MB, which is also B2's multipart minimum, so
    // buffers under that go out as a plain PutObject.
    const upload = new Upload({
        client: getClient(),
        params: {
            Bucket: config.bucket,
            Key: key,
            Body: buffer,
            ContentType: mimetype,
        },
    });

    await upload.done();

    return { key, url: `${config.publicBaseUrl}/${key}` };
}

export async function getSignedPhotoUrl(storageKey, expiresIn = 3600) {
    const config = resolveConfig();
    const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
    });

    return getSignedUrl(getClient(), command, { expiresIn });
}

export async function deletePhoto(storageKey) {
    const config = resolveConfig();
    await getClient().send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
    }));
}

// ── Streaming ────────────────────────────────────────────────────────────────

/**
 * Fetch an object as a readable stream, rejecting if the stream doesn't start
 * within timeoutMs. Used by the zip endpoint to stream photos into archiver.
 *
 * This lives here rather than in search.js because search.js was constructing a
 * *second* S3Client purely to get at raw streams — two clients reading the same
 * env, guaranteed to drift the moment one of them got a config change.
 */
export async function getObjectStream(storageKey, timeoutMs = 15000) {
    const config = resolveConfig();
    const response = await getClient().send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
    }));

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Storage stream timeout for key: ${storageKey}`));
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

// ── Health check ─────────────────────────────────────────────────────────────

/**
 * Verify credentials and bucket reachability. Called once at API startup so a
 * misconfigured bucket fails loudly on boot instead of silently on the first
 * upload, forty minutes into a demo.
 *
 * Mirrors isRedisHealthy() in lib/redis.js — returns a result, never throws.
 */
export async function isStorageHealthy() {
    try {
        const config = resolveConfig();
        await getClient().send(new HeadBucketCommand({ Bucket: config.bucket }));
        return { healthy: true, bucket: config.bucket, endpoint: config.endpoint };
    } catch (err) {
        return { healthy: false, error: err.message };
    }
}
