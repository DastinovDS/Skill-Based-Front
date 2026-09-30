#!/usr/bin/env bash
# Checks of the Caddy front (OPS-02, #81) against a running stack, run from the repository root:
#
#   deploy/check-caddy.sh                                   # http://localhost:${HTTP_PORT:-80}
#   HTTP_PORT=8080 deploy/check-caddy.sh
#   BASE_URL=https://localhost:8443 deploy/check-caddy.sh   # SITE_ADDRESS=https://localhost
#   BASE_URL=https://game.example.com deploy/check-caddy.sh # production (read-only requests)
#
# Checks security headers (the CSP must equal apps/client/csp.ts), HSTS rules, cache headers
# (index.html no-cache, hashed assets immutable), compression, the SPA fallback, and that /api/*
# and /ws/* reach the server. Needs curl and Node >= 22.18 (runs csp.ts directly).
# The certificate of localhost and *.localhost (Caddy's internal CA) is not verified.
set -euo pipefail

base="${BASE_URL:-http://localhost:${HTTP_PORT:-80}}"
host="$(echo "$base" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')"
curl_opts=(--silent --show-error --max-time 10)
case "$host" in localhost | *.localhost | 127.0.0.1) curl_opts+=(--insecure) ;; esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

# fetch NAME PATH [curl args...]: headers to $tmp/NAME.h, body to $tmp/NAME.b, prints the status.
fetch() {
	local name="$1" path="$2"
	shift 2
	curl "${curl_opts[@]}" --dump-header "$tmp/$name.h" --output "$tmp/$name.b" \
		--write-out '%{http_code}' "$@" "$base$path"
}

# header NAME FIELD: value of the last FIELD header of response NAME (empty if absent).
header() {
	grep -i "^$2:" "$tmp/$1.h" | tail -n 1 | cut -d: -f2- | sed -E 's/^ +//; s/\r$//' || true
}

expect_header() {
	local name="$1" field="$2" expected="$3" actual
	actual="$(header "$name" "$field")"
	[ "$actual" = "$expected" ] || fail "$name: $field is '$actual', expected '$expected'"
}

expect_security_headers() {
	local name="$1"
	expect_header "$name" Content-Security-Policy "$csp"
	expect_header "$name" X-Content-Type-Options nosniff
	expect_header "$name" Referrer-Policy no-referrer
	expect_header "$name" Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
	case "$base:$host" in
	https://*:localhost | https://*:127.0.0.1 | http://*)
		expect_header "$name" Strict-Transport-Security "" ;;
	*)
		expect_header "$name" Strict-Transport-Security "max-age=31536000" ;;
	esac
}

csp="$(cd apps/client && node --input-type=module \
	-e "import { CSP } from './csp.ts'; process.stdout.write(CSP);")"
[ -n "$csp" ] || { echo "FAIL: cannot read the CSP from apps/client/csp.ts" >&2; exit 1; }

echo "== $base: index.html"
status="$(fetch index /)"
[ "$status" = 200 ] || fail "GET / returned $status"
grep -q '<div id="app">' "$tmp/index.b" || fail "GET / is not the client's index.html"
expect_security_headers index
expect_header index Cache-Control no-cache

echo "== SPA fallback"
status="$(fetch route /some/client/route)"
[ "$status" = 200 ] || fail "GET /some/client/route returned $status"
grep -q '<div id="app">' "$tmp/route.b" || fail "an unknown path does not fall back to index.html"
expect_header route Cache-Control no-cache

echo "== hashed asset"
asset="$(grep -oE '/assets/[^"]+\.js' "$tmp/index.b" | head -n 1)"
if [ -z "$asset" ]; then
	fail "no /assets/*.js in index.html"
else
	status="$(fetch asset "$asset" --compressed --header 'Accept-Encoding: gzip')"
	[ "$status" = 200 ] || fail "GET $asset returned $status"
	expect_security_headers asset
	expect_header asset Cache-Control "public, max-age=31536000, immutable"
	expect_header asset Content-Encoding gzip
	case "$(header asset Content-Type)" in
	text/javascript* | application/javascript*) ;;
	*) fail "$asset: Content-Type is '$(header asset Content-Type)'" ;;
	esac
fi

echo "== missing asset is a 404, not index.html"
status="$(fetch missing /assets/missing-0000.js)"
[ "$status" = 404 ] || fail "GET /assets/missing-0000.js returned $status"
[ "$(header missing Cache-Control)" != "public, max-age=31536000, immutable" ] \
	|| fail "a 404 under /assets/ is cached as immutable"

echo "== /api/* reaches the server"
status="$(fetch api /api/health)"
[ "$status" = 200 ] || fail "GET /api/health returned $status"
[ "$(cat "$tmp/api.b")" = '{"status":"ok"}' ] || fail "unexpected /api/health: $(cat "$tmp/api.b")"
[ -n "$(header api X-Request-ID)" ] || fail "/api/health has no X-Request-ID (not from the server?)"
expect_security_headers api
[ -z "$(header api Cache-Control)" ] || fail "/api/* got a static Cache-Control"

echo "== /ws/* is proxied, not served as a static file"
# Until SRV-03 (#48) there is no WebSocket endpoint: the server answers the upgrade with an
# HTTP error. What matters here is that the answer comes from the server, not from Caddy.
status="$(fetch ws /ws/probe --header 'Connection: Upgrade' --header 'Upgrade: websocket' \
	--header 'Sec-WebSocket-Version: 13' --header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
	--header "Origin: $base")"
case "$status" in
5* | 000) fail "GET /ws/probe (upgrade) returned $status: the server is not reached" ;;
esac
grep -q '<div id="app">' "$tmp/ws.b" && fail "/ws/* falls back to index.html"

if [ "$failures" -gt 0 ]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
echo "OK: Caddy headers, caching and routing ($base)"
