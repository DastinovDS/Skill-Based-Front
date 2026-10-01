#!/usr/bin/env bash
# A match WebSocket through Caddy survives a Caddy config reload (OPS-02, #81: stream_close_delay
# in deploy/Caddyfile), checked against the real endpoint /ws/match/{id} (SRV-03, #48). Run from
# the repository root against the local stack (`docker compose up`):
#
#   deploy/check-ws-reload.sh
#   HTTP_PORT=8080 deploy/check-ws-reload.sh
#   WS_URL=wss://localhost:8443/ws/match/reload-check deploy/check-ws-reload.sh   # SITE_ADDRESS=https://localhost
#
# deploy/ws_check.py opens a connection, Caddy reloads, then a `hello` of an old protocol version
# on the same connection must be answered by the server with close code 4001; a new connection
# as well. No match or guest is created, the running stack is not touched otherwise.
set -euo pipefail

url="${WS_URL:-ws://localhost:${HTTP_PORT:-80}/ws/match/reload-check}"

echo "== WebSocket through Caddy, then caddy reload --force"
python3 deploy/ws_check.py reload "$url" -- \
	docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force

echo "OK: the WebSocket survived the Caddy reload"
