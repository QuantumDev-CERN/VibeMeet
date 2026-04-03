# VibeMeet

VibeMeet is scaffolded as a small monorepo with separate frontend, API, ML, and infrastructure layers.

## Structure

- `client/`: Next.js-style frontend app with auth, community, and selfie-search routes.
- `api/`: Node.js and Express-oriented backend structure for auth, community, thread, photo, and search APIs.
- `ml/`: Python FastAPI service scaffold for face embeddings, vector search, and job processing.
- `infra/`: Database schema and infrastructure-related setup.
- `docker-compose.yml`: Local Postgres and Redis services for development.
- `.env.example`: Shared environment variable placeholders.

## Notes

This repository currently contains only the requested scaffold and placeholder files. Framework bootstrapping, dependency installation, and service implementation can be added in the next pass.
