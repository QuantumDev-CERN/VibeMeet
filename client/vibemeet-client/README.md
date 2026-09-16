# VibeMeet — client

Next.js (App Router, JavaScript) frontend for the VibeMeet API in `../api`.

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local if your API isn't on http://localhost:3001
npm run dev
```

Open http://localhost:3000. The API (`../api`) and its Postgres/Redis containers
must be running for anything beyond the empty-state screens to work.

## Structure

- `app/` — routes (App Router). Every page that needs auth or live data is a
  Client Component (`'use client'`) fetching from the Express API directly —
  there's no server-side data layer here, by design, since the API already
  owns all business logic and auth.
- `components/` — shared UI: nav, cards, the upload widget, the face-search
  panel pieces, the profile/match-history pieces.
- `lib/api.js` — every backend call in one place. If a route in `api/src/routes`
  changes shape, this is the only file that should need to change on the
  frontend side.

## Pages → API routes

| Page | Calls |
|---|---|
| `/` | `GET /api/communities` |
| `/login`, `/register` | `POST /api/auth/login`, `POST /api/auth/register` |
| `/communities/new` | `POST /api/communities` |
| `/c/[slug]` | `GET /api/communities/:slug`, `GET /api/communities/:id/threads`, `POST /api/communities/:id/join` |
| `/c/[slug]/new-thread` | `POST /api/communities/:communityId/threads` |
| `/c/[slug]/t/[threadId]` | `GET /api/threads/:id`, `GET /api/photos/thread/:threadId`, `POST /api/photos`, `POST /api/search`, `POST /api/search/download`, `POST /api/search/zip` |
| `/me` | `GET /api/users/me/photos`, `POST /api/users/me/face`, `DELETE /api/users/me/face`, `PATCH /api/users/me/photos/:id/confirm` |

## Known gaps (matches the API's current state, per Claude.md)

- No consent checkbox on face registration — the API doesn't have one yet either.
- Search rate limiting (5 / 10 min) and the 10-minute Redis session TTL on
  search results are surfaced as plain error messages, not a countdown timer.
- No SSR/ISR for the public community and thread pages — everything fetches
  client-side. Fine for an MVP; worth revisiting if SEO on public community
  pages ever matters.
