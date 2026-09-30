#!/usr/bin/env bash
# Online backup of the `gow-data` volume (OPS-03, #82): SQLite via VACUUM INTO (safe while the
# server runs, WAL included) plus data/replays/, as one .tar.gz on the host. Run from the repo root:
#
#   deploy/backup.sh [label]      # label: nightly (default), predeploy, manual, ...
#
# BACKUP_DIR (default ./backups) and BACKUP_KEEP (default 14, newest archives kept per label)
# may be set in the environment or in .env. Offsite copy: docs/ops/deploy.md.
set -euo pipefail

label="${1:-nightly}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_KEEP:-14}"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/gow-$(date -u +%Y%m%dT%H%M%SZ)-$label.tar.gz"

# exec into the running server, or a one-off container on the same volume if it is stopped.
if [ -n "$(docker compose ps -q --status running app)" ]; then
	docker compose exec -T app python -m gow_server.backup create >"$file.partial"
else
	docker compose run --rm --no-deps -T app python -m gow_server.backup create >"$file.partial"
fi
tar -tzf "$file.partial" | grep -x gow.db >/dev/null || { echo "FAIL: $file.partial has no gow.db" >&2; exit 1; }
mv "$file.partial" "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"

# Retention: keep the newest $keep archives of this label.
find "$dir" -maxdepth 1 -name "gow-*-$label.tar.gz" | sort -r | tail -n "+$((keep + 1))" | xargs -r rm -f --
