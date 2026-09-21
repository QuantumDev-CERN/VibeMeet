# VibeMeet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](./api)
[![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](./ml)
[![Postgres](https://img.shields.io/badge/postgres-16_+_pgvector-4169E1?logo=postgresql&logoColor=white)](./infra/schema.sql)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)

**Reddit-style event communities with face recognition photo search.**

VibeMeet lets communities organize events ("threads"), crowdsource photos from
everyone attending, and then lets each person find *themselves* in those
photos by submitting a few selfies. Face matching is powered by GPU inference
(InsightFace `buffalo_l`) with embeddings stored in Postgres + pgvector.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [ML Service](#ml-service)
- [Photo Pipeline](#photo-pipeline)
- [Face Search Flow](#face-search-flow)
- [Storage](#storage)
- [Database](#database)
- [Privacy](#privacy)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Communities** — persistent groups (e.g. "IIIT Sonepat CS 2027", "Tito's Bar
  Regulars") with URL-friendly slugs, membership, and roles.
- **Event threads** — one thread per event inside a community; photos belong to
  threads.
- **Crowdsourced photo uploads** — anyone can upload to a thread. Uploads are
  validated (magic bytes), stripped of EXIF/GPS, and stored in two variants:
  a full-res download copy and a lightweight thumbnail.
- **"Find me" face search** — register 2–5 selfies, then search any thread's
  photos for yourself. Matching is cosine similarity over pgvector embeddings,
  scoped to a single thread, with detection-quality filtering.
- **Durable match history** — search results are recorded (`photo_faces`) so
  users get a persistent "my photos" feed; confirm/reject individual matches.
- **Background processing with retries** — ML indexing runs async with a
  poller + RQ worker that retries stuck photos up to 5 times and logs a
  `CRITICAL` alert on consecutive systemic failures.
- **Rate limiting** — face search is capped (5 per 10 minutes per user) via
  atomic Redis counters.
- **Soft-delete by design** — deactivating face registration is a single-row
  flag flip, not a cascading delete.
- **Provider-agnostic object storage** — MinIO for local dev, Backblaze B2 for
  deployed, swap via `.env` only.

---

## Architecture

```mermaid
flowchart LR
    client[Next.js client]
    api[Express API]
    ml[FastAPI ML service]
    queue[Queue poller and RQ worker]
    pg[Postgres 16 with pgvector]
    redis[Redis 7]
    s3[S3 storage - MinIO or B2]

    client --> api
    api --> ml
    api --> pg
    api --> redis
    api --> s3
    ml --> pg
    queue --> pg
    queue --> redis
    queue --> s3
```

**Data model (mental model):**

```
Community (persistent group)
  └── Thread (a single event)
        └── Photos (uploaded by anyone attending)
              └── Face embeddings (extracted by ML, scoped to thread_id)
```

Search is always "find me in *this thread's* photos" — never global.

---

## Repository Structure

```
VibeMeet/
├── client/vibemeet-client/   # Next.js 16 (App Router) frontend
│   ├── app/                  # routes: auth, communities, threads, /me
│   ├── components/           # cards, upload panel, face registration
│   └── lib/api.js            # API client
├── api/                      # Node.js + Express 5 API (ESM)
│   └── src/
│       ├── index.js          # app bootstrap, all 6 routers mounted
│       ├── db.js             # pg connection pool
│       ├── middleware/       # JWT auth, shared UUID validation
│       ├── routes/           # auth, users, communities, threads, photos, search
│       ├── lib/              # storage (S3), ml client, redis client
│       └── scripts/verify-storage.js  # end-to-end storage health check
├── ml/                       # Python FastAPI ML service (uv, Python 3.12)
│   ├── main.py               # /health, /process-photo, /index-user, /search
│   ├── face.py               # InsightFace buffalo_l, CUDA inference
│   ├── search.py             # cosine similarity + quality filters
│   ├── Queue.py              # retry poller + RQ job definitions
│   └── pyproject.toml        # uv project, gpu/cpu dependency groups
├── infra/schema.sql          # Postgres schema (8 tables, pgvector)
├── docs/STORAGE.md           # MinIO / Backblaze B2 setup guide
└── docker-compose.yml        # Postgres, Redis, MinIO (+ one-shot bucket init)
```

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose (Postgres,
  Redis, MinIO)
- [Node.js](https://nodejs.org/) 18+
- [uv](https://docs.astral.sh/uv/) (Python 3.12 is downloaded automatically)
- NVIDIA GPU + driver for ML inference (CPU fallback available, see below)

---

## Quick Start

### 1. Start the infrastructure

```bash
docker compose up -d
```

This boots:

| Service | Container | Port |
|---|---|---|
| Postgres 16 + pgvector | `vibemeet_db` | 5432 |
| Redis 7 | `vibemeet_redis` | 6379 |
| MinIO (S3 API) | `vibemeet_minio` | 9000 (console: 9001) |
| Bucket bootstrap (one-shot) | `vibemeet_minio_init` | — |

`infra/schema.sql` runs automatically on first container creation. MinIO console:
http://localhost:9001 (`vibemeet` / `vibemeet123`).

### 2. Configure the API

```bash
cd api
cp .env.example .env   # edit values as needed
npm install
npm run verify:storage # checks MinIO is reachable and writable
npm run dev            # node --watch on http://localhost:3001
```

### 3. Configure the ML service

```bash
cd ml
cp ../api/.env .env    # ml needs DATABASE_URL and REDIS_URL at minimum
uv sync                                  # GPU build of ONNX Runtime (default)
# uv sync --no-group gpu --group cpu      # ...or CPU-only machines

uv run uvicorn main:app --reload --port 8000
```

In a second terminal (background processing):

```bash
uv run python Queue.py                             # poller: re-enqueues stuck photos
uv run rq worker photo-processing --url $REDIS_URL # RQ worker: does the actual work
```

### 4. Configure the client

```bash
cd client/vibemeet-client
npm install
cp .env.local.example .env.local   # edit if the API isn't on http://localhost:3001
npm run dev                          # http://localhost:3000
```

---

## Environment Variables

`api/.env.example` is canonical. The ML service needs its own `ml/.env` with at
least `DATABASE_URL` and `REDIS_URL`.

| Variable | Default (local) | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://vibemeet:vibemeet@localhost:5432/vibemeet` | Postgres connection |
| `JWT_SECRET` | — (set your own) | Signs auth tokens |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `PORT` | `3001` | API listen port |
| `ML_SERVICE_URL` | `http://localhost:8000` | ML service base URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `CLIENT_ORIGIN` | `http://localhost:3000` | CORS origin |
| `S3_ENDPOINT` | `http://localhost:9000` | S3-compatible endpoint |
| `S3_REGION` | `us-east-1` | Storage region |
| `S3_ACCESS_KEY_ID` | `vibemeet` | Storage credentials |
| `S3_SECRET_ACCESS_KEY` | `vibemeet123` | Storage credentials |
| `S3_BUCKET` | `vibemeet-photos` | Bucket name |
| `S3_PUBLIC_URL` | `http://localhost:9000/vibemeet-photos` | Public base URL for stored photos |
| `S3_FORCE_PATH_STYLE` | `true` | Required by MinIO |

For a deployed setup, swap the `S3_*` values for Backblaze B2 — see
[docs/STORAGE.md](./docs/STORAGE.md).

---

## API Reference

All routes are prefixed with `/api`. Authenticated routes expect
`Authorization: Bearer <token>`.

### Auth — `/api/auth`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/register` | — | Create user, returns JWT + user object |
| POST | `/login` | — | Validate credentials, returns JWT + user object |

### Users — `/api/users`

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/me` | ✅ | Own profile (password never selected) |
| POST | `/me/face` | ✅ | Register/update face (2–5 selfies) |
| GET | `/me/photos` | ✅ | Paginated match history |
| PATCH | `/me/photos/:photoId/confirm` | ✅ | Confirm or reject a match |
| DELETE | `/me/face` | ✅ | Deactivate face registration (soft-delete) |

### Communities — `/api/communities`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/` | ✅ | Create community (`name` + `description` required; transactional) |
| GET | `/` | — | List communities |
| GET | `/:slug` | — | Get community by slug |
| POST | `/:id/join` | ✅ | Join community (idempotent) |
| DELETE | `/:id` | ✅ | Delete community |

### Threads — `/api/communities/:communityId/threads` and `/api/threads`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/communities/:communityId/threads` | ✅ | Create thread in a community (only `title` required) |
| GET | `/api/communities/:communityId/threads` | — | List threads in a community |
| GET | `/api/threads/:id` | — | Get thread by ID |
| DELETE | `/api/threads/:id` | ✅ | Delete thread |

### Photos — `/api/photos`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/` | ✅ | Upload photo to a thread (multipart) |
| GET | `/thread/:threadId` | — | List photos in a thread |
| GET | `/:photoId/download` | ✅ | Recovery download |

### Search — `/api/search`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/` | ✅ | Find yourself in a thread's photos |
| POST | `/download` | ✅ | Download matched photos (verifies search session) |
| POST | `/zip` | ✅ | Download matches as a streamed zip |

**Search guards:** you must be a member of the thread's community (403
otherwise), you must have registered a face (422 otherwise), and search is
rate-limited to 5 per 10 minutes per user.

---

## ML Service

FastAPI service in `ml/`, using InsightFace `buffalo_l` (512-dim embeddings).

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/process-photo` | Detect faces, store embeddings scoped to `thread_id` |
| POST | `/index-user` | Build an averaged identity vector from 2–5 selfies |
| POST | `/search` | Cosine similarity search within a thread |

- Inference runs on GPU via `CUDAExecutionProvider` (CUDA 13/cuDNN 9 ship
  inside `ml/.venv` via the `gpu` dependency group — no system CUDA needed).
- CPU-only machines: `uv sync --no-group gpu --group cpu`.
- Photos with zero detected faces are marked `indexed=true, face_count=0`
  (not left pending forever).
- Match quality is two-stage: `similarity > 0.45` (configurable) **and**
  `det_score > 0.7`, capped at 100 results.

---

## Photo Pipeline

```mermaid
flowchart TD
    upload[POST /api/photos - multipart upload]
    magic[Magic-byte validation]
    sharp[sharp makes 2 variants, EXIF stripped]
    s3[Upload variants to S3 bucket]
    db[Insert photos row with indexed=false]
    http[201 Created - returns immediately]
    fire[Fire-and-forget POST to ML service]
    poller[Queue.py poller - every 30s]
    worker[RQ worker processes the photo]
    embed[Face embeddings stored, indexed=true]

    upload --> magic --> sharp --> s3 --> db --> http
    db --> fire --> worker
    db --> poller --> worker
    worker --> embed
```

Uploads return `201` immediately; ML indexing happens asynchronously. If the
initial ML call fails, the poller picks the photo back up and retries (max 5
attempts), so nothing silently stalls.

---

## Face Search Flow

```mermaid
sequenceDiagram
    participant U as User
    participant API as Express API
    participant ML as ML service
    participant PG as Postgres
    participant R as Redis

    U->>API: register face with selfies
    API->>ML: POST /index-user
    ML->>PG: store identity vector
    U->>API: search a thread
    API->>R: rate limit check
    API->>ML: POST /search
    ML->>PG: cosine similarity, thread-scoped
    ML-->>API: matches
    API->>PG: write photo_faces rows
    API->>R: cache session for 10 min
    API-->>U: match list and session id
```

---

## Storage

`api/src/lib/storage.js` is provider-agnostic — switching providers is a
`.env` change, not a code change.

| Setup | Provider | When |
|---|---|---|
| Local dev | **MinIO** (self-hosted, in docker-compose) | No signup, no card |
| Deployed | **Backblaze B2** (10 GB free, no card) | Closest to real S3 |

Full walkthrough, including bucket lifecycle rules and the AWS SDK checksum
gotcha: **[docs/STORAGE.md](./docs/STORAGE.md)**.

Verify your setup any time with:

```bash
cd api && npm run verify:storage
```

> **The bucket must be publicly readable.** `photos.url` is written to the
> database and fetched with no credentials by the ML service — including on
> retries hours after upload, when a presigned URL would have expired.
> Internal `storage_key` columns are never returned to clients, and the client
> is still served short-lived presigned URLs.

---

## Database

Postgres 16 with the [pgvector](https://github.com/pgvector/pgvector)
extension. Schema lives in `infra/schema.sql` (8 tables):

- `users`, `user_face_embeddings` (512-dim, `active` soft-delete flag)
- `communities`, `community_members` (denormalized `member_count`)
- `threads`, `photos` (dual storage keys, retry tracking columns)
- `face_embeddings` (512-dim, HNSW cosine index, scoped by `thread_id`)
- `photo_faces` (durable search matches; tri-state `confirmed`)

`schema.sql` runs only on a **fresh** Docker volume. If your local database
predates newer columns, apply the `ALTER TABLE` migrations noted in the schema
comments, or reset with `docker compose down -v && docker compose up -d`.

---

## Privacy

- **EXIF (including GPS) is stripped** from both photo variants at upload.
- Face search is **scoped to a single thread** — embeddings are never searched
  globally.
- You must be a **member of a thread's community** to search its photos.
- Deleting your face registration (`DELETE /me/face`) **stops future
  matching only** — it does not erase photos you've already been matched in.
- Explicit consent capture for face registration is currently the user's act of
  submitting selfies while authenticated; a formal consent step is still an
  open decision before any real launch.

---

## Roadmap

- [x] All backend routes (auth, communities, threads, photos, search, users)
- [x] GPU inference + background queue with retries
- [x] Next.js client (auth, communities, threads, upload, face registration, matches)
- [x] Provider-agnostic storage (MinIO local, Backblaze B2 deployed)
- [ ] Expanded automated test coverage
- [ ] Explicit consent capture for face registration (open decision)
- [ ] External alerting for worker failures (currently log-only)

---

## Contributing

1. Fork the repo and create a feature branch.
2. `docker compose up -d` for Postgres, Redis, and MinIO.
3. Run `npm run verify:storage` in `api/` after storage-related changes.
4. Keep new routes behind `validateUUID` for any UUID params/body fields.
5. Open a pull request with a clear description of the change.

---

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 QUANTUM.
