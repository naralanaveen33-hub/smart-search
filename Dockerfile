# SwiftSearch API — production image.
#
# Build context is the repository root so .dockerignore can exclude the
# frontend explicitly; only backend/ is ever copied in.
#
#   docker build -t swiftsearch-api .
#   docker run --rm -p 8000:8000 --env-file backend/.env swiftsearch-api
#
# Nothing about the search engine lives here. BSBI, the tokenizer, blocks,
# external sort, k-way merge and BM25 are untouched by this file — the image
# only supplies a Python runtime, dependencies and a process to run them.

# ----------------------------------------------------------------- builder
# Dependencies are installed into a self-contained venv so the final stage
# copies one directory and inherits no pip cache or build toolchain.
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Only the runtime requirements. requirements-dev.txt (pytest) is deliberately
# never installed — test tooling has no place in a production image.
COPY backend/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# ---------------------------------------------------------------- runtime
FROM python:3.12-slim AS runtime

# PYTHONDONTWRITEBYTECODE: no .pyc litter on a read-only-ish layer.
# PYTHONUNBUFFERED: logs reach the platform's collector immediately rather
# than sitting in a buffer, which matters when debugging a container.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app \
    SWIFTSEARCH_DATA_DIR=/data

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# `app.main:app` resolves because backend/app lands at /app/app with
# PYTHONPATH=/app. data/ carries the bundled demo corpus used by the seed
# endpoint; it is never loaded automatically when SEED_DEMO_DOCUMENTS=false.
COPY backend/app ./app
COPY backend/data ./data

# The index, blocks and extracted-text cache are written at runtime. This
# directory is ephemeral on most hosts — document text survives in Supabase and
# AUTO_REBUILD_INDEX reconstructs the index on a cold start.
RUN useradd --create-home --uid 10001 swiftsearch \
    && mkdir -p /data \
    && chown -R swiftsearch:swiftsearch /data /app

USER swiftsearch

# Documentation only — the real port comes from $PORT at runtime.
EXPOSE 8000

# curl is not present in the slim image, so the check uses the interpreter
# that is guaranteed to be here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request,sys; \
url=f\"http://127.0.0.1:{os.environ.get('PORT','8000')}/api/health\"; \
sys.exit(0 if urllib.request.urlopen(url, timeout=4).status == 200 else 1)"

# `exec` replaces the shell so uvicorn becomes PID 1 and receives SIGTERM
# directly — without it the platform's stop signal never reaches the server and
# shutdown degrades into a kill. The shell is needed at all only to expand
# $PORT, which the platform sets at runtime.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
