import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignerUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const r2  = new S3Client({
    region: 'auto',
    endpoint: `https://{process.env.R2_ACCOUNT_ID}.r2.cloudfarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

export async function uploadPhoto(buffer, mimetype, threadId) {
    // storage_key format : photos/{threadId}/{uuid}.jpg
    // namespacing by threadId keep R2 browsable and makes bulk deletes easy
    const ext = mimetype.split('/')[1];
    const key = `photos/${threadId}/${randomUUID()}.${ext}`;

    // handles large files automatically , single api for all sizes

    const upload = new Upload({
        client: r2,
        params: {
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: mimetype,

        },
    });

    await upload.done();

    const url = `${process.env.R2_PUBLIC_URL}/${key}`;

    return { key, url};
}


export async function getSignedPhotoUrl(storageKey, expiresIn = 3600) {
    const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: storageKey,
    });

    return getSignedUrl(r2, command, { expiresIn })
}

export async function deletePhoto(storageKey){
    await r2.send(new DeleteObjectCommand)({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: storageKey,
    });
}