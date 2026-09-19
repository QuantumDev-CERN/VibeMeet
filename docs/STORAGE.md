# Object Storage Setup

VibeMeet stores photos in S3-compatible object storage. `api/src/lib/storage.js`
is provider-agnostic — switching providers is an `.env` change, not a code
change.

Cloudflare R2 is no longer the default because **issuing R2 API tokens requires
a payment method on the Cloudflare account**, even inside the free tier. The two
options below don't.

---

## Why these two

| | Free tier | Card at signup? | S3 parity | Good for |
|---|---|---|---|---|
| **MinIO** (self-hosted) | unlimited, it's your disk | none — no signup at all | full | local dev |
| **Backblaze B2** | 10 GB storage, free egress up to 3× stored | no — signup page says so explicitly | full | deployed |
| ~~Cloudflare R2~~ | 10 GB | **yes, to issue tokens** | partial | — |
| Supabase Storage | 1 GB | no | partial, no versioning | if you were already on Supabase |
| Firebase Storage | 5 GB | yes (Blaze plan required) | adapter needed | — |

Backblaze B2 is the pick for anything deployed. It's the closest to real S3 of
anything with a card-free free tier, which matters here because the codebase
already uses `@aws-sdk/client-s3`, `lib-storage` multipart uploads, and
presigned URLs — all of which B2 supports natively.

Note the 10 GB is storage, not bandwidth. B2's free egress is 3× your average
stored data, so at 2 GB stored you get 6 GB/month of downloads before
$0.01/GB kicks in. Putting Cloudflare in front of B2 zeroes out egress
entirely — worth doing before launch, not now.

---

## Option A — MinIO (local dev, zero signup)

Already wired into `docker-compose.yml`. Nothing to sign up for.

```bash
docker-compose up -d
```

That starts Postgres, Redis, MinIO (`:9000` API, `:9001` console), and a
one-shot `minio_init` container that creates the `vibemeet-photos` bucket and
makes it anonymously readable.

Then in `api/.env` — these are the defaults already in `api/.env.example`:

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=vibemeet
S3_SECRET_ACCESS_KEY=vibemeet123
S3_BUCKET=vibemeet-photos
S3_PUBLIC_URL=http://localhost:9000/vibemeet-photos
S3_FORCE_PATH_STYLE=true
```

Verify:

```bash
cd api && npm run verify:storage
```

Console at http://localhost:9001 (`vibemeet` / `vibemeet123`) if you want to
eyeball the objects.

---

## Option B — Backblaze B2 (deployed)

### 1. Create the account

https://www.backblaze.com/sign-up/s3 — the signup page states no credit card
required. Email verification only.

**Pick your region carefully.** B2 fixes your account region at signup and it
cannot be changed later. `EU Central` if you want data in the EU; `US West`
otherwise.

### 2. Create the bucket

Buckets → Create a Bucket:

- **Name**: `vibemeet-photos` (globally unique across all of B2 — you'll likely
  need a suffix, e.g. `vibemeet-photos-7f3a`)
- **Files in Bucket are**: **Public**
- Default encryption: disabled
- Object Lock: disabled

Public is required. `photos.url` is written to the database and later fetched
with no credentials by the ML service (`ml/face.py` `download_img`) — including
by `ml/Queue.py` on a retry hours after upload, by which point a presigned URL
would have expired. The `storage_key` columns stay server-side and the client is
still served presigned URLs, so this isn't a change in posture: the R2 setup
made exactly the same assumption via `R2_PUBLIC_URL`.

### 3. Set a lifecycle rule

Bucket → Lifecycle Settings → **Keep only the last version of the file**.

B2 defaults to keeping every version. `deletePhoto()` sends an S3
`DeleteObject`, which on a version-keeping bucket hides the file rather than
removing it — the bytes keep counting against your 10 GB forever. `photos.js`
calls `deletePhoto` on every failed upload rollback, so this accumulates
quietly.

### 4. Create an application key

App Keys → Add a New Application Key:

- Name: `vibemeet-api`
- Allow access to: your bucket only (not "All")
- Type of Access: **Read and Write**

You get three values. **The key is shown once.**

- `keyID` → `S3_ACCESS_KEY_ID`
- `applicationKey` → `S3_SECRET_ACCESS_KEY`
- `Endpoint`, e.g. `s3.us-west-004.backblazeb2.com`

### 5. Fill in `api/.env`

```env
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_ACCESS_KEY_ID=004xxxxxxxxxxxx0000000001
S3_SECRET_ACCESS_KEY=K004xxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_BUCKET=vibemeet-photos-7f3a
S3_PUBLIC_URL=https://f004.backblazeb2.com/file/vibemeet-photos-7f3a
S3_FORCE_PATH_STYLE=true
```

Three things that bite:

- `S3_REGION` **must** match the region inside `S3_ENDPOINT`. A mismatch shows
  up as `SignatureDoesNotMatch`, which reads like bad credentials but isn't.
- `S3_PUBLIC_URL` uses the **`f`** host and a `/file/` path segment —
  `f004.` not `s3.`. The digits match your endpoint (`s3.us-west-004` →
  `f004`).
- The endpoint needs the `https://` scheme. B2's dashboard shows it without one.

### 6. Verify

```bash
cd api && npm run verify:storage
```

---

## The checksum gotcha

If you wire up B2 by hand somewhere else, you will hit this:

```
400 InvalidArgument: Unsupported header 'x-amz-checksum-crc32'
   received for this API call.
```

AWS SDK v3 from ~3.729 onward sends data-integrity checksum headers by default,
and B2 rejects them. This project pins `@aws-sdk/client-s3@^3.1058.0`, well past
that line.

`storage.js` already handles it:

```js
requestChecksumCalculation: 'WHEN_REQUIRED',
responseChecksumValidation: 'WHEN_REQUIRED',
```

Backblaze's own docs tell you to downgrade the SDK instead. Don't — these two
flags restore the same behaviour without pinning an old SDK. Overridable via
`S3_REQUEST_CHECKSUM` / `S3_RESPONSE_CHECKSUM` if a provider wants full
checksums.

---

## Migrating from R2

Backwards compatible — `storage.js` still reads the old `R2_*` names as
fallbacks, and `lib/r2.js` re-exports from `storage.js`. An existing `.env`
keeps working. To move over properly:

| Old | New |
|---|---|
| `R2_ACCOUNT_ID` | dropped — use `S3_ENDPOINT` |
| `R2_ACCESS_KEY_ID` | `S3_ACCESS_KEY_ID` |
| `R2_SECRET_ACCESS_KEY` | `S3_SECRET_ACCESS_KEY` |
| `R2_BUCKET_NAME` | `S3_BUCKET` |
| `R2_PUBLIC_URL` | `S3_PUBLIC_URL` |
| — | `S3_REGION`, `S3_FORCE_PATH_STYLE` (new) |

If you already have photos in R2, existing `photos.url` rows still point at the
R2 public URL. New uploads go to the new bucket; old rows keep working as long
as the R2 bucket stays up. There's no migration script — with a free-tier
dataset it's usually simpler to wipe and re-upload:

```bash
docker-compose down -v && docker-compose up -d
```

Once you've confirmed nothing imports it, `api/src/lib/r2.js` can be deleted.

---

## Anything else S3-compatible

Same five variables. Supabase Storage, Wasabi, Filebase, Storj, or real AWS S3
all work — set `S3_ENDPOINT` / `S3_REGION` to whatever the provider documents
and run `npm run verify:storage`. The only provider-specific knob is
`S3_FORCE_PATH_STYLE`; if presigned URLs 403 but `HeadBucket` succeeds, flip it.
