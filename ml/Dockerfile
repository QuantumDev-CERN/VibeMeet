# syntax=docker/dockerfile:1

# ---- build stage -------------------------------------------------------------
# The full python image ships gcc, which insightface's source distribution needs.
FROM python:3.12 AS build
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
# CPU-only onnxruntime, no dev tools.
RUN uv sync --frozen --no-dev --no-default-groups --group cpu

# Bake buffalo_l into the image so a cold start never downloads anything.
# Only det_10g (detection) and w600k_r50 (recognition) are used, so drop the rest:
# 326 MB -> 183 MB, with bit-identical embeddings.
RUN /app/.venv/bin/python -c "from insightface.utils.storage import ensure_available; ensure_available('models', 'buffalo_l', root='/models')" \
 && rm -f /models/models/buffalo_l.zip \
 && cd /models/models/buffalo_l \
 && rm -f 1k3d68.onnx 2d106det.onnx genderage.onnx

# ---- runtime stage -----------------------------------------------------------
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /models /models
COPY main.py face.py search.py db.py models.py ./

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    VIBEMEET_ML_DEVICE=cpu \
    INSIGHTFACE_ROOT=/models \
    ORT_THREADS=1 \
    ML_MAX_CONCURRENT=1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
