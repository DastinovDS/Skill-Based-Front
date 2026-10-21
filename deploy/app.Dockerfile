# syntax=docker/dockerfile:1
# Image `app`: the game server (gow-server), one uvicorn worker (AGENTS.md, section 5.1).
# Build context: the repository root (see compose.yaml and .dockerignore).
#
# Base images are pinned by version and digest. To update: pick the new tag, then
#   docker buildx imagetools inspect <image>:<tag>   # the "Digest:" line
# The Python minor version must match .python-version and requires-python in pyproject.toml.

FROM ghcr.io/astral-sh/uv:0.12.21@sha256:a7aed3216253ee804de3e2d8afa5073baa1a177335345d43845cd4165e43b711 AS uv

FROM python:3.12.14-slim-trixie@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS build

COPY --from=uv /uv /usr/local/bin/uv

# The venv lives at its final path, so its scripts (gow-server) keep working after the copy.
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /src

# Layer 1: third-party dependencies only. It is rebuilt when uv.lock or a pyproject.toml changes,
# not on every source edit. uv needs every workspace member's pyproject.toml to check the lock.
COPY pyproject.toml uv.lock .python-version ./
COPY packages/sim/pyproject.toml packages/sim/
COPY packages/protocol/pyproject.toml packages/protocol/
COPY apps/server/pyproject.toml apps/server/
COPY apps/bots/pyproject.toml apps/bots/
COPY tools/maps/pyproject.toml tools/maps/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package gow-server --no-install-workspace

# Layer 2: the project packages gow-server needs, installed as regular (non-editable) packages,
# so the runtime image carries only the venv and no source tree.
COPY packages/ packages/
COPY apps/server/ apps/server/
COPY apps/bots/ apps/bots/
COPY tools/maps/ tools/maps/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package gow-server --no-editable


FROM python:3.12.14-slim-trixie@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS runtime

RUN groupadd --system --gid 10001 gow \
    && useradd --system --uid 10001 --gid gow --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin gow

# /data is the volume with everything the server writes: SQLite (gow.db, WAL files) and
# replays/. The ownership set here is copied into a new named volume on first mount.
# /app/data -> /data: settings whose default is relative to the working directory
# (sqlite:///data/gow.db, data/replays/) land on the volume as well.
RUN mkdir -p /data/replays /data/rulesets /app \
    && chown -R gow:gow /data \
    && ln -s /data /app/data

COPY --from=build /app/.venv /app/.venv
COPY maps/ /app/maps/
COPY rulesets/ /app/rulesets/

WORKDIR /app

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GOW_ENV=prod \
    GOW_HOST=0.0.0.0 \
    GOW_PORT=8000 \
    GOW_DATABASE_URL=sqlite:////data/gow.db \
    GOW_MAPS_DIR=/app/maps \
    GOW_RULESET_PATH=/app/rulesets/mvp-1.toml \
    GOW_RULESETS_DIR=/data/rulesets

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]

# gow-server always runs uvicorn with workers=1 (gow_server.cli); migrations run at startup.
CMD ["gow-server"]
