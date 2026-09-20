# VibeMeet

VibeMeet is scaffolded as a small monorepo with separate frontend, API, ML, and infrastructure layers.

## Structure

- `client/`: Next.js-style frontend app with auth, community, and selfie-search routes.
- `api/`: Node.js and Express-oriented backend structure for auth, community, thread, photo, and search APIs.
- `ml/`: Python FastAPI service scaffold for face embeddings, vector search, and job processing.
- `infra/`: Database schema and infrastructure-related setup.
- `docker-compose.yml`: Local Postgres and Redis services for development.
- `.env.example`: Shared environment variable placeholders.

## Running the ML service (uv)

The `ml/` service uses [uv](https://docs.astral.sh/uv/) (`pyproject.toml` + `uv.lock`); there is no `requirements.txt`. uv downloads the pinned Python (3.12) itself and creates `ml/.venv` on first run.

```bash
cd ml
uv sync                                  # install locked deps (GPU build of ONNX Runtime, the default)
uv sync --no-group gpu --group cpu       # ...or CPU-only machines

uv run uvicorn main:app --reload --port 8000        # FastAPI service
uv run python Queue.py                              # poller
uv run rq worker photo-processing --url $REDIS_URL  # RQ worker
uv run ruff check .                                 # lint (dev group)

uv add <package>                         # add a dependency (updates pyproject.toml + uv.lock)
uv lock --upgrade                        # refresh the lockfile to latest allowed versions
```

## Notes

This repository currently contains only the requested scaffold and placeholder files. Framework bootstrapping, dependency installation, and service implementation can be added in the next pass.
