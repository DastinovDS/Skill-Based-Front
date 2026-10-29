#!/usr/bin/env bash
# Online backup of the `gow-data` volume (OPS-03, #82; replays incremental since SRV-08, #515).
# Run from the repo root:
#
#   deploy/backup.sh [label]      # label: nightly (default), predeploy, manual, ...
#
# Two parts:
#   1. $BACKUP_DIR/gow-<UTC time>-<label>.tar.gz: the SQLite database only (VACUUM INTO, safe
#      while the server runs, WAL included). It is small, so BACKUP_KEEP archives per label are cheap.
#   2. $BACKUP_DIR/replays/: a mirror of the replay files. Replay files never change once written,
#      so only the files modified since the previous run are copied; files the server's retention
#      removed (GOW_REPLAY_RETENTION_DAYS) are removed from the mirror too. The first run copies all.
#
# BACKUP_DIR (default ./backups) and BACKUP_KEEP (default 14, newest archives kept per label)
# may be set in the environment or in .env. Offsite copy: docs/ops/deploy.md.
# BACKUP_CMD replaces the call into the container (a command that runs
# `python -m gow_server.backup`; used by the shell tests, apps/server/tests/test_backup_script.py).
set -euo pipefail

label="${1:-nightly}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_KEEP:-14}"
mirror="$dir/replays"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/gow-$(date -u +%Y%m%dT%H%M%SZ)-$label.tar.gz"

# exec into the running server, or a one-off container on the same volume if it is stopped.
if [ -n "${BACKUP_CMD:-}" ]; then
	gow_backup() { $BACKUP_CMD "$@"; }
elif [ -n "$(docker compose ps -q --status running app)" ]; then
	gow_backup() { docker compose exec -T app python -m gow_server.backup "$@"; }
else
	gow_backup() { docker compose run --rm --no-deps -T app python -m gow_server.backup "$@"; }
fi

# 1. The database first: a replay file is written before the database row names it, so the copy
# of the replays below, taken later, holds every file this snapshot refers to.
gow_backup create >"$file.partial"
tar -tzf "$file.partial" | grep -x gow.db >/dev/null || { echo "FAIL: $file.partial has no gow.db" >&2; exit 1; }
mv "$file.partial" "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"

# 2. The replays. The stamp is taken before the copy and set back two minutes (clock skew, a log
# that was still being written): the next run copies everything modified after it.
mkdir -p "$mirror"
chmod 700 "$mirror"
since=0
if [ -f "$mirror/.last-sync" ]; then since="$(cat "$mirror/.last-sync")"; fi
stamp=$(($(date +%s) - 120))
gow_backup replays --since "$since" | tar -xf - -C "$mirror"
names="$(mktemp)"
trap 'rm -f "$names"' EXIT
gow_backup replay-names | LC_ALL=C sort >"$names"
removed=0
while IFS= read -r name; do
	rm -f -- "$mirror/$name"
	removed=$((removed + 1))
done < <(cd "$mirror" && ls -1 | LC_ALL=C sort | LC_ALL=C comm -13 "$names" -)
echo "$stamp" >"$mirror/.last-sync"
echo "replays: mirror $mirror ($(find "$mirror" -type f ! -name .last-sync | wc -l | tr -d ' ') files, $removed removed)"

# Retention: keep the newest $keep archives of this label.
find "$dir" -maxdepth 1 -name "gow-*-$label.tar.gz" | sort -r | tail -n "+$((keep + 1))" | xargs -r rm -f --
