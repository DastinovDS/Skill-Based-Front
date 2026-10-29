#!/usr/bin/env bash
# Restore the `gow-data` volume from an archive of deploy/backup.sh (OPS-03, #82):
#
#   deploy/restore.sh backups/gow-...tar.gz
#
# Stops `app`, replaces the database and replays (the archive is checked first: integrity_check
# and applied migrations), starts the stack again. A fresh volume (new machine) works the same way.
# The replays come from the archive if it holds `replays/` (archives before SRV-08, #515), else
# from the mirror `replays/` next to the archive (the one backup.sh keeps up to date), which is
# mounted read-only into the one-off container. The mirror is as new as the last backup, not as
# the archive: a match played in between has its row in the database only if the archive is newer.
# COMPOSE_PROJECT_NAME=<other> restores into another compose project (deploy/deploy-test.sh).
set -euo pipefail

archive="${1:?usage: deploy/restore.sh <archive.tar.gz>}"
[ -f "$archive" ] || { echo "no such file: $archive" >&2; exit 1; }
mirror="$(cd "$(dirname "$archive")" && pwd)/replays"
args=()
if [ -d "$mirror" ]; then
	args=(-v "$mirror:/restore-replays:ro")
	extra=(--replays-from /restore-replays)
else
	echo "warning: no replay mirror $mirror; the restored server has no replay files" >&2
	extra=()
fi

docker compose stop app
docker compose run --rm --no-deps -T ${args[@]+"${args[@]}"} app python -m gow_server.backup restore ${extra[@]+"${extra[@]}"} <"$archive"
docker compose up --detach --no-build --wait --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-120}" "${@:2}"
echo "restored from $archive"
