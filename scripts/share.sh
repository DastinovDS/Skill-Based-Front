#!/usr/bin/env bash
# `mise run share [port]` (#711): a Cloudflare quick tunnel to the local stack, so the game can be
# opened from a phone or sent to friends. Prints one https://*.trycloudflare.com link and keeps
# the tunnel up until Ctrl+C. It never starts or restarts a docker stack.
#
# Why nothing in the stack has to change: cloudflared hands Caddy the public Host
# (<random>.trycloudflare.com) and the browser sends the matching Origin, so the "Origin equals the
# site's own Host" rule of the match WebSocket (gow_server.ws.origin_allowed) holds as it is.
set -euo pipefail

port="${1:-8080}"
case "$port" in
  '' | *[!0-9]*) echo "share: the port must be a number, got '$port'" >&2; exit 2 ;;
esac
local_url="http://127.0.0.1:$port"

# 1. The stack must already answer on the port (the game server's own health check, through Caddy).
if ! curl -fsS -m 3 -o /dev/null "$local_url/api/health" 2>/dev/null; then
  echo "share: no game stack answers on $local_url/api/health." >&2
  echo "Start it first, then run this again:" >&2
  echo "  owner stack (port 8080):  mise run stack      then  mise run share" >&2
  echo "  agents' stack (18080):    mise run stack:agent  then  mise run share 18080" >&2
  exit 1
fi

# 2. The tunnel: cloudflared runs in the background and writes to a log we read the link from.
log="$(mktemp -t sbf-share.XXXXXX)"
pid=""
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$log"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cloudflared tunnel --no-autoupdate --url "$local_url" >"$log" 2>&1 &
pid=$!

# The link appears in the log at once, but works only after the first edge connection is
# registered ("Registered tunnel connection"); before that Cloudflare answers with error 1033.
url=""
ready=0
for _ in $(seq 1 60); do
  kill -0 "$pid" 2>/dev/null || { echo "share: cloudflared stopped:" >&2; tail -n 15 "$log" >&2; exit 1; }
  [ -n "$url" ] || url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -n 1 || true)"
  if [ -n "$url" ] && grep -q 'Registered tunnel connection' "$log"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "share: the tunnel did not come up within 60 s." >&2
  echo "cloudflared needs outbound TCP/UDP to port 7844 (region1.v2.argotunnel.com);" >&2
  echo "a VPN, a firewall or a guest Wi-Fi often blocks it. Last log lines:" >&2
  tail -n 8 "$log" >&2
  exit 1
fi

# Self-check through the public link (best effort): the page loads, and the match WebSocket passes
# the server's Origin check (a 403 there would mean cloudflared rewrote the Host header).
note=""
for _ in $(seq 1 10); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/api/health" || true)" = "200" ] && { note="ok"; break; }
  sleep 2
done
if [ "$note" = "ok" ]; then
  ws="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Origin: $url" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$url/ws/match/check" || true)"
  case "$ws" in
    101 | 404) note="reachable from this machine, the match WebSocket is accepted" ;;
    403) note="WARNING: the match WebSocket was refused by the Origin check, matches will not connect" ;;
    *) note="reachable from this machine; WebSocket check inconclusive (HTTP $ws)" ;;
  esac
else
  note="not yet reachable from this machine (DNS can take a minute); try the link in a moment"
fi

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$url" | pbcopy
  copied=" (copied to the clipboard)"
else
  copied=""
fi
cat <<MSG

  Your game is online at:

      $url
$copied
  Open it or send it to friends; invite links made on that page carry the same address.
  Anyone with this link reaches your local stack. The address changes on every run.
  Self-check: $note.
  Press Ctrl+C to close the tunnel.

MSG

wait "$pid"
