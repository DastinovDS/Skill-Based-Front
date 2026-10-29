# syntax=docker/dockerfile:1
# Image `caddy`: production build of the web client (apps/client) served by Caddy, which also
# proxies /api/* and /ws/* to the `app` service. Build context: the repository root.
#
# Base images are pinned by version and digest (update: see deploy/app.Dockerfile).
# The Node major version must satisfy "engines.node" in apps/client/package.json.

FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS client

# pnpm version comes from the "packageManager" field of package.json (corepack).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm
RUN corepack enable pnpm

# The production client loads the pool maps and their backgrounds from the server (#496); the dev
# screen bundles them (src/map/bundledMaps.ts), and the dev screen is not built. The one map file it
# bundles is the menu map behind the start screens (src/app/menuMap.ts, #474), outside the pool.
# The vector files of the maps with a geography (DEC-36, #544, `maps/geo/<id>.json`) are bundled too,
# one lazy chunk per map (src/map/geography.ts); the directory holds a .gitkeep until a map has one.
WORKDIR /repo/apps/client
COPY maps/menu/valley.json /repo/maps/menu/valley.json
COPY maps/geo/ /repo/maps/geo/

# Dependencies first: this layer is rebuilt only when the lockfile or package.json changes.
COPY apps/client/package.json apps/client/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY apps/client/ ./
# The client build, then the Content-Security-Policy header for Caddy, generated from
# apps/client/csp.ts (the single source of truth) and imported by deploy/Caddyfile.
# JSON.stringify gives a valid Caddyfile token; Node runs csp.ts directly (type stripping).
RUN pnpm build \
    && node --input-type=module \
        -e "import { CSP } from './csp.ts'; console.log('header Content-Security-Policy ' + JSON.stringify(CSP));" \
        > /repo/csp.caddy


FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b AS caddy-base

# The official binary carries the file capability cap_net_bind_service. With `cap_drop: [ALL]`
# (compose.yaml) the kernel refuses to exec such a file ("operation not permitted"), so the
# capability is removed; binding 80/443 relies on the sysctl in compose.yaml instead.
FROM caddy-base AS caddy-bin
# Throwaway stage: an unpinned tool package does not reach the runtime image.
# hadolint ignore=DL3018
RUN apk add --no-cache libcap-utils && setcap -r /usr/bin/caddy


FROM caddy-base AS runtime

COPY --from=caddy-bin /usr/bin/caddy /usr/bin/caddy

# Non-root: ports 80/443 are bound thanks to net.ipv4.ip_unprivileged_port_start=0 (compose.yaml).
# /data holds TLS certificates and the ACME account, /config the autosaved config: both are volumes.
RUN addgroup -S -g 10002 caddy \
    && adduser -S -D -H -u 10002 -G caddy -h /nonexistent -s /sbin/nologin caddy \
    && chown -R caddy:caddy /data /config

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=client /repo/csp.caddy /etc/caddy/csp.caddy
COPY --from=client /repo/apps/client/dist/ /srv/

USER 10002:10002
