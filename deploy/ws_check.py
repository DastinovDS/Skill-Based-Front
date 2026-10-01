"""WebSocket reload check against the real match endpoint, for deploy/check-ws-reload.sh.

OPS-02 (#81), SRV-03 (#48). Standard library only (RFC 6455 client, text frames, no extensions),
so it runs on any host with Python 3.

    python3 deploy/ws_check.py reload ws://localhost:8080/ws/match/reload-check -- <reload command>

`reload` opens a connection to /ws/match/..., runs the command, then sends a `hello` of an old
protocol version on that same connection: the server answering with close code 4001 proves the
connection survived the reload. A new connection after the reload must get 4001 as well. No match
or guest is needed. The server waits for `hello` for 5 seconds (``ws_hello_timeout_s``): the
reload has to fit into that.
"""

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_OP_TEXT, _OP_CLOSE, _OP_PING, _OP_PONG = 0x1, 0x8, 0x9, 0xA
_CLOSE_PROTOCOL_VERSION = 4001  # gow_protocol.messages.CLOSE_PROTOCOL_VERSION
_TIMEOUT_S = 5.0


def _accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()


def _read_exact(sock: socket.socket, n: int) -> bytes:
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    return data


def _read_head(sock: socket.socket) -> tuple[str, dict[str, str]]:
    """Read an HTTP head: the first line and the headers (names lowercased)."""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("connection closed during the handshake")
        data += chunk
    first, *lines = data.split(b"\r\n\r\n", 1)[0].decode("latin-1").split("\r\n")
    headers: dict[str, str] = {}
    for line in lines:
        name, _, value = line.partition(":")
        headers[name.strip().lower()] = value.strip()
    return first, headers


def _read_frame(sock: socket.socket) -> tuple[int, bytes]:
    b0, b1 = _read_exact(sock, 2)
    length = b1 & 0x7F
    if length == 126:
        (length,) = struct.unpack("!H", _read_exact(sock, 2))
    elif length == 127:
        (length,) = struct.unpack("!Q", _read_exact(sock, 8))
    mask = _read_exact(sock, 4) if b1 & 0x80 else b""
    payload = _read_exact(sock, length)
    if mask:
        payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    return b0 & 0x0F, payload


def _send_frame(sock: socket.socket, opcode: int, payload: bytes, *, masked: bool) -> None:
    head = bytes([0x80 | opcode])
    mask_bit = 0x80 if masked else 0
    if len(payload) < 126:
        head += bytes([mask_bit | len(payload)])
    elif len(payload) < 1 << 16:
        head += bytes([mask_bit | 126]) + struct.pack("!H", len(payload))
    else:
        head += bytes([mask_bit | 127]) + struct.pack("!Q", len(payload))
    if masked:
        mask = os.urandom(4)
        head += mask
        payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    sock.sendall(head + payload)


def connect(url: str) -> socket.socket:
    """Open a WebSocket. wss:// to (*.)localhost skips certificate checks (Caddy's internal CA)."""
    parts = urllib.parse.urlsplit(url)
    secure = parts.scheme == "wss"
    host = parts.hostname or "localhost"
    port = parts.port or (443 if secure else 80)
    sock = socket.create_connection((host, port), timeout=_TIMEOUT_S)
    if secure:
        context = ssl.create_default_context()
        if host in ("localhost", "127.0.0.1") or host.endswith(".localhost"):
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        sock = context.wrap_socket(sock, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    origin = f"{'https' if secure else 'http'}://{parts.netloc}"
    sock.sendall(
        (
            f"GET {parts.path or '/'} HTTP/1.1\r\nHost: {parts.netloc}\r\nOrigin: {origin}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )
    status, headers = _read_head(sock)
    if " 101 " not in f"{status} " or headers.get("sec-websocket-accept") != _accept_key(key):
        sock.close()
        raise ConnectionError(f"no WebSocket upgrade: {status}")
    return sock


def expect_close(sock: socket.socket, code: int) -> None:
    """Send an old-version ``hello`` and expect the server to close with ``code``."""
    hello = json.dumps({"type": "hello", "protocol_version": 1, "token": "reloadcheck"})
    _send_frame(sock, _OP_TEXT, hello.encode(), masked=True)
    while True:
        opcode, payload = _read_frame(sock)
        if opcode == _OP_CLOSE:
            got = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else None
            if got != code:
                raise ConnectionError(f"close code {got}, expected {code}")
            return
        if opcode == _OP_PING:
            _send_frame(sock, _OP_PONG, payload, masked=True)


def check_reload(url: str, command: list[str], wait_s: float) -> None:
    deadline = time.monotonic() + wait_s
    while True:  # the upstream may still be starting
        try:
            old = connect(url)
            break
        except OSError as exc:
            if time.monotonic() > deadline:
                raise ConnectionError(f"cannot open {url}: {exc}") from exc
            time.sleep(0.5)
    opened = time.monotonic()
    print("connected; reloading:", " ".join(command), flush=True)
    subprocess.run(command, check=True)
    time.sleep(0.5)  # give Caddy time to cut the stream if it were going to
    expect_close(old, _CLOSE_PROTOCOL_VERSION)
    print(
        f"the connection opened before the reload still works ({time.monotonic() - opened:.1f} s)",
        flush=True,
    )
    old.close()
    new = connect(url)
    expect_close(new, _CLOSE_PROTOCOL_VERSION)
    print("a new connection after the reload works", flush=True)
    new.close()


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description="WebSocket reload check of /ws/match")
    sub = parser.add_subparsers(dest="mode", required=True)
    reload_p = sub.add_parser("reload", help="check that a connection survives a reload")
    reload_p.add_argument("url")
    reload_p.add_argument("--wait", type=float, default=20.0, help="seconds to wait for upstream")
    reload_p.add_argument("command", nargs="+", help="reload command, after --")
    args = parser.parse_args(argv)
    check_reload(args.url, args.command, args.wait)


if __name__ == "__main__":
    main(sys.argv[1:])
