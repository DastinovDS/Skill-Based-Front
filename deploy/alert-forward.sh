#!/usr/bin/env bash
# Forwards the server's alerts to a webhook (OPS-04, #83). The server logs an alert as one JSON
# line with an "alert" field (gow_server/alerts.py: match_crashed, tick_lag); the `app` container
# has no route to the outside, so this host-side script reads the container log and POSTs each
# alert line (Content-Type: application/json, the log record as the body) to ALERT_WEBHOOK_URL.
# Run from the repo root:
#
#   deploy/alert-forward.sh        # follows `docker compose logs app` (new lines only)
#   deploy/alert-forward.sh -      # reads log lines from stdin (tests, other log sources)
#
# ALERT_WEBHOOK_URL may be set in the environment or in .env. It is a secret: it is given to curl
# on stdin, never as an argument, and never printed. Install as a service:
# deploy/systemd/gow-alerts.service, docs/ops/deploy.md, section "Наблюдаемость".
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${ALERT_WEBHOOK_URL:?set ALERT_WEBHOOK_URL (environment or .env)}"

post() {
	if ! printf 'url = "%s"\n' "$ALERT_WEBHOOK_URL" \
		| curl -sS --fail --max-time 10 -K - -H 'Content-Type: application/json' --data-binary "$1" -o /dev/null; then
		echo "alert-forward: delivery failed" >&2
	fi
}

if [ "${1:-}" = "-" ]; then
	source_cmd=(cat)
else
	source_cmd=(docker compose logs --follow --no-log-prefix --since 0s app)
fi

"${source_cmd[@]}" | while IFS= read -r line; do
	case "$line" in
	'{'*'"alert": "'*) post "$line" ;;
	esac
done
