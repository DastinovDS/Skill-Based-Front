#!/usr/bin/env bash
# Safe deploy of the compose stack on the server (OPS-03, #82). Run from the repo root:
#
#   deploy/deploy.sh [git-ref]    # e.g. origin/main or a tag; without a ref: the current checkout
#
# 1. checkout the ref (the working tree must be clean);
# 2. tag the images of the running stack as :previous, build the new ones;
# 3. pre-deploy backup (deploy/backup.sh predeploy);
# 4. switch: `up --wait` (container health checks), then GET $DEPLOY_BASE_URL/api/health;
# 5. on failure: rollback to the previous checkout and images, restore the pre-deploy backup
#    (the new version may have migrated the schema), start again, exit 1.
#
# Between 2 and 3 the running server is drained (SRV-02, #47): it starts no new matches, and the
# deploy waits until the running ones end, at most DEPLOY_DRAIN_TIMEOUT seconds (default 1200,
# a 15-minute match, DEC-22, plus margin); after that the remaining matches are cut by the switch.
# A server without the drain endpoint (older than #47) is not drained. If the deploy stops
# before the switch, draining is cancelled again.
# DEPLOY_BASE_URL (default http://localhost:$HTTP_PORT; on the server https://<DOMAIN>),
# DEPLOY_WAIT_TIMEOUT (seconds, default 120) and DEPLOY_DRAIN_TIMEOUT may be set in the
# environment or in .env.
set -euo pipefail

ref="${1:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
base="${DEPLOY_BASE_URL:-http://localhost:${HTTP_PORT:-80}}"
wait_s="${DEPLOY_WAIT_TIMEOUT:-120}"
drain_s="${DEPLOY_DRAIN_TIMEOUT:-1200}"
images=(app caddy)

is_git() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }
prev_rev=""
if is_git; then prev_rev="$(git rev-parse HEAD)"; fi

if [ -n "$ref" ]; then
	[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree is dirty" >&2; exit 1; }
	git fetch --tags origin
	git checkout --detach "$ref"
fi
echo "== deploy $(is_git && git rev-parse --short HEAD || echo 'working tree')"

# Before the build moves the :local tags: the images of the running stack become :previous.
echo "== remember running images"
have_previous=0
for s in "${images[@]}"; do
	if [ -n "$(docker compose ps -q "$s")" ]; then
		docker image tag "skill-based-front/$s:local" "skill-based-front/$s:previous"
		have_previous=1
	fi
done

echo "== build"
docker compose build

# The drain endpoint (gow_server.internal) answers only on the loopback interface of the
# container, so it is called from inside it. Exit codes: 0 drained, 3 timeout, other: no drain.
drain_py='
import json, sys, time, urllib.request
url, timeout_s = "http://127.0.0.1:8000/internal/drain", float(sys.argv[1])
def call(method):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.load(resp)
if sys.argv[2] == "undrain":
    call("DELETE")
    sys.exit(0)
status, deadline = call("POST"), time.monotonic() + timeout_s
while status["active"] > 0:
    if time.monotonic() > deadline:
        print("drain timeout, matches still running:", status["active"], flush=True)
        sys.exit(3)
    print("waiting for matches:", status["active"], flush=True)
    time.sleep(5)
    status = call("GET")
print("drained", flush=True)
'
drained=0
undrain() {
	if [ "$drained" = 1 ]; then
		docker compose exec -T app python -c "$drain_py" 0 undrain >/dev/null 2>&1 || true
	fi
}
if [ -n "$(docker compose ps -q app)" ]; then
	echo "== drain matches (at most ${drain_s}s)"
	trap undrain EXIT
	rc=0
	docker compose exec -T app python -c "$drain_py" "$drain_s" drain || rc=$?
	case "$rc" in
		0) drained=1 ;;
		3) drained=1; echo "WARN: drain timeout, the running matches will be cut" >&2 ;;
		*) echo "WARN: the running server cannot be drained (no drain endpoint?)" >&2 ;;
	esac
fi

backup=""
if [ -n "$(docker compose ps -q app)" ]; then
	echo "== pre-deploy backup"
	backup="$(deploy/backup.sh predeploy | sed -n 's/^backup: \([^ ]*\) .*/\1/p')"
	echo "$backup"
fi

healthy() {
	docker compose up --detach --no-build --wait --wait-timeout "$wait_s" \
		&& [ "$(curl -fsS -k --max-time 5 "$base/api/health")" = '{"status":"ok"}' ]
}

echo "== switch"
trap - EXIT  # the new container starts undrained; the old one is replaced
if healthy; then
	echo "OK: deployed, $base/api/health"
	exit 0
fi

echo "FAIL: new version is not healthy" >&2
docker compose logs --tail 30 app >&2 || true
[ "$have_previous" = 1 ] || { echo "no previous version to roll back to" >&2; exit 1; }

echo "== rollback"
if [ -n "$ref" ] && [ -n "$prev_rev" ]; then git checkout --detach "$prev_rev"; fi
for s in "${images[@]}"; do
	if docker image inspect "skill-based-front/$s:previous" >/dev/null 2>&1; then
		docker image tag "skill-based-front/$s:previous" "skill-based-front/$s:local"
	fi
done
if [ -n "$backup" ]; then
	DEPLOY_WAIT_TIMEOUT="$wait_s" deploy/restore.sh "$backup"
fi
if healthy; then
	echo "ROLLED BACK: previous version is running" >&2
else
	echo "ROLLBACK FAILED: see docs/ops/deploy.md" >&2
fi
exit 1
