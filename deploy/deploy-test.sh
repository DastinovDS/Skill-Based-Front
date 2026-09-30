#!/usr/bin/env bash
# Local check of deploy/deploy.sh, backup.sh and restore.sh (OPS-03, #82), from the repo root:
#
#   HTTP_PORT=8080 deploy/deploy-test.sh
#
# 1. deploy the working tree, create a guest;
# 2. deploy a copy whose server crashes at startup: deploy.sh must fail and roll back, the guest
#    must still exist;
# 3. backup, restore into a fresh volume (compose project gow-restore-test), the guest is there.
set -euo pipefail

export HTTP_PORT="${HTTP_PORT:-80}"
base="http://localhost:$HTTP_PORT"
fail() { echo "FAIL: $*" >&2; exit 1; }
me() { # token -> /api/me of the app in compose project $1, from inside the container
	docker compose -p "$1" exec -T app python -c "
import sys, urllib.request
req = urllib.request.Request('http://127.0.0.1:8000/api/me', headers={'Authorization': 'Bearer $2'})
print(urllib.request.urlopen(req, timeout=5).read().decode())"
}

echo "== 1. deploy"
deploy/deploy.sh
nick="dt$(date +%s)"
token="$(curl -fsS -X POST "$base/api/guest" -H 'Content-Type: application/json' \
	-d "{\"nick\": \"$nick\"}" | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')"

echo "== 2. broken release rolls back"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; docker compose -p gow-restore-test down --volumes >/dev/null 2>&1 || true' EXIT
git ls-files -z -co --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$tmp"
echo 'raise SystemExit("simulated broken release")' >>"$tmp/apps/server/src/gow_server/cli.py"
if (cd "$tmp" && DEPLOY_WAIT_TIMEOUT=40 deploy/deploy.sh); then fail "broken release deployed"; fi
me skill-based-front "$token" | grep -q "\"$nick\"" || fail "guest lost after rollback"
[ "$(curl -fsS "$base/api/health")" = '{"status":"ok"}' ] || fail "health after rollback"

echo "== 3. backup and restore into a fresh volume"
archive="$(deploy/backup.sh manual | sed -n 's/^backup: \([^ ]*\) .*/\1/p')"
COMPOSE_PROJECT_NAME=gow-restore-test deploy/restore.sh "$archive" app
me gow-restore-test "$token" | grep -q "\"$nick\"" || fail "guest missing after restore"

echo "OK: deploy, rollback, backup and restore"
