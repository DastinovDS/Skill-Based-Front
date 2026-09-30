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
# Match draining (no new matches, wait for running ones) needs the match manager: TODO(#47).
# DEPLOY_BASE_URL (default http://localhost:$HTTP_PORT; on the server https://<DOMAIN>) and
# DEPLOY_WAIT_TIMEOUT (seconds, default 120) may be set in the environment or in .env.
set -euo pipefail

ref="${1:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
base="${DEPLOY_BASE_URL:-http://localhost:${HTTP_PORT:-80}}"
wait_s="${DEPLOY_WAIT_TIMEOUT:-120}"
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
