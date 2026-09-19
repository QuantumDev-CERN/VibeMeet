/**
 * verify-storage.js — end-to-end check of the object storage setup.
 *
 *   cd api && node scripts/verify-storage.js
 *
 * Exercises every operation the app actually performs, in order, against your
 * real bucket: bucket reachable → upload → signed GET → public GET → stream →
 * delete. Prints the specific fix for the failure modes that are easy to
 * misread (checksum headers, path style, non-public bucket).
 *
 * Creates and then removes a single ~1 KB object under photos/_verify/.
 */

import dotenv from 'dotenv';
import { Buffer } from 'node:buffer';

dotenv.config();

const {
    uploadPhoto,
    getSignedPhotoUrl,
    getObjectStream,
    deletePhoto,
    isStorageHealthy,
    getStorageConfig,
} = await import('../src/lib/storage.js');

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const note = (m) => console.log(`        ${m}`);

// A 1x1 JPEG — real magic bytes, so this is a fair proxy for a photo upload.
const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64'
);

let uploadedKey = null;
let failures = 0;

console.log('\nVibeMeet storage verification\n');

// ── 0. Config ────────────────────────────────────────────────────────────────
let config;
try {
    config = getStorageConfig();
    console.log(`  endpoint       ${config.endpoint}`);
    console.log(`  bucket         ${config.bucket}`);
    console.log(`  region         ${config.region}`);
    console.log(`  path style     ${config.forcePathStyle}`);
    console.log(`  public base    ${config.publicBaseUrl}\n`);
} catch (err) {
    fail(err.message);
    note('Copy api/.env.example to api/.env and fill in the S3_* vars.');
    process.exit(1);
}

// ── 1. Bucket reachable ──────────────────────────────────────────────────────
const health = await isStorageHealthy();
if (health.healthy) {
    pass('bucket reachable (HeadBucket)');
} else {
    failures++;
    fail(`bucket unreachable — ${health.error}`);
    if (/checksum/i.test(health.error)) {
        note('Provider rejected an AWS checksum header. storage.js already sets');
        note('WHEN_REQUIRED — check S3_REQUEST_CHECKSUM is not overriding it.');
    } else if (/SignatureDoesNotMatch/i.test(health.error)) {
        note('Usually S3_REGION not matching the region in S3_ENDPOINT.');
    } else if (/NoSuchBucket|NotFound|404/i.test(health.error)) {
        note(`Bucket "${config.bucket}" does not exist — create it first.`);
    } else if (/ECONNREFUSED/i.test(health.error)) {
        note('Nothing listening at S3_ENDPOINT. For MinIO: docker-compose up -d');
    }
    console.log('\nStopping — later checks would all fail for the same reason.\n');
    process.exit(1);
}

// ── 2. Upload ────────────────────────────────────────────────────────────────
let publicUrl = null;
try {
    const result = await uploadPhoto(TINY_JPEG, 'image/jpeg', '_verify', 'jpg');
    uploadedKey = result.key;
    publicUrl = result.url;
    pass(`upload (${uploadedKey})`);
} catch (err) {
    failures++;
    fail(`upload — ${err.message}`);
    if (/checksum/i.test(err.message)) {
        note('Classic Backblaze B2 + modern-AWS-SDK failure. Confirm storage.js');
        note('is passing requestChecksumCalculation: "WHEN_REQUIRED".');
    }
}

// ── 3. Signed GET — how the client actually fetches photos ───────────────────
if (uploadedKey) {
    try {
        const signed = await getSignedPhotoUrl(uploadedKey, 120);
        const res = await fetch(signed);
        if (res.ok) {
            pass(`signed URL fetch (HTTP ${res.status})`);
        } else {
            failures++;
            fail(`signed URL fetch returned HTTP ${res.status}`);
            note('Presigning works but the provider rejected it — often path-style.');
            note('Try flipping S3_FORCE_PATH_STYLE.');
        }
    } catch (err) {
        failures++;
        fail(`signed URL fetch — ${err.message}`);
    }
}

// ── 4. Public GET — how the ML service fetches photos ────────────────────────
// photos.url is stored in the DB and read back by ml/face.py download_img,
// including by ml/Queue.py on a retry hours later. It must be anonymously
// readable, or every photo silently stays indexed=false.
if (publicUrl) {
    try {
        const res = await fetch(publicUrl);
        if (res.ok) {
            pass(`public URL fetch (HTTP ${res.status}) — ML can reach photos`);
        } else {
            failures++;
            fail(`public URL fetch returned HTTP ${res.status}`);
            note('The ML service downloads photos from this URL with no credentials.');
            note('If it 403s, face indexing will never run and photos stay indexed=false.');
            note('B2:    set the bucket to Public in the dashboard.');
            note('MinIO: mc anonymous set download local/' + config.bucket);
            note(`Also confirm S3_PUBLIC_URL is right — currently ${config.publicBaseUrl}`);
        }
    } catch (err) {
        failures++;
        fail(`public URL fetch — ${err.message}`);
    }
}

// ── 5. Stream — how the zip endpoint reads photos ────────────────────────────
if (uploadedKey) {
    try {
        const stream = await getObjectStream(uploadedKey, 10000);
        let bytes = 0;
        for await (const chunk of stream) bytes += chunk.length;
        if (bytes === TINY_JPEG.length) {
            pass(`stream read (${bytes} bytes, matches upload)`);
        } else {
            failures++;
            fail(`stream read returned ${bytes} bytes, expected ${TINY_JPEG.length}`);
        }
    } catch (err) {
        failures++;
        fail(`stream read — ${err.message}`);
    }
}

// ── 6. Delete ────────────────────────────────────────────────────────────────
if (uploadedKey) {
    try {
        await deletePhoto(uploadedKey);
        pass('delete');
    } catch (err) {
        failures++;
        fail(`delete — ${err.message}`);
        note(`Leftover test object: ${uploadedKey} — remove it manually.`);
    }
}

console.log(
    failures === 0
        ? '\nAll checks passed. Storage is wired up correctly.\n'
        : `\n${failures} check(s) failed — see the notes above.\n`
);
process.exit(failures === 0 ? 0 : 1);
