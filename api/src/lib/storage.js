import {
    S3Client,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

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
            `See docs for Backblaze B2 and MinIO setup.`
        );
    }

    // Default true: required by MinIO, accepted by B2 and R2.
    const forcePathStyle = pick('S3_FORCE_PATH_STYLE') !== 'false';

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
        requestChecksumCalculation: pick('S3_REQUEST_CHECKSUM') ?? 'WHEN_REQUIRED',
        responseChecksumValidation: pick('S3_RESPONSE_CHECKSUM') ?? 'WHEN_REQUIRED',
    });
    return cachedClient;
}

export function getStorageConfig() {
    const { credentials, ...safe } = resolveConfig();
    return safe;
}

export async function uploadPhoto(buffer, mimetype, threadId, ext) {
    const key = `photos/${threadId}/${randomUUID()}.${ext}`;
    const config = resolveConfig();
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

export async function isStorageHealthy() {
    try {
        const config = resolveConfig();
        await getClient().send(new HeadBucketCommand({ Bucket: config.bucket }));
        return { healthy: true, bucket: config.bucket, endpoint: config.endpoint };
    } catch (err) {
        return { healthy: false, error: err.message };
    }
}
