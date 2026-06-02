# VibeMeet — Project Context for Claude

> Keep this file updated as the project progresses. Feed it at the start of every new chat.

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
| Frontend | Next.js | Not started |
| API | Node.js + Express | In progress |
| ML Service | FastAPI + InsightFace | ✅ Done |
| Database | PostgreSQL 16 + pgvector | ✅ Done |
| Storage | Cloudflare R2 | ✅ Done |
| Queue | Redis + RQ | Not started |

---

## Environment

- Machine: HP Folio 9470m, i5-3427U, 16GB DDR3, Fedora 43
- No GPU — CPUExecutionProvider everywhere
- Docker running postgres via `pgvector/pgvector:pg16`
- Python venv active for ML service

---

## ML Service — COMPLETE ✅

- Model: buffalo_l via InsightFace, auto-downloads on first run
- `/process-photo` — detects faces, stores 512-dim embeddings in pgvector
- `/index-user` — takes multiple selfies, builds averaged identity vector
- `/search` — cosine similarity search scoped to `thread_id`
- Tested: crowd photo returned 101 faces, embeddings stored, user photo retrieved successfully

---

## Database

**Docker container name:** `VibeMeet_db`
**Connection string:** `postgresql://VibeMeet:VibeMeet@localhost:5432/VibeMeet`
**Start DB:** `docker-compose up -d` from project root
**Reset DB (dev):** `docker-compose down -v && docker-compose up -d`

### Schema — 8 tables (with updates applied)

```sql
users (id UUID, email, username, password TEXT, avatar_url, created_at)
-- NOTE: column is 'password' not 'password_hash' — never use password_hash in queries

user_face_embeddings (id, user_id, embedding vector(512), selfie_count, created_at)

communities (id, name, slug, description, banner_url, created_by, member_count INT DEFAULT 1, created_at)
-- member_count is DENORMALIZED — do not compute via subquery at read time
-- DEFAULT 1 because creator auto-joins in the same transaction as community creation
-- Increment on join only if INSERT actually happened (check RETURNING rows.length)

community_members (user_id, community_id, role, joined_at)
-- PRIMARY KEY (user_id, community_id) — pair is unique
-- role defaults to 'member', creator gets 'admin'

threads (id, community_id, created_by, title, description, event_date, location, created_at)
-- description, event_date, location are all nullable — only title is required
-- event_date type: check schema.sql — if DATE, sending ISO datetime string truncates time silently

photos (id, thread_id, uploaded_by, storage_key, url, indexed, face_count, uploaded_at)
-- storage_key format: photos/{threadId}/{uuid}.{ext}
-- indexed=false until ML processes it — queue worker retries indexed=false rows
-- storage_key is NEVER returned to the client — internal implementation detail

face_embeddings (id, photo_id, thread_id, embedding vector(512), bbox, det_score, created_at)

photo_faces (photo_id, user_id, confidence, confirmed)
```

### Indexes
- HNSW index on `face_embeddings(embedding vector_cosine_ops)`
- Index on `face_embeddings(thread_id)`

### Key schema decisions
- `member_count` is a denormalized counter on `communities` — not computed via COUNT(*) subquery. At 20k+ concurrent reads a subquery-per-row approach would crash the DB. Counter is incremented atomically on join, only when a row is actually inserted (use `RETURNING` to detect conflict vs real insert).
- Slug is generated in JS (not SQL) — lowercase, trim, spaces→hyphens, strip non-alphanumeric. Needed immediately in response so JS layer is the right place.
- Transactions used for community creation: INSERT community + INSERT community_members (as admin) in one `BEGIN/COMMIT`. If either fails, both roll back — no orphaned community with no admin.
- `ON CONFLICT DO NOTHING` on community_members join — idempotent. Hitting join twice returns 200 both times, no duplicate row, no error.

---

## Directory Structure

```
VibeMeet/
├── client/                   # Next.js — not started
├── api/
│   ├── src/
│   │   ├── index.js          # Express app entry — ✅ Done
│   │   ├── db.js             # pg Pool — ✅ Done
│   │   ├── middleware/
│   │   │   └── auth.js       # JWT Bearer verify, attaches req.user — ✅ Done (bug fixed, see gotchas)
│   │   ├── routes/
│   │   │   ├── auth.js       # POST /register, POST /login — ✅ Done, tested
│   │   │   ├── users.js      # not started
│   │   │   ├── communities.js# ✅ Done, tested — also mounts threads router internally
│   │   │   ├── threads.js    # ✅ Done, tested — has one known bug, see gotchas
│   │   │   ├── photos.js     # ✅ Done — needs Postman testing
│   │   │   └── search.js     # not started
│   │   └── lib/
│   │       ├── r2.js         # ✅ Done — Cloudflare R2 upload + signed URLs
│   │       └── ml.js         # ✅ Done — axios wrapper for ML service
│   ├── package.json          # "type": "module", dev uses node --watch
│   └── .env                  # symlinked from root .env
├── ml/
│   ├── main.py
│   ├── face.py
│   ├── search.py
│   ├── models.py
│   ├── db.py
│   └── requirements.txt
├── infra/
│   └── schema.sql
├── docker-compose.yml
├── .env
└── CLAUDE.md
```

---

## .env Variables

```
DATABASE_URL=postgresql://VibeMeet:VibeMeet@localhost:5432/VibeMeet
JWT_SECRET=your_long_random_secret
PORT=3001
ML_SERVICE_URL=http://localhost:8000
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=gatherly-photos
R2_PUBLIC_URL=https://your-r2-public-url
```

---

## API Routes — Status

### Auth (`/api/auth`) ✅ Done + tested
- `POST /api/auth/register` — creates user, returns JWT + user object
- `POST /api/auth/login` — validates credentials, returns JWT + user object

### Communities (`/api/communities`) ✅ Done + tested

- `POST /` — create community (auth required)
  - Generates slug from name in JS
  - Transaction: INSERT community + INSERT community_members (role='admin')
  - member_count starts at DEFAULT 1
  - Returns 409 on duplicate name (Postgres error code 23505)
  - Slug bug note: special chars like `&` get stripped but surrounding spaces already became dashes → double dashes possible. Fix: add `.replace(/-+/g, '-')` at end of slug chain. Known, not blocking.

- `GET /` — list all communities
  - No auth required — public
  - Reads member_count directly from column, no subquery

- `GET /:slug` — get single community by slug
  - No auth required
  - 404 if not found

- `POST /:id/join` — join community (auth required)
  - Uses community UUID in path (not slug)
  - ON CONFLICT DO NOTHING — idempotent
  - Only increments member_count if RETURNING has rows (real insert, not conflict)
  - 404 if community not found

### Threads ✅ Done + tested

**Route structure decision:** threads use nested routing under communities for scoped endpoints, plus a separate direct lookup mount. This mirrors how Reddit scopes posts to subreddits.

```
POST   /api/communities/:communityId/threads   — create thread (auth required)
GET    /api/communities/:communityId/threads   — list threads in community (public)
GET    /api/threads/:id                        — get single thread by UUID (public)
```

**How it's wired:**
- `threads.js` uses `Router({ mergeParams: true })` — critical, without this `req.params.communityId` is undefined inside the child router because the param is defined on the parent path
- `communities.js` mounts threads internally: `router.use('/:communityId/threads', threadRoutes)`
- `index.js` mounts threads separately for direct lookup: `app.use('/api/threads', threadRoutes)`
- Same router file, two mount points

**POST create thread:**
- Only `title` is required. `description`, `event_date`, `location` are optional — pass `?? null` when inserting to avoid pg choking on `undefined`
- Verifies community exists first — returns 404 before hitting INSERT if not found
- No transaction needed — single INSERT, no multi-step operation
- Any authenticated user can create a thread, not just community creator/admin

**GET list threads:**
- Scoped to `communityId` from URL param
- Returns 404 if community doesn't exist (not empty array — client should know community is missing vs just having no threads)
- Ordered by `created_at DESC`

**GET single thread:**
- Direct UUID lookup, not community-scoped
- Returns full thread object including `community_id`
- 404 if not found

**Known rough edge:** passing a non-UUID string as `:communityId` or `:id` returns a raw 500 from Postgres UUID parse error. Future improvement: add UUID format validation middleware. Not blocking for now.

### Photos (`/api/photos`) ✅ Done — needs Postman testing

```
POST   /api/photos                    — upload photo to a thread (multipart, auth required)
GET    /api/photos/thread/:threadId   — list photos in a thread (public)
```

**POST upload photo:**
- Multipart fields: `file` (image), `thread_id` (UUID string)
- Magic byte validation — reads actual binary file signature, never trusts Content-Type header
  - JPEG: `FF D8 FF` at offset 0
  - PNG: `89 50 4E 47 0D 0A 1A 0A` at offset 0
  - WebP: `57 45 42 50` at offset 8
- Extension derived from detected mimetype via internal map — original filename discarded entirely (prevents path traversal)
- Free tier limit: 30 photos per user across all threads
  - Enforced with `pg_advisory_xact_lock` — serializes uploads per user, closes TOCTOU race
  - Lock key: `hashtext(userId)::bigint` — transaction-scoped, auto-releases on COMMIT/ROLLBACK
  - Atomic `INSERT ... SELECT ... WHERE COUNT < 30` — second layer of protection
- Photo row inserted as `storage_key='pending'` placeholder first to get UUID, then updated after R2 upload
- R2 cleanup on failure: if anything fails after R2 upload, `deletePhoto(storageKey)` called in catch block to prevent orphaned files
- ML triggered fire-and-forget (not awaited) — user gets 201 immediately, `indexed=false` until ML completes
- `storage_key` never returned to client

**GET list photos:**
- Returns `thumbnail_url` (permanent public R2 URL) + `download_url` (signed, 1hr expiry)
- Signed URLs generated with `mapWithConcurrency` at limit 10 — prevents hammering R2 with parallel requests
- `storage_key` never returned to client

**Photo row states (always valid):**
1. `storage_key='pending'` — upload in progress, advisory lock held
2. `storage_key='{real key}', indexed=false` — in R2, ML hasn't run yet
3. `storage_key='{real key}', indexed=true` — fully processed, embeddings stored

### Search (`/api/search`) — not started
- `POST /` — submit selfie, hit ML `/search`, return matched photos
- Scoped to `thread_id`

### Users (`/api/users`) — not started
- `GET /me` — get own profile (auth required)
- `POST /me/face` — submit 3-5 selfies to index face (auth required)
- Hits ML `/index-user`

---

## lib/ml.js — COMPLETE ✅

Axios wrapper for the ML service. Single `mlClient` instance with `baseURL` and 30s timeout.

```js
processPhoto(photoId, threadId, imageUrl)  // POST /process-photo
indexUser(userId, buffers, mimetypes)       // POST /index-user — multipart, uses form.getHeaders()
search(userId, threadId, threshold=0.45)    // POST /search
```

- `indexUser` uses `FormData` with `form.getHeaders()` — required to set correct `multipart/form-data; boundary=...` Content-Type. Without it axios sends `application/json` and FastAPI's `File(...)` gets nothing.
- `buffers` are raw Buffer arrays from multer memory storage — no temp files.

---

## lib/r2.js — COMPLETE ✅

AWS SDK S3 client pointed at Cloudflare R2 endpoint. R2 is S3-compatible, free egress.

```js
uploadPhoto(buffer, mimetype, threadId, ext)   // Upload to R2, returns { key, url }
getSignedPhotoUrl(storageKey, expiresIn=3600)  // Signed URL, default 1hr expiry
deletePhoto(storageKey)                         // Delete from R2 — used for orphan cleanup
```

- `ext` is passed explicitly from `photos.js` (derived from magic byte detection) — never from client header or filename
- Key format: `photos/{threadId}/{uuid}.{ext}` — namespaced by threadId for easy bulk deletion
- Uses `@aws-sdk/lib-storage` `Upload` class — streams in chunks, handles large files automatically
- Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`

---

## Key Patterns Used Across the Codebase

### pool.query() vs pool.connect()
- `pool.query()` — borrows a connection, runs one query, auto-releases. Use for single queries.
- `pool.connect()` — hold a connection manually. Required for transactions and advisory locks (multiple queries must run on same connection). Always `client.release()` in `finally`.

### Transaction pattern
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... multiple queries ...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release(); // ALWAYS — even on error
}
```

### Advisory lock pattern (per-user serialization)
```js
// Inside BEGIN/COMMIT transaction
await client.query(
  'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
  [userId]
);
// Now safe — all other requests from this user block until COMMIT/ROLLBACK
// Lock is transaction-scoped — auto-released, no manual unlock needed
// Never use pg_advisory_lock (session-scoped) in a connection pool — lock leaks on reuse
```

### Atomic conditional insert (limit enforcement)
```js
INSERT INTO photos (...)
SELECT $1, $2, 'pending', 'pending'
WHERE (SELECT COUNT(*) FROM photos WHERE uploaded_by = $2) < $3
RETURNING id
// rows.length === 0 means limit was hit, not an error
```

### Idempotent upsert pattern
```js
const result = await pool.query(
  `INSERT INTO ... VALUES (...) ON CONFLICT (...) DO NOTHING RETURNING id`,
  [...]
);
if (result.rows.length > 0) {
  // only runs if insert actually happened, not on conflict
}
```

### Nested router pattern (mergeParams)
```js
// child router — threads.js
const router = Router({ mergeParams: true }); // inherit params from parent path

// parent router — communities.js
import threadRoutes from './threads.js';
router.use('/:communityId/threads', threadRoutes);

// index.js — second mount for direct lookup
app.use('/api/threads', threadRoutes);
```

### Controlled concurrency (mapWithConcurrency)
```js
// In photos.js — used for parallel signed URL generation
async function mapWithConcurrency(items, limit, asyncFn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await asyncFn(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
// Use instead of Promise.all when calling external services in a loop
// index++ is atomic in single-threaded JS — no two workers grab the same index
// results[current] preserves original order regardless of completion order
```

### Magic byte validation
```js
// Never trust Content-Type header — validate actual file bytes
// JPEG: FF D8 FF at offset 0
// PNG:  89 50 4E 47 0D 0A 1A 0A at offset 0
// WebP: 57 45 42 50 at offset 8
// Extension always from internal ALLOWED_EXTENSIONS map, never from req.file.originalname
```

### Optional fields in INSERT
```js
// undefined breaks pg — coerce to null explicitly
[title, description ?? null, event_date ?? null, location ?? null]
```

### Error forwarding
Always `next(err)` in catch blocks — hits the global error handler in index.js.
Postgres-specific codes: `23505` = unique violation, `23503` = FK violation.

---

## Business Rules

- Face search is scoped to `thread_id` only — never global
- Users must submit 3–5 selfies and explicitly consent before being indexed
- Anyone can upload photos to a thread (no restriction)
- Anyone authenticated can create a thread in any community (no admin gate)
- Free tier: 30 photo upload limit (enforced atomically with advisory lock)
- Download only allowed for users who appear in the photo
- Cosine similarity match threshold: **0.45**
- Model: buffalo_l

---

## Gotchas & Lessons Learned

- Schema uses `password` not `password_hash` — never use `password_hash` in queries
- JWT: options is the **third** argument — `jwt.sign(payload, secret, { expiresIn: '7d' })`
- `expiresIn` is case sensitive — `expiresIN` silently breaks it
- Docker container is named `VibeMeet_db` (not the default compose-generated name)
- Always run `docker-compose up -d` before starting the API server
- ES modules in use — `"type": "module"` in package.json, use `import/export` not `require`
- `node --watch` used instead of nodemon (built into Node 18+)
- API `.env` is a symlink to root `.env` — if pool throws ECONNREFUSED, check docker first
- **auth.js bug (fixed):** `req.header.authorization` is wrong — `req.header` is a method. Correct is `req.headers.authorization` (headers is a property, the raw object).
- **threads.js bug (NOT YET FIXED):** `catch {err}` on the `GET /:id` handler is a syntax error — should be `catch (err)`. Will crash on any thread fetch error. Fix before testing photos.
- `pool.connect()` required for transactions and advisory locks — `pool.query()` auto-releases the connection so you can't hold it across multiple queries.
- `member_count` DEFAULT is 1 not 0 — creator auto-joins in same transaction, so by the time the row is visible there's already one member.
- Slug generated in JS not SQL — you need it immediately in the response; computing it in a RETURNING clause is messier.
- `mergeParams: true` is required on any child router that needs access to URL params defined in the parent's mount path. Forgetting this means `req.params.communityId` is silently `undefined`.
- Optional body fields (`description`, `event_date`, `location`) must be coerced to `null` before passing to pg — `undefined` causes a query error.
- Passing a non-UUID string to any route expecting a UUID param returns a raw 500 from Postgres. Future fix: UUID validation middleware.
- Never use `pg_advisory_lock` (session-scoped) in a connection pool — if the connection is reused without unlocking, the next user of that connection inherits the lock. Always use `pg_advisory_xact_lock` (transaction-scoped).
- `multer` fileFilter only sees client-supplied Content-Type — useless for security. Always validate with magic bytes after you have the buffer.
- `storage_key` is an internal implementation detail — never include it in any API response.
- If member_count diverges from actual community_members count, repair with:
  ```sql
  UPDATE communities c SET member_count = (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id);
  ```
- Queue worker retry query for unprocessed photos:
  ```sql
  SELECT id, url FROM photos WHERE indexed = false ORDER BY uploaded_at ASC;
  ```

---

## Dependencies (api/package.json)

```json
{
  "axios": "^1.7.9",
  "bcrypt": "^6.0.0",
  "dotenv": "^17.4.0",
  "express": "^5.2.1",
  "jsonwebtoken": "^9.0.3",
  "multer": "^2.1.1",
  "pg": "^8.20.0",
  "@aws-sdk/client-s3": "latest",
  "@aws-sdk/lib-storage": "latest",
  "@aws-sdk/s3-request-presigner": "latest"
}
```

---

## Next Steps (in order)

- [x] Postman test all communities.js endpoints
- [x] `threads.js` — create, list by community, get single — Done + tested
- [x] `lib/ml.js` — axios wrapper for ML service
- [x] `lib/r2.js` — Cloudflare R2 upload + signed URLs
- [x] `photos.js` — multipart upload, magic byte validation, advisory lock, R2, ML fire-and-forget
- [ ] **Fix `threads.js` bug** — `catch {err}` → `catch (err)` on GET /:id handler
- [ ] **Postman test `photos.js`** — follow PHOTO_TEST_PLAN.md
- [ ] `search.js` — face search endpoint
- [ ] `users.js` — profile + selfie submission (GET /me, POST /me/face)
- [ ] Redis + RQ for async photo processing (retry indexed=false rows)
- [ ] Next.js frontend
