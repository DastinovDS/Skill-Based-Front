#!/usr/bin/env bash
# Smoke test of the docker compose stack (OPS-01, #80), run from the repository root:
#
#   deploy/smoke.sh               # build, start, check, leave the stack running
#   HTTP_PORT=8080 deploy/smoke.sh  # if port 80 is busy locally
#
# Checks, all through Caddy: the client is served, /api/health answers, migrations ran,
# a guest created before `docker compose down` + `up` still exists afterwards (the volume keeps
# the database), and the server port is not published on the host. Then the Caddy checks of
# OPS-02 (#81): deploy/check-caddy.sh (headers, caching, routing) and deploy/check-ws-reload.sh
# (a WebSocket survives a Caddy reload; replaces `app` for a moment).
# Uses the compose project of compose.yaml; data in its volumes is kept (no `down -v`).
set -euo pipefail

base="http://localhost:${HTTP_PORT:-80}"
nick="smoke_$(date +%s)"

fail() {
	echo "FAIL: $*" >&2
	docker compose logs --tail 50 >&2 || true
	exit 1
}

echo "== build and start"
docker compose up --build --detach --wait --wait-timeout 180

echo "== client"
curl -fsS "$base/" | grep -q '<div id="app">' || fail "index.html is not served"

echo "== health"
[ "$(curl -fsS "$base/api/health")" = '{"status":"ok"}' ] || fail "/api/health"

echo "== migrations"
docker compose exec -T app python -c "
import sqlite3
rows = sqlite3.connect('/data/gow.db').execute('select version_num from alembic_version').fetchall()
assert rows, 'no alembic version'
print('alembic version', rows[0][0])
" || fail "migrations did not run"

echo "== guest"
token="$(curl -fsS -X POST "$base/api/guest" -H 'Content-Type: application/json' \
	-d "{\"nick\": \"$nick\"}" | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')" \
	|| fail "POST /api/guest"

echo "== restart (down + up keeps the volume)"
docker compose down
docker compose up --detach --wait --wait-timeout 120

echo "== guest survives the restart"
me="$(curl -fsS "$base/api/me" -H "Authorization: Bearer $token")" || fail "GET /api/me after restart"
echo "$me" | grep -q "\"$nick\"" || fail "unexpected /api/me: $me"

echo "== app port is internal"
[ -z "$(docker port "$(docker compose ps -q app)")" ] || fail "the app container publishes ports on the host"

echo "== Caddy: headers, caching, routing"
BASE_URL="$base" deploy/check-caddy.sh || fail "deploy/check-caddy.sh"

echo "== Caddy: WebSocket survives a config reload"
deploy/check-ws-reload.sh || fail "deploy/check-ws-reload.sh"

echo "OK: $base"
