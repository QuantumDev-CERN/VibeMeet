Repo Link: https://github.com/QuantumDev-CERN/VibeMeet.git

# VibeMeet — Project Context for Claude

> Keep this file updated as the project progresses. Feed it at the start of every new chat.
> Last synced against the actual codebase (not just memory) — see "Doc Sync Notes" at the bottom.

---

## Project

Reddit-style event community platform with face recognition search.
Attendees can find photos they appear in by submitting selfies.

### Mental Model (important — read before touching routes)

```
Community (persistent group — "IIIT Sonepat CS 2027", "Tito's Bar Regulars")
  └── Thread (a single event — "Farewell Party March 15", "Saturday Night April 5")
        └── Photos (uploaded by anyone attending)
              └── Face embeddings (extracted by ML, scoped to thread_id)
```

- **Community** = a group of people or a place. Created once, lives forever.
- **Thread** = one specific event inside a community. This is what photos belong to.
- **Photo** = uploaded to a thread. ML runs on it, stores face embeddings with that `thread_id`.
- **Search** = "find me in THIS thread's photos" — cosine similarity scoped to `thread_id` only, never global.
- **Slug** = URL-friendly version of community name. "IIIT Sonepat CS 2027" → `iiit-sonepat-cs-2027`. Pure UX. All FKs internally use UUID.

---

## Stack

| Layer | Tech | Status |
|---|---|---|
| Frontend | Next.js | **Not started** — only `layout.jsx` + one stub page exist (~20 lines total) |
| API | Node.js + Express | **Essentially done** — all 6 route files built, wired into `index.js` |
| ML Service | FastAPI + InsightFace | ✅ Done — GPU inference live |
| Database | PostgreSQL 16 + pgvector | ✅ Done — schema has grown since first pass (see below) |
| Storage | Cloudflare R2 | ✅ Done — now stores two variants per photo (download + thumb) |
| Cache / Rate limit | Redis (ioredis) | ✅ Done — search rate limiting + ephemeral search sessions |
| Job Queue | Redis + RQ | ❌ **Still a placeholder** — `ml/Queue.py` is one docstring line. `rq` is in `requirements.txt` but nothing uses it yet |

---

## Environment

- Machine: LOQ 10, Ryzen 7 250, 16GB DDR5, Nvidia RTX 5060, Fedora 43
- **GPU inference is live** — `face.py` uses `CUDAExecutionProvider` (commit: "Switched to CUDA inferencing"). This is done, not pending — an earlier note in this file said it still needed doing; it doesn't.
- Docker running postgres via `pgvector/pgvector:pg16`, plus a Redis container
- Python venv active for ML service

---

## ML Service — COMPLETE ✅

- Model: `buffalo_l` via InsightFace, auto-downloads on first run, **CUDAExecutionProvider** (GPU)
- `/process-photo` — detects faces, stores 512-dim embeddings in pgvector
- `/index-user` — takes 2–5 selfies, builds an averaged + renormalized identity vector
- `/search` — cosine similarity search scoped to `thread_id`, with a **second quality filter**:
  - `similarity > threshold` (default 0.45) — recognition confidence
  - `det_score > 0.7` (`DET_SCORE_THRESHOLD` in `search.py`) — detection quality; filters blur/reflections/partial faces even if similarity looks high
  - `LIMIT 100` (`SEARCH_LIMIT`) — caps result set for very large threads
- `build_user_embedding`: takes the **largest** face per selfie if multiple people are in frame, only keeps selfies with `det_score > 0.7`, averages + renormalizes (mean of normalized vectors has magnitude < 1, so it's renormalized after)
- Tested: crowd photo returned 101 faces, embeddings stored, user photo retrieved successfully

---

## Database

**Docker container names (actual, from `docker-compose.yml`):** `vibemeet_db`, `vibemeet_redis` — **lowercase**. An earlier version of this doc said `VibeMeet_db`; the real compose file uses lowercase for both the container names *and* the Postgres user/password/db (`vibemeet`/`vibemeet`/`vibemeet`).

⚠️ **Possible live bug:** `.env.example` and the connection string documented below still show `VibeMeet:VibeMeet@.../VibeMeet` (capitalized). Postgres usernames/passwords are case-sensitive — if your real `.env` still has the capitalized version, it will not match what `docker-compose.yml` actually creates. Worth checking your live `.env` against the compose file.

**Connection string (as compose actually creates it):** `postgresql://vibemeet:vibemeet@localhost:5432/vibemeet`
**Start DB:** `docker-compose up -d` from project root
**Reset DB (dev):** `docker-compose down -v && docker-compose up -d`

### Schema — 8 tables (current, includes thumbnail columns)

```sql
users (id UUID, email, username, password TEXT, avatar_url, created_at)
-- column is 'password' not 'password_hash' — never use password_hash in queries

user_face_embeddings (id, user_id, embedding vector(512), selfie_count, created_at)

communities (id, name, slug, description, banner_url, created_by, member_count INT DEFAULT 1, created_at)
-- member_count is DENORMALIZED — do not compute via subquery at read time
-- name AND description are both required by the API (communities.js rejects if either missing)
-- slug generation now strips repeated dashes: .replace(/-+/g, '-') — the old "double-dash" bug is fixed

community_members (user_id, community_id, role, joined_at)
-- PRIMARY KEY (user_id, community_id)
-- role defaults to 'member', creator gets 'admin'

threads (id, community_id, created_by, title, description, event_date, location, created_at)
-- only title required; event_date is DATE type — sending an ISO datetime truncates time silently

photos (id, thread_id, uploaded_by, storage_key, url, storage_key_thumb, url_thumb, indexed, face_count, uploaded_at)
-- NEW since last pass: storage_key_thumb / url_thumb — every photo now has two R2 objects:
--   download variant: 2560px longest side, JPEG q88 — what ML runs on, what users download
--   thumb variant:    400px longest side, JPEG q70  — UI preview only, never sent to ML
-- both storage_key columns are NEVER returned to the client
-- EXIF (including GPS) is stripped from both variants at upload time via sharp .withMetadata({exif:{}})

face_embeddings (id, photo_id, thread_id, embedding vector(512), bbox, det_score, created_at)

photo_faces (photo_id, user_id, confidence, confirmed, bbox, matched_at)
-- confirmed is a tri-state: NULL (unreviewed) / true (confirmed) / false (rejected, hidden from feed)
-- written at SEARCH time, not at upload time — this table is the durable record of "user X appears in photo Y"
-- also used for: profile feed (GET /users/me/photos), recovery downloads, confirm/reject flow
```

### Indexes
- HNSW index on `face_embeddings(embedding vector_cosine_ops)`
- Index on `face_embeddings(thread_id)`
- Index on `photo_faces(user_id)` — powers the profile feed query
- Index on `photos(thread_id)`

### Key schema decisions
- `member_count` denormalized counter, incremented only on a real insert (`RETURNING` check), not on `ON CONFLICT` no-ops.
- Slug generated in JS, trailing/duplicate-dash cleanup now included.
- Community creation is transactional: INSERT community + INSERT community_members (admin) in one `BEGIN/COMMIT`.
- `photo_faces` is written at **search time**, not upload time — every past search result is durable, so the profile feed and recovery downloads don't need to re-run ML.

---

## Directory Structure (current)

```
VibeMeet/
├── client/
│   └── app/
│       ├── layout.jsx              # stub
│       └── c/[slug]/page.jsx       # stub
│   └── package.json                # scripts only, no deps installed yet
├── api/
│   ├── src/
│   │   ├── index.js                # ✅ all 6 routers mounted + multer error handler + global error handler
│   │   ├── db.js                   # ✅ pg Pool
│   │   ├── middleware/
│   │   │   └── auth.js             # ✅ JWT Bearer verify, attaches req.user
│   │   ├── routes/
│   │   │   ├── auth.js             # ✅ POST /register, POST /login
│   │   │   ├── users.js            # ✅ GET /me, POST /me/face, GET /me/photos, PATCH /me/photos/:id/confirm
│   │   │   ├── communities.js      # ✅ create/list/get/join, mounts threads router internally
│   │   │   ├── threads.js          # ✅ create/list/get — known catch(err) syntax bug is FIXED
│   │   │   ├── photos.js           # ✅ multipart upload → sharp (2 variants) → R2 → ML fire-and-forget
│   │   │   └── search.js           # ✅ POST /, POST /download, POST /zip — Redis-backed
│   │   └── lib/
│   │       ├── r2.js               # ✅ Cloudflare R2 upload + signed URLs
│   │       ├── ml.js               # ✅ axios wrapper for ML service
│   │       └── redis.js            # ✅ NEW — ioredis client, TTL config, health check
│   ├── package.json                # "type": "module", dev uses node --watch
│   └── .env                        # symlinked from root .env
├── ml/
│   ├── main.py                     # ✅ (docstring still says "placeholder" — stale comment, code is complete)
│   ├── face.py                     # ✅ now GPU (CUDAExecutionProvider)
│   ├── search.py                   # ✅ includes det_score quality filter + SEARCH_LIMIT
│   ├── models.py                   # ✅ pydantic schemas
│   ├── db.py                       # ✅
│   ├── Queue.py                    # ❌ still literally just a docstring — RQ integration not started
│   └── requirements.txt            # includes rq + redis already, unused so far
├── infra/
│   └── schema.sql
├── docker-compose.yml              # postgres (pgvector) + redis, both with healthchecks
├── .env
└── Claude.md
```

---

## .env Variables (current)

```
DATABASE_URL=postgresql://vibemeet:vibemeet@localhost:5432/vibemeet   # verify casing matches docker-compose!
JWT_SECRET=your_long_random_secret
JWT_EXPIRES_IN=7d
PORT=3001
ML_SERVICE_URL=http://localhost:8000
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=gatherly-photos
R2_PUBLIC_URL=https://your-r2-public-url
REDIS_URL=redis://localhost:6379
```

---

## API Routes — Status

### Auth (`/api/auth`) ✅ Done
- `POST /api/auth/register` — creates user, returns JWT + user object
- `POST /api/auth/login` — validates credentials, returns JWT + user object

### Communities (`/api/communities`) ✅ Done
- `POST /` — auth required. `name` **and** `description` both required (API rejects if either missing — schema still has description as nullable). Transaction: INSERT community + INSERT community_members (admin). 409 on duplicate name (23505). Slug double-dash bug is fixed.
- `GET /` — public, reads `member_count` column directly
- `GET /:slug` — public, 404 if not found
- `POST /:id/join` — auth required, idempotent (`ON CONFLICT DO NOTHING`), only increments `member_count` on a real insert

### Threads ✅ Done
- `POST /api/communities/:communityId/threads` — auth required, only `title` required, verifies community exists first
- `GET /api/communities/:communityId/threads` — public, 404 if community missing (not empty array)
- `GET /api/threads/:id` — public, direct UUID lookup
- Nested router via `mergeParams: true`, mounted twice (scoped + direct) — as designed
- **The `catch {err}` syntax bug mentioned in earlier notes is fixed** — it's `catch (err)` in the current code

### Photos (`/api/photos`) ✅ Done
```
POST   /api/photos                    — upload photo to a thread (multipart, auth required)
GET    /api/photos/thread/:threadId   — list photos in a thread (public)
GET    /api/photos/:photoId/download  — recovery download for a specific matched photo (auth required)
```
- Magic byte validation on the raw upload (never trusts Content-Type)
- **New since last pass:** every upload is processed via `sharp` into two JPEG variants — a 2560px/q88 "download" version (fed to ML, offered for download) and a 400px/q70 "thumb" version (UI preview only). Both strip EXIF/GPS metadata.
- Free tier: 30 photos per user, enforced with `pg_advisory_xact_lock` (per-user serialization) + an atomic conditional INSERT — double protection against races
- Row inserted with `'pending'` placeholders in all four storage columns first (to reserve a UUID + enforce the limit), then updated after both R2 uploads complete
- On any failure after R2 upload succeeds, uploaded R2 objects are deleted (cleanup in the catch block) to avoid orphaned files
- ML processing is fire-and-forget (`processPhoto(...).catch(...)`) — user gets `201` immediately, `indexed=false` until ML finishes
- `GET /:photoId/download` — recovery endpoint used when a photo is skipped during a zip download; requires a `photo_faces` row (i.e. the user actually appeared in this photo, per a past search) before issuing a signed URL
- `storage_key` / `storage_key_thumb` never returned to the client

### Search (`/api/search`) ✅ Done — NOT "not started"
```
POST /api/search           — run a face search for the authenticated user in a thread
POST /api/search/download  — selective signed download URLs for chosen photo_ids from a search
POST /api/search/zip       — stream all matched photos as a zip, no intermediate storage
```
- **Community membership gate:** the user must be a member of the community that owns the thread, or the search is rejected with 403. (This wasn't documented before — it's a real access-control rule now enforced in code.)
- **Rate limited via Redis:** 5 searches per 10 minutes per user (`SEARCH_RATE_LIMIT` in `redis.js`), atomic `INCR` + `EXPIRE` pattern. Checked *after* the cheap DB validations, so failed/invalid requests don't burn rate-limit tokens.
- Requires the user to have already registered a face (`user_face_embeddings` row) — returns 422 with a clear message if not.
- Search results: written to `photo_faces` (durable) **and** stored ephemerally in Redis under a random UUID search key (10 min TTL) — the search key is what the client uses for the two follow-up endpoints.
- `/download`: verifies every requested `photo_id` was actually part of that search session before signing URLs (403 otherwise) — client can't fish for other photos.
- `/zip`: streams directly from R2 into an `archiver` zip (store mode — no recompression, JPEGs already compressed), one photo in flight at a time to keep memory flat. Any photo that fails to stream is skipped and listed in a `skipped.txt` inside the zip with a recovery URL pointing at `GET /api/photos/:photoId/download`.
- Requires `isRedisHealthy()` to pass first — returns a clean 503 rather than hanging if Redis is down.

### Users (`/api/users`) ✅ Done — NOT "not started"
```
GET   /api/users/me                          — own profile (auth required), password never selected
POST  /api/users/me/face                     — register/update face (2–5 selfies, auth required)
GET   /api/users/me/photos                   — paginated match history (auth required)
PATCH /api/users/me/photos/:photoId/confirm  — confirm or reject a face match (auth required)
```
- `POST /me/face`: accepts 2–5 selfies (not 3–5 as earlier notes said — `MIN_SELFIES = 2`, `MAX_SELFIES = 5`), magic-byte validates every file and rejects the whole batch if any file is invalid, calls ML `/index-user` (awaited — user is waiting to know if it worked). Supports re-registration (upsert) without deleting past `photo_faces` history.
- **Open TODO in code:** `DELETE /api/users/me/face` (GDPR right-to-erasure) is explicitly marked not implemented — needs a product decision on whether deleting face data should also remove the user from past photo feeds.
- `GET /me/photos`: joins `photo_faces → photos → threads → communities`, filters `confirmed IS NOT false` (shows unreviewed + confirmed, hides rejected), paginated (`?page=&limit=`, max 100/page), generates short-TTL (5 min) thumbnail signed URLs only for the current page.
- `PATCH /me/photos/:id/confirm`: body `{ action: 'confirm' | 'reject' }`, scoped by `user_id` in the WHERE clause so users can only act on their own matches.

---

## lib/ml.js — COMPLETE ✅
```js
processPhoto(photoId, threadId, imageUrl)   // POST /process-photo
indexUser(userId, buffers, mimetypes)        // POST /index-user — multipart, form.getHeaders()
search(userId, threadId, threshold=0.45)     // POST /search
```

## lib/r2.js — COMPLETE ✅
```js
uploadPhoto(buffer, mimetype, threadId, ext)
getSignedPhotoUrl(storageKey, expiresIn=3600)
deletePhoto(storageKey)
```

## lib/redis.js — NEW, COMPLETE ✅
```js
TTL = { SEARCH_RESULTS: 10min, SEARCH_ZIP: 30min, RATE_LIMIT: 10min }
SEARCH_RATE_LIMIT = 5
isRedisHealthy()   // client.status === 'ready' — callers check this before using Redis
```
- Reconnect strategy: exponential backoff capped at 5s, gives up after 10 consecutive failures
- Redis being down degrades gracefully (search/download return 503) — it does **not** crash the API or block auth/community/thread/photo routes

---

## Key Patterns Used Across the Codebase

(unchanged from before — still accurate)

### pool.query() vs pool.connect()
`pool.query()` auto-releases after one query. `pool.connect()` is required for transactions/advisory locks — always `client.release()` in `finally`.

### Transaction pattern
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

### Advisory lock pattern (per-user serialization)
```js
await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [userId]);
// transaction-scoped — auto-released, no manual unlock
// never use pg_advisory_lock (session-scoped) in a pool — lock leaks on connection reuse
```

### Atomic conditional insert (limit enforcement)
```sql
INSERT INTO photos (...)
SELECT $1, $2, 'pending', 'pending'
WHERE (SELECT COUNT(*) FROM photos WHERE uploaded_by = $2) < $3
RETURNING id
-- rows.length === 0 means limit was hit, not an error
```

### Idempotent upsert pattern
```js
const result = await pool.query(`INSERT INTO ... ON CONFLICT (...) DO NOTHING RETURNING id`, [...]);
if (result.rows.length > 0) { /* only on real insert */ }
```

### Nested router pattern (mergeParams)
```js
// threads.js
const router = Router({ mergeParams: true });
// communities.js
router.use('/:communityId/threads', threadRoutes);
// index.js — second mount for direct lookup
app.use('/api/threads', threadRoutes);
```

### Controlled concurrency (mapWithConcurrency)
Used in `photos.js`, `users.js`, and `search.js` for parallel signed-URL generation / external calls with a concurrency cap (10). `index++` is atomic in single-threaded JS, `results[current]` preserves order.

### Magic byte validation
```
JPEG: FF D8 FF at offset 0
PNG:  89 50 4E 47 0D 0A 1A 0A at offset 0
WebP: 57 45 42 50 at offset 8
```
Never trust `Content-Type` or the client filename — extension/mimetype always derived from actual bytes.

### Redis atomic rate limiting (NEW)
```js
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, TTL.RATE_LIMIT);
if (count > LIMIT) return { allowed: false, retryAfter: await redis.ttl(key) };
```
`INCR` is atomic — no check-then-increment race.

### Error forwarding
Always `next(err)` in catch blocks. Postgres codes: `23505` unique violation, `23503` FK violation.

---

## Business Rules (current — includes rules discovered in code, not just design intent)

- Face search is scoped to `thread_id` only — never global
- **User must be a member of the thread's community to search it** (403 otherwise) — enforced in `search.js`, wasn't documented before
- Users must submit **2–5 selfies** (not 3–5) before being indexed; explicit consent is a product requirement but there's no consent field/checkbox in the current API — it isn't technically enforced yet, likely a frontend concern
- Anyone can upload photos to a thread (no restriction)
- Anyone authenticated can create a thread in any community (no admin gate)
- Free tier: 30 photo upload limit (enforced atomically with advisory lock)
- Search is rate-limited: **5 searches per 10 minutes per user** (Redis-backed)
- Download only allowed for users who appear in the photo (`photo_faces` row required)
- Cosine similarity match threshold: **0.45** (tunable per-request, defaults server-side)
- Detection quality threshold: **0.7** (`det_score`) — separate from the similarity threshold, filters blurry/partial faces
- Result cap: 100 matches per search (`SEARCH_LIMIT`)
- Model: `buffalo_l`, GPU inference (CUDAExecutionProvider)

---

## Gotchas & Lessons Learned

- Schema uses `password` not `password_hash`
- JWT: `jwt.sign(payload, secret, { expiresIn: '7d' })` — options is the third arg, `expiresIn` is case-sensitive
- **Container names are lowercase**: `vibemeet_db`, `vibemeet_redis` — not `VibeMeet_db`
- **Possible casing mismatch**: `docker-compose.yml` creates the Postgres user/db as lowercase `vibemeet`, but `.env.example` and the previously-documented connection string use capitalized `VibeMeet` — double check your real `.env` matches what Docker actually created
- Always run `docker-compose up -d` before starting the API server (now brings up Postgres **and** Redis)
- ES modules throughout — `"type": "module"`, `node --watch` instead of nodemon
- `auth.js` bug (`req.header.authorization` vs `req.headers.authorization`) — fixed
- `threads.js` `catch {err}` syntax bug — **fixed**, confirmed in current code
- Slug double-dash bug — **fixed**, `.replace(/-+/g, '-')` is in place
- `pool.connect()` required for transactions/advisory locks; `pool.query()` can't hold a connection across queries
- `member_count` DEFAULT is 1, not 0 — creator auto-joins in the same transaction
- `mergeParams: true` required on any child router needing parent URL params
- Optional body fields must be coerced to `null` (`undefined` breaks `pg`)
- Non-UUID params still return a raw 500 from Postgres — UUID validation middleware still not implemented (except `search.js`, which added its own `isValidUUID` regex check locally — not shared as middleware yet)
- `multer` `fileFilter` only sees client-supplied Content-Type — useless for security, always validate magic bytes after reading the buffer
- `storage_key` / `storage_key_thumb` are internal — never returned to the client
- `ml/main.py`'s docstring still says "FastAPI application entrypoint placeholder" — that's a stale comment, the file is fully implemented; don't take file-level docstrings as a status signal
- `ml/Queue.py` really is just a placeholder — don't assume the `rq`/`redis` entries in `requirements.txt` mean the queue is wired up
- Repair query if `member_count` diverges:
  ```sql
  UPDATE communities c SET member_count = (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id);
  ```
- Queue worker retry query for unprocessed photos (still needs an actual worker to run it):
  ```sql
  SELECT id, url FROM photos WHERE indexed = false ORDER BY uploaded_at ASC;
  ```

---

## Dependencies (api/package.json — current)

```json
{
  "@aws-sdk/client-s3": "^3.1058.0",
  "@aws-sdk/lib-storage": "^3.1058.0",
  "@aws-sdk/s3-request-presigner": "^3.1058.0",
  "archiver": "^7.0.1",
  "axios": "^1.7.9",
  "bcrypt": "^6.0.0",
  "dotenv": "^17.4.0",
  "express": "^5.2.1",
  "ioredis": "^5.6.1",
  "jsonwebtoken": "^9.0.3",
  "multer": "^2.1.1",
  "pg": "^8.20.0",
  "sharp": "^0.34.2"
}
```
New since the last version of this doc: `archiver`, `ioredis`, `sharp`.

### ml/requirements.txt (current)
```
fastapi, uvicorn, insightface==0.7.3, onnxruntime-gpu, opencv-python-headless,
numpy, psycopg2-binary, python-multipart, pydantic, python-dotenv, rq, redis, requests
```
Note: `onnxruntime-gpu` is now the real dependency (GPU inference is live), not a CPU fallback.

---

## Next Steps (in order — reflects real remaining work)

- [x] Postman test all communities.js endpoints
- [x] `threads.js` — create, list, get single
- [x] Fix `threads.js` catch(err) bug
- [x] `lib/ml.js`, `lib/r2.js`
- [x] `photos.js` — multipart upload, magic bytes, advisory lock, R2, ML fire-and-forget, now with dual-variant image processing
- [x] `search.js` — face search, selective download, zip download, Redis rate limiting
- [x] `users.js` — profile, selfie submission, match history, confirm/reject
- [x] `lib/redis.js` — rate limiting + ephemeral search sessions
- [x] Switch ML inference to GPU (CUDAExecutionProvider)
- [ ] **Verify `.env` casing matches `docker-compose.yml`** (`vibemeet` vs `VibeMeet`) — check before debugging any "connection refused"-looking auth failures
- [ ] Redis + RQ background worker to retry `indexed=false` photos — `Queue.py` is still empty, this is the biggest real gap on the backend
- [ ] `DELETE /api/users/me/face` — GDPR erasure endpoint, needs a product decision on cascading behavior first
- [ ] Shared UUID-validation middleware (currently only `search.js` validates UUIDs locally; other routes still 500 on malformed IDs)
- [ ] Explicit consent capture for face registration (currently just an authenticated upload, no consent flag)
- [ ] Next.js frontend — this is the actual "not started" item; only two stub files exist

---

## Doc Sync Notes

This file was regenerated by reading the actual repository (routes, schema, docker-compose, package.json, requirements.txt, and git log) rather than carried forward from memory. Previous versions of this file had drifted noticeably from the code — `search.js` and `users.js` were marked "not started" while both were fully built, the `threads.js` and slug bugs were marked unfixed while both were fixed, and the GPU migration wasn't reflected. If you're reading this in a future session: it's worth doing this kind of pass periodically, since a stale doc will cause a fresh Claude session to redo work that's already done.
