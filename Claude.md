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
| API | Node.js + Express | **Essentially done** — all 6 route files built, wired into `index.js`, shared UUID validation middleware applied |
| ML Service | FastAPI + InsightFace | ✅ Done — GPU inference live |
| Database | PostgreSQL 16 + pgvector | ✅ Done — schema includes retry tracking + soft-delete flag (see below) |
| Storage | Cloudflare R2 | ✅ Done — stores two variants per photo (download + thumb) |
| Cache / Rate limit | Redis (ioredis) | ✅ Done — search rate limiting + ephemeral search sessions |
| Job Queue | Redis + RQ | ✅ **Done** — `ml/Queue.py` polls for stuck photos, retries via RQ, caps at 5 attempts, alerts on consecutive failures |
| Tests | Node `node:test` + Python `unittest` | ✅ 62 passing unit tests — `api/tests/`, `ml/tests/` — zero extra test-framework dependencies |

---

## Environment

- Machine: LOQ 10, Ryzen 7 250, 16GB DDR5, Nvidia RTX 5060, Fedora 43
- **GPU inference is live** — `face.py` uses `CUDAExecutionProvider`. This is done, not pending.
- Docker running postgres via `pgvector/pgvector:pg16`, plus a Redis container
- Python venv active for ML service

---

## ML Service — COMPLETE ✅

- Model: `buffalo_l` via InsightFace, auto-downloads on first run, **CUDAExecutionProvider** (GPU)
- `/process-photo` — detects faces, stores 512-dim embeddings in pgvector
- `/index-user` — takes 2–5 selfies, builds an averaged + renormalized identity vector; also flips `user_face_embeddings.active` back to `true` on re-registration
- `/search` — cosine similarity search scoped to `thread_id`, with a **second quality filter**:
  - `similarity > threshold` (default 0.45) — recognition confidence
  - `det_score > 0.7` (`DET_SCORE_THRESHOLD` in `search.py`) — detection quality; filters blur/reflections/partial faces even if similarity looks high
  - `LIMIT 100` (`SEARCH_LIMIT`) — caps result set for very large threads
  - Query for the user's own embedding filters `active = true` — a user who called `DELETE /me/face` gets the same "not registered" `ValueError` as someone who never signed up
- `store_face_embeddings`: photos with **zero detected faces** are correctly marked `indexed=true, face_count=0` (not left stuck at `indexed=false` forever — this was a real bug, now fixed)
- `build_user_embedding`: takes the **largest** face per selfie if multiple people are in frame, only keeps selfies with `det_score > 0.7`, averages + renormalizes
- Tested: crowd photo returned 101 faces, embeddings stored, user photo retrieved successfully

---

## Background Job Queue — COMPLETE ✅ (was the biggest gap, now closed)

`ml/Queue.py` — two processes, run separately:

1. **Poller** (`python Queue.py`) — every 30s, queries `photos WHERE indexed=false AND retry_count < 5`, enqueues each into RQ. Idempotent: checks `queue.fetch_job(photo_id)` first and skips anything already `queued`/`started`/`deferred`, so re-polling before a job finishes doesn't double-enqueue.
2. **RQ worker** (`rq worker photo-processing --url $REDIS_URL`) — runs `process_photo_job`, which reuses `download_img`/`extract_faces`/`store_face_embeddings` **in-process** (no HTTP round-trip to the FastAPI service calling itself).

Retry/failure handling:
- On success: `retry_count`/`last_error` cleared, consecutive-failure Redis counter reset to 0.
- On failure: `retry_count` incremented, `last_error` stored (truncated to 2000 chars), `last_attempted_at` updated. Does **not** re-raise — retries are tracked via our own DB column, not RQ's built-in retry/failure registry, so the two don't get out of sync.
- Once `retry_count >= MAX_RETRIES (5)`, the poll query stops picking that photo up — logged as a "giving up" warning.
- A Redis counter (`worker:consecutive_failures`) tracks failures across *all* jobs, not per-photo — every 5th consecutive failure logs `CRITICAL` (repeats every 5, not just once), meant to surface a systemic outage (ML/GPU/R2 down) rather than N unrelated bad photos. No external alert delivery wired up yet (Slack/email/etc.) — just a loud log line.

---

## Database

**Docker container names (actual, from `docker-compose.yml`):** `vibemeet_db`, `vibemeet_redis` — **lowercase**, matching Postgres user/password/db (`vibemeet`/`vibemeet`/`vibemeet`).

**Connection string (as compose actually creates it):** `postgresql://vibemeet:vibemeet@localhost:5432/vibemeet`
**Start DB:** `docker-compose up -d` from project root
**Reset DB (dev):** `docker-compose down -v && docker-compose up -d`

⚠️ **`retry_count`/`last_error`/`last_attempted_at` (on `photos`) and `active` (on `user_face_embeddings`) were added to `schema.sql` after most dev DBs were already created.** `schema.sql` only runs on a fresh volume — if your local DB predates these columns, run:
```sql
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;

ALTER TABLE user_face_embeddings
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
```

### Schema — 8 tables (current)

```sql
users (id UUID, email, username, password TEXT, avatar_url, created_at)
-- column is 'password' not 'password_hash' — never use password_hash in queries

user_face_embeddings (id, user_id, embedding vector(512), selfie_count, created_at, active BOOLEAN DEFAULT true)
-- active: soft-delete flag for DELETE /api/users/me/face. Flipping this instead of
-- hard-deleting the row (or cascading through photo_faces, which could be hundreds
-- of rows for an active user) keeps erasure to a single-row write.
-- search_faces() and the two Node routes that check embedding existence both
-- filter on active = true — a deactivated user reads as "never registered."

communities (id, name, slug, description, banner_url, created_by, member_count INT DEFAULT 1, created_at)
-- member_count is DENORMALIZED — do not compute via subquery at read time
-- name AND description are both required by the API
-- slug generation strips repeated dashes: .replace(/-+/g, '-')

community_members (user_id, community_id, role, joined_at)
-- PRIMARY KEY (user_id, community_id), role defaults to 'member', creator gets 'admin'

threads (id, community_id, created_by, title, description, event_date, location, created_at)
-- only title required; event_date is DATE type — sending an ISO datetime truncates time silently

photos (id, thread_id, uploaded_by, storage_key, url, storage_key_thumb, url_thumb, indexed, face_count,
        uploaded_at, retry_count INT DEFAULT 0, last_error TEXT, last_attempted_at TIMESTAMPTZ)
-- download variant: 2560px longest side, JPEG q88 — what ML runs on, what users download
-- thumb variant:    400px longest side, JPEG q70  — UI preview only, never sent to ML
-- both storage_key columns are NEVER returned to the client
-- EXIF (including GPS) stripped from both variants at upload
-- retry_count/last_error/last_attempted_at: written by ml/Queue.py, see Job Queue section above

face_embeddings (id, photo_id, thread_id, embedding vector(512), bbox, det_score, created_at)

photo_faces (photo_id, user_id, confidence, confirmed, bbox, matched_at)
-- confirmed is a tri-state: NULL (unreviewed) / true (confirmed) / false (rejected, hidden from feed)
-- written at SEARCH time, not upload time — durable record of "user X appears in photo Y"
-- NOT touched by DELETE /me/face — deleting face registration stops future matching,
-- it does not erase past matches or the user's own photo history
```

### Indexes
- HNSW index on `face_embeddings(embedding vector_cosine_ops)`
- Index on `face_embeddings(thread_id)`
- Index on `photo_faces(user_id)` — powers the profile feed query
- Index on `photos(thread_id)`

### Key schema decisions
- `member_count` denormalized counter, incremented only on a real insert, not on `ON CONFLICT` no-ops.
- Community creation is transactional: INSERT community + INSERT community_members (admin) in one `BEGIN/COMMIT`.
- `photo_faces` written at **search time**, not upload time.
- Soft-delete via boolean flag (`user_face_embeddings.active`, `photos.indexed`) is the established pattern in this schema for "stop using this without a write-heavy cascade."

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
│   │   │   ├── auth.js             # ✅ JWT Bearer verify, attaches req.user
│   │   │   └── validate.js         # ✅ NEW — shared validateUUID(field, opts) middleware
│   │   │                           #     supports params/body source, required, isArray + maxItems
│   │   ├── routes/
│   │   │   ├── auth.js             # ✅ POST /register, POST /login
│   │   │   ├── users.js            # ✅ GET /me, POST /me/face, GET /me/photos,
│   │   │   │                       #     PATCH /me/photos/:id/confirm, DELETE /me/face (NEW)
│   │   │   ├── communities.js      # ✅ create/list/get/join — validateUUID on :id/join
│   │   │   ├── threads.js          # ✅ create/list/get — validateUUID on :id
│   │   │   ├── photos.js           # ✅ upload → sharp (2 variants) → R2 → ML fire-and-forget
│   │   │   │                       #     validateUUID on :threadId and :photoId
│   │   │   └── search.js           # ✅ POST /, POST /download, POST /zip
│   │   │                           #     validateUUID on thread_id (body) and photo_ids (body, array)
│   │   └── lib/
│   │       ├── r2.js                # ✅ Cloudflare R2 upload + signed URLs
│   │       ├── ml.js                # ✅ axios wrapper for ML service
│   │       └── redis.js             # ✅ ioredis client, TTL config, health check
│   ├── tests/                       # ✅ NEW — node:test, zero extra deps
│   │   ├── validate.test.js         #     27 tests
│   │   └── auth.test.js             #     9 tests, real jsonwebtoken (not mocked)
│   ├── package.json                 # "type": "module", dev uses node --watch
│   └── .env.example                 # ⚠️ see Gotchas — diverged from root .env.example
├── ml/
│   ├── main.py                      # ✅ complete (docstring is stale, says "placeholder" — ignore it)
│   ├── face.py                      # ✅ GPU (CUDAExecutionProvider)
│   ├── search.py                    # ✅ det_score filter, SEARCH_LIMIT, active=true filtering,
│   │                                 #     zero-faces fix, active-flag upsert
│   ├── models.py                    # ✅ pydantic schemas
│   ├── db.py                        # ✅ get_connection() + get_redis() (NEW — RQ's own Redis client)
│   ├── Queue.py                     # ✅ DONE — poller + RQ job (see Job Queue section above)
│   ├── tests/                       # ✅ NEW — unittest, zero extra deps
│   │   ├── test_search.py           #     9 tests
│   │   └── test_queue.py            #     17 tests — stubs insightface/cv2 so no heavy CV deps needed
│   └── requirements.txt             # rq + redis now actually used, not just declared
├── infra/
│   └── schema.sql
├── docker-compose.yml                # postgres (pgvector) + redis, both with healthchecks
├── .env.example                      # ⚠️ two copies exist now, see Gotchas
└── Claude.md
```

---

## .env Variables (current)

```
DATABASE_URL=postgresql://vibemeet:vibemeet@localhost:5432/vibemeet
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
`ml/.env` needs the same `DATABASE_URL` plus `REDIS_URL` — it's a separate file from `api/.env`, easy to forget it exists.

---

## API Routes — Status

### Auth (`/api/auth`) ✅ Done
- `POST /api/auth/register` — creates user, returns JWT + user object
- `POST /api/auth/login` — validates credentials, returns JWT + user object

### Communities (`/api/communities`) ✅ Done
- `POST /` — auth required. `name` and `description` both required. Transactional insert. 409 on duplicate name.
- `GET /` — public, reads `member_count` column directly
- `GET /:slug` — public, 404 if not found
- `POST /:id/join` — auth required, `validateUUID('id')`, idempotent, only increments `member_count` on real insert

### Threads ✅ Done
- `POST /api/communities/:communityId/threads` — auth required, only `title` required
- `GET /api/communities/:communityId/threads` — public, 404 if community missing
- `GET /api/threads/:id` — public, `validateUUID('id')`
- Nested router via `mergeParams: true`, mounted twice (scoped + direct)

### Photos (`/api/photos`) ✅ Done
```
POST   /api/photos                    — upload photo to a thread (multipart, auth required)
GET    /api/photos/thread/:threadId   — list photos in a thread (public), validateUUID('threadId')
GET    /api/photos/:photoId/download  — recovery download (auth required), validateUUID('photoId')
```
- Magic byte validation on the raw upload
- Dual JPEG variants (download + thumb), both stripped of EXIF/GPS
- Free tier: 30 photos/user, `pg_advisory_xact_lock` + atomic conditional INSERT
- ML processing fire-and-forget — `201` returned immediately, `indexed=false` until ML finishes (now backstopped by the Queue.py poller if that initial call fails)
- `storage_key`/`storage_key_thumb` never returned to the client

### Search (`/api/search`) ✅ Done
```
POST /api/search           — validateUUID('thread_id', {source:'body'})
POST /api/search/download  — validateUUID('photo_ids', {source:'body', isArray:true})
POST /api/search/zip
```
- Community membership gate: 403 if the user isn't a member of the thread's community
- Rate limited via Redis: 5 searches per 10 min per user, atomic `INCR`+`EXPIRE`
- Embedding-existence check filters `active = true` — a deleted face registration is treated as "not registered," 422
- Results written to `photo_faces` (durable) + Redis (ephemeral, 10 min TTL, keyed by random UUID)
- `/download`: verifies every `photo_id` was part of that search session (403 otherwise); array + per-element UUID validated by middleware before the handler runs
- `/zip`: streams from R2 into an `archiver` zip, one photo in flight at a time; failures land in `skipped.txt` with a recovery URL

### Users (`/api/users`) ✅ Done
```
GET    /api/users/me                          — own profile, password never selected
POST   /api/users/me/face                     — register/update face (2–5 selfies)
GET    /api/users/me/photos                   — paginated match history
PATCH  /api/users/me/photos/:photoId/confirm  — confirm/reject a match, validateUUID('photoId')
DELETE /api/users/me/face                     — NEW: deactivates face registration (see below)
```
- `POST /me/face`: 2–5 selfies (`MIN_SELFIES=2`, `MAX_SELFIES=5`), magic-byte validated, calls ML `/index-user` (awaited). Re-registration reactivates (`active=true`) if previously deleted — the "is this an update?" check filters `active=true`, so a re-registering deleted user is treated as a fresh signup in the response message.
- `DELETE /me/face`: single `UPDATE ... SET active=false WHERE user_id=$1 AND active=true RETURNING id`. 404 if no active registration exists (double-delete is clean, not silent). Does **not** touch `photo_faces` or the user's own photo history — this stops future matching, it doesn't erase the past. Re-registering flips `active` back.
- `GET /me/photos`: joins `photo_faces → photos → threads → communities`, filters `confirmed IS NOT false`, paginated, short-TTL signed URLs.
- `PATCH /me/photos/:id/confirm`: body `{ action: 'confirm' | 'reject' }`, scoped by `user_id`.

---

## Shared Middleware

### `middleware/validate.js` — NEW, COMPLETE ✅
```js
validateUUID(fieldName, { source = 'params', required = true, isArray = false, maxItems })
```
- Replaces the old locally-duplicated `isValidUUID`/`UUID_REGEX` that only existed in `search.js`
- Applied to every route taking a UUID param or body field — see file tree above for the full list
- `isArray` mode validates every element and reports the first invalid one by index (`photo_ids[2] must be a valid UUID`)
- Runs before the handler — bad input never reaches Postgres, so it's a clean `400` instead of a raw DB error surfacing as `500`

⚠️ **This middleware briefly regressed on `communities.js` (`POST /:id/join`) and `photos.js` (`GET /thread/:threadId`, `GET /:photoId/download`) after a local file copy dropped the changes.** Re-applied and confirmed present as of this doc's sync. If you ever see a raw Postgres error instead of a clean 400 on a malformed ID on those specific routes, check that the `validateUUID` import and call are still there.

---

## lib/ml.js — COMPLETE ✅
```js
processPhoto(photoId, threadId, imageUrl)   // POST /process-photo
indexUser(userId, buffers, mimetypes)        // POST /index-user
search(userId, threadId, threshold=0.45)     // POST /search
```

## lib/r2.js — COMPLETE ✅
```js
uploadPhoto(buffer, mimetype, threadId, ext)
getSignedPhotoUrl(storageKey, expiresIn=3600)
deletePhoto(storageKey)
```

## lib/redis.js — COMPLETE ✅
```js
TTL = { SEARCH_RESULTS: 10min, SEARCH_ZIP: 30min, RATE_LIMIT: 10min }
SEARCH_RATE_LIMIT = 5
isRedisHealthy()
```
Redis being down degrades gracefully (search/download return 503) — does not crash the API.

## ml/db.py — get_connection() + get_redis()
`get_redis()` is a **separate Python-side Redis client** for RQ — distinct from Node's `ioredis` client in `lib/redis.js`. Same Redis container, two different client libraries, two different purposes (RQ job queue vs. Node rate-limiting/sessions).

---

## Tests — NEW, COMPLETE ✅ (62 passing)

No test framework added as a dependency — deliberately used what's built in:
- **Node:** `node:test` + `node:assert/strict` (Node 18+). Run: `node --test api/tests/*.test.js`
  - `api/tests/validate.test.js` (27) — every branch of `validateUUID`: params/body source, required/optional, array mode, `maxItems`, edge cases (empty string vs missing, case-insensitivity, wrong UUID version/variant nibbles)
  - `api/tests/auth.test.js` (9) — uses the **real** `jsonwebtoken` library (not mocked) to sign/verify tokens: valid token, missing header, wrong scheme, wrong secret, expired token, malformed token, a documented whitespace-parsing edge case
- **Python:** `unittest` (stdlib). Run: `python3 -m unittest discover -s ml/tests -v`
  - `ml/tests/test_search.py` (9) — `store_face_embeddings` (zero-faces path, bulk insert path, error-reraise-and-still-closes-connection), `upsert_user_embedding` (active=true on upsert), `search_faces` (active=true filter, ValueError on no embedding, correct query params)
  - `ml/tests/test_queue.py` (17) — `process_photo_job` success/failure paths, retry increment, `MAX_RETRIES` boundary, error message truncation, connection-closed-even-on-secondary-failure; consecutive-failure Redis counter (reset on success, alert at threshold and at every subsequent multiple, no alert between multiples); `poll_and_enqueue` query correctness, job dedup via `fetch_job`, skip-if-already-queued/running
  - Stubs `insightface`/`cv2` as fake modules before import — `Queue.py` transitively imports `face.py`, which imports those heavy CV libraries just to load; tests shouldn't need them installed
- Note: `node --test api/tests` (bare directory, no glob) didn't reliably auto-discover on this Node version in testing — use the explicit glob `api/tests/*.test.js`, or point VS Code's Test Explorer at the files directly.

---

## Key Patterns Used Across the Codebase

### pool.query() vs pool.connect()
`pool.query()` auto-releases after one query. `pool.connect()` is required for transactions/advisory locks — always `client.release()` in `finally`.

### Transaction pattern
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
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
```

### Atomic conditional insert (limit enforcement)
```sql
INSERT INTO photos (...)
SELECT $1, $2, 'pending', 'pending'
WHERE (SELECT COUNT(*) FROM photos WHERE uploaded_by = $2) < $3
RETURNING id
```

### Idempotent upsert pattern
```js
const result = await pool.query(`INSERT INTO ... ON CONFLICT (...) DO NOTHING RETURNING id`, [...]);
if (result.rows.length > 0) { /* only on real insert */ }
```

### Soft-delete / deactivation pattern (NEW — established with this round of changes)
```sql
UPDATE user_face_embeddings SET active = false WHERE user_id = $1 AND active = true RETURNING id
-- The "AND active = true" in WHERE makes a double-delete return zero rows (404),
-- not a silent no-op. Same shape as photos.indexed for the Queue.py retry query.
```
Use this instead of a cascading multi-table DELETE whenever the "real" delete would fan out across a table that scales with user activity (photo_faces, in this case).

### Shared UUID validation middleware (NEW)
```js
router.get('/:id', validateUUID('id'), handler);
router.post('/', validateUUID('thread_id', { source: 'body' }), handler);
router.post('/download', validateUUID('photo_ids', { source: 'body', isArray: true }), handler);
```
Don't reimplement `isValidUUID` locally in a route file — import this.

### Nested router pattern (mergeParams)
```js
const router = Router({ mergeParams: true });        // threads.js
router.use('/:communityId/threads', threadRoutes);    // communities.js
app.use('/api/threads', threadRoutes);                // index.js — second mount for direct lookup
```

### Controlled concurrency (mapWithConcurrency)
Used in `photos.js`, `users.js`, `search.js` for parallel signed-URL generation (concurrency cap 10).

### Magic byte validation
```
JPEG: FF D8 FF at offset 0
PNG:  89 50 4E 47 0D 0A 1A 0A at offset 0
WebP: 57 45 42 50 at offset 8
```

### Redis atomic rate limiting
```js
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, TTL.RATE_LIMIT);
if (count > LIMIT) return { allowed: false, retryAfter: await redis.ttl(key) };
```

### RQ job idempotency pattern (NEW)
```python
existing = queue.fetch_job(str(photo_id))
if existing and existing.get_status() in ("queued", "started", "deferred"):
    continue  # already in flight, don't double-enqueue
queue.enqueue(process_photo_job, ..., job_id=str(photo_id))
```

### Error forwarding
Always `next(err)` in catch blocks. Postgres codes: `23505` unique violation, `23503` FK violation.

---

## Business Rules (current)

- Face search is scoped to `thread_id` only — never global
- User must be a member of the thread's community to search it (403 otherwise)
- Users must submit 2–5 selfies before being indexed
- **Explicit consent capture for face registration is a deliberate skip, not an oversight** — discussed and explicitly deprioritized. There is still no consent field/checkbox anywhere in the API; "uploaded a selfie while authenticated" is currently the only signal. Revisit before any real launch.
- Anyone can upload photos to a thread (no restriction)
- Anyone authenticated can create a thread in any community (no admin gate)
- Free tier: 30 photo upload limit
- Search rate-limited: 5 per 10 minutes per user
- Download only allowed for users who appear in the photo (`photo_faces` row required)
- Cosine similarity match threshold: 0.45 (tunable per-request)
- Detection quality threshold: 0.7 (`det_score`)
- Result cap: 100 matches per search
- Model: `buffalo_l`, GPU inference
- **Deleting face registration (`DELETE /me/face`) stops future matching only** — it does not remove the user from photos they've already been matched in, and does not delete their own photo history

---

## Gotchas & Lessons Learned

- Schema uses `password` not `password_hash`
- Container names are lowercase: `vibemeet_db`, `vibemeet_redis`
- Postgres user/db in `docker-compose.yml` are lowercase `vibemeet` — verify your real `.env` matches
- **Two `.env.example` files now exist and have drifted from each other**: root `./.env.example` and `api/.env.example`. The `api/` one has an extra `API_BASE_URL` var and slightly different comments; the root one doesn't. Not resolved — pick one as canonical and delete the other, or keep them in sync manually for now.
- `sharp` bumped from `^0.34.2` to `^0.35.4` at some point — no known behavior change, just noting the version moved
- ES modules throughout — `"type": "module"`, `node --watch` instead of nodemon
- `pool.connect()` required for transactions/advisory locks; `pool.query()` can't hold a connection across queries
- `member_count` DEFAULT is 1, not 0 — creator auto-joins in the same transaction
- `mergeParams: true` required on any child router needing parent URL params
- Optional body fields must be coerced to `null` (`undefined` breaks `pg`)
- `multer` `fileFilter` only sees client-supplied Content-Type — always validate magic bytes
- `storage_key`/`storage_key_thumb` are internal — never returned to the client
- `ml/main.py`'s docstring still says "placeholder" — stale comment, file is fully implemented
- `auth.js`'s `header.split(' ')[1]` on a header with extra whitespace (`"Bearer  extra stuff"`) silently grabs an empty string rather than the intended token — still safely rejected by `jwt.verify`, just not for the reason you'd expect if you were debugging it. Found via the new test suite, not fixed (low priority — request would just fail auth either way).
- **`ml/.env` and `api/.env` are separate files** — easy to update one and forget the other exists
- `schema.sql` only runs on a **fresh** Docker volume — new columns added later need a manual `ALTER TABLE` on existing dev databases (see the block under "Database" above)
- Repair query if `member_count` diverges:
  ```sql
  UPDATE communities c SET member_count = (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id);
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
  "sharp": "^0.35.4"
}
```

### ml/requirements.txt (current)
```
fastapi, uvicorn, insightface==0.7.3, onnxruntime-gpu, opencv-python-headless,
numpy, psycopg2-binary, python-multipart, pydantic, python-dotenv, rq, redis, requests
```
`rq`/`redis` are no longer just declared-but-unused — `ml/Queue.py` actually uses both now.

For running the test suite specifically (not needed for the app itself): `pip install psycopg2-binary redis` if your venv doesn't already have them from the main requirements — `rq` is already there.

---

## Next Steps (in order — reflects real remaining work)

- [x] All backend routes (auth, communities, threads, photos, search, users)
- [x] GPU inference (CUDAExecutionProvider)
- [x] `.env` casing verified against `docker-compose.yml`
- [x] Redis + RQ background worker — `Queue.py` fully implemented, retry cap + alerting
- [x] Zero-faces bug fixed (photos no longer stuck at `indexed=false` forever)
- [x] `DELETE /api/users/me/face` — implemented as soft-delete (`active` flag), not full cascade
- [x] Shared UUID-validation middleware — implemented, applied everywhere, array support added
- [x] Unit test suite — 62 tests across both services
- [skip] **Explicit consent capture for face registration** — deliberately skipped, still needs a real decision before launch (checkbox? separate confirmation step? logged where?)
- [ ] Resolve the two divergent `.env.example` files
- [ ] Next.js frontend — still just two stub files, the only actual "not started" item left
- [ ] No external alert delivery for the worker's consecutive-failure `CRITICAL` logs (Slack/email/etc.) — logs only, for now

---

## Doc Sync Notes

This file was regenerated by reading the actual repository (routes, schema, docker-compose, package.json, requirements.txt, git log, and the new tests/ directories) rather than carried forward from memory. Everything marked ✅ above was independently verified against the code in this pass — not assumed from a previous doc version. If you're reading this in a future session: it's worth doing this kind of pass periodically, since a stale doc will cause a fresh Claude session to redo work that's already done, or worse, assume something is fixed when it silently regressed (see the UUID-middleware note above — that exact thing already happened once this round).
DOCEOF