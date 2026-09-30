#!/usr/bin/env bash
# Restore the `gow-data` volume from an archive of deploy/backup.sh (OPS-03, #82):
#
#   deploy/restore.sh backups/gow-...tar.gz
#
# Stops `app`, replaces the database and replays (the archive is checked first: integrity_check
# and applied migrations), starts the stack again. A fresh volume (new machine) works the same way.
# COMPOSE_PROJECT_NAME=<other> restores into another compose project (deploy/deploy-test.sh).
set -euo pipefail

archive="${1:?usage: deploy/restore.sh <archive.tar.gz>}"
[ -f "$archive" ] || { echo "no such file: $archive" >&2; exit 1; }

docker compose stop app
docker compose run --rm --no-deps -T app python -m gow_server.backup restore <"$archive"
docker compose up --detach --no-build --wait --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-120}" "${@:2}"
echo "restored from $archive"
