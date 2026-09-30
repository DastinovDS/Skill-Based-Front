#!/usr/bin/env bash
# A WebSocket through Caddy survives a Caddy config reload (OPS-02, #81: stream_close_delay in
# deploy/Caddyfile). Run from the repository root against the local stack (`docker compose up`):
#
#   deploy/check-ws-reload.sh
#   HTTP_PORT=8080 deploy/check-ws-reload.sh
#   WS_URL=wss://localhost:8443/ws/echo deploy/check-ws-reload.sh    # SITE_ADDRESS=https://localhost
#
# The server has no WebSocket endpoint until SRV-03 (#48), so for the duration of the check the
# `app` container is stopped and replaced on the internal network (same DNS name `app`, port
# 8000) by the stdlib echo server of deploy/ws_check.py, run from the app image. Afterwards
# `app` is started again. Do not run it against a stack that is serving players.
# TODO(#48): once /ws/match exists, check the reload against the real server instead.
set -euo pipefail

url="${WS_URL:-ws://localhost:${HTTP_PORT:-80}/ws/echo}"
# compose.yaml sets `name: skill-based-front`: its networks and images carry that prefix.
network="skill-based-front_internal"
image="skill-based-front/app:local"
echo_name="skill-based-front-ws-echo"

restore() {
	docker rm --force "$echo_name" >/dev/null 2>&1 || true
	docker compose up --detach --wait --wait-timeout 120 app >/dev/null
}
trap restore EXIT

echo "== replace app with the WebSocket echo server"
docker compose stop app >/dev/null
docker run --detach --rm --name "$echo_name" --network "$network" --network-alias app \
	--read-only --cap-drop ALL --entrypoint python "$image" \
	-c "$(cat deploy/ws_check.py)" serve 8000 >/dev/null

echo "== WebSocket through Caddy, then caddy reload --force"
python3 deploy/ws_check.py reload "$url" -- \
	docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force

echo "OK: the WebSocket survived the Caddy reload"
