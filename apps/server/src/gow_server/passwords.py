"""Account passwords (#374): ``hashlib.scrypt`` hashes, no new dependency.

A stored hash is ``scrypt$<n>$<r>$<p>$<salt>$<hash>`` (salt and hash in base64): the parameters
travel with the hash, so the defaults in ``Settings`` can be raised later and old hashes still
verify. The password is NFKC-normalized before hashing (the same text typed on another keyboard
or system gives the same bytes) and must be ``MIN_LENGTH..MAX_LENGTH`` characters after that.

Hashing takes tens of milliseconds on purpose: call it only from ``def`` endpoints (the FastAPI
threadpool) or a thread, never inside ``async def`` (AGENTS.md, section 9).

At most ``Settings.scrypt_concurrency`` hashes run at once (#413): every run holds about 32 MiB, so
an unbounded burst of logins would eat the memory of the whole server. A run over the limit does
not wait: it raises ``HasherBusy`` and the endpoint answers 503 at once.
"""

import base64
import hashlib
import hmac
import secrets
import threading
import unicodedata
from collections.abc import Generator
from contextlib import contextmanager
from typing import Final

from gow_server.settings import Settings

MIN_LENGTH: Final = 10
MAX_LENGTH: Final = 128
SCHEME: Final = "scrypt"
SALT_BYTES: Final = 16
HASH_BYTES: Final = 32


def normalize(password: str) -> str:
    """NFKC form of a new password; ``ValueError`` (without the password) if its length is wrong."""
    normalized = unicodedata.normalize("NFKC", password)
    if not MIN_LENGTH <= len(normalized) <= MAX_LENGTH:
        raise ValueError(f"password must be {MIN_LENGTH} to {MAX_LENGTH} characters long")
    return normalized


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, maxmem: int) -> bytes:
    return hashlib.scrypt(
        unicodedata.normalize("NFKC", password).encode(),
        salt=salt,
        n=n,
        r=r,
        p=p,
        maxmem=maxmem,
        dklen=HASH_BYTES,
    )


class HasherBusy(Exception):
    """All scrypt slots are taken: try again in a moment (HTTP 503)."""


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


class PasswordHasher:
    """Hashes new passwords with the parameters of ``Settings`` and verifies stored hashes."""

    def __init__(self, settings: Settings) -> None:
        self.n = settings.scrypt_n
        self.r = settings.scrypt_r
        self.p = settings.scrypt_p
        self.maxmem = settings.scrypt_maxmem
        self._slots = threading.BoundedSemaphore(settings.scrypt_concurrency)
        # A hash no password matches (a random digest): a login with an unknown nick verifies
        # against it, so it costs the same scrypt run as a wrong password of an existing account.
        salt, digest = secrets.token_bytes(SALT_BYTES), secrets.token_bytes(HASH_BYTES)
        self._dummy = f"{SCHEME}${self.n}${self.r}${self.p}${_b64(salt)}${_b64(digest)}"

    @contextmanager
    def _slot(self) -> Generator[None]:
        """One of ``scrypt_concurrency`` slots; ``HasherBusy`` at once if none is free."""
        if not self._slots.acquire(blocking=False):
            raise HasherBusy
        try:
            yield
        finally:
            self._slots.release()

    def hash(self, password: str) -> str:
        with self._slot():
            return self._hash_with(password, secrets.token_bytes(SALT_BYTES))

    def _hash_with(self, password: str, salt: bytes) -> str:
        digest = _scrypt(password, salt, self.n, self.r, self.p, self.maxmem)
        return f"{SCHEME}${self.n}${self.r}${self.p}${_b64(salt)}${_b64(digest)}"

    def verify(self, password: str, stored: str | None) -> bool:
        """Whether ``password`` matches ``stored``. ``None`` (no password, a guest) never matches,
        but takes the same time as a wrong password. ``HasherBusy`` if no slot is free."""
        if stored is None:
            self.verify(password, self._dummy)
            return False
        with self._slot():
            return self._verify(password, stored)

    def _verify(self, password: str, stored: str) -> bool:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != SCHEME:
            raise ValueError(f"unknown password hash scheme {scheme!r}")
        expected = base64.b64decode(digest)
        actual = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p), self.maxmem)
        return hmac.compare_digest(actual, expected)
