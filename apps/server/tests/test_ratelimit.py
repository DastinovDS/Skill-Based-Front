"""ID-01: sliding-window rate limiter on a manual clock."""

import pytest

from gow_server.clock import ManualClock
from gow_server.ratelimit import ConnectionGate, SlidingWindowLimiter, ip_key


def test_limit_per_key_and_window_slides() -> None:
    clock = ManualClock()
    limiter = SlidingWindowLimiter(limit=2, window=10, clock=clock)
    assert limiter.hit("a") is None  # t=0
    clock.advance(4)
    assert limiter.hit("a") is None  # t=4
    assert limiter.hit("a") == 6  # the hit at t=0 leaves the window at t=10
    assert limiter.hit("b") is None  # another key has its own budget
    clock.advance(6)  # t=10
    assert limiter.hit("a") is None
    assert limiter.hit("a") == 4  # now the hit at t=4 is the oldest


def test_rejected_hits_do_not_extend_the_block() -> None:
    clock = ManualClock()
    limiter = SlidingWindowLimiter(limit=1, window=10, clock=clock)
    assert limiter.hit("a") is None
    for _ in range(5):
        clock.advance(1)
        assert limiter.hit("a") is not None
    clock.advance(5)  # t=10
    assert limiter.hit("a") is None


# Per-IP keys (#415) ------------------------------------------------------------


@pytest.mark.parametrize(
    ("host", "key"),
    [
        ("192.0.2.1", "192.0.2.1"),  # IPv4: the address itself
        ("192.0.2.2", "192.0.2.2"),  # a neighbour is another client
        ("2001:db8:1:2::1", "2001:db8:1:2::/64"),  # IPv6: the /64
        ("2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"),  # same /64, other host part
        (
            "2001:0db8:0001:0002:0000:0000:0000:0001",
            "2001:db8:1:2::/64",
        ),  # spelling does not matter
        ("2001:db8:1:3::1", "2001:db8:1:3::/64"),  # the next /64 is another client
        ("::ffff:192.0.2.1", "192.0.2.1"),  # IPv4-mapped IPv6 is the IPv4 client
        ("fe80::1%eth0", "fe80::/64"),  # a scope id is dropped
        ("::1", "::/64"),
        ("testclient", "testclient"),  # not an address: its own key
        ("unknown", "unknown"),
    ],
)
def test_ip_key(host: str, key: str) -> None:
    assert ip_key(host) == key


# Connections before hello (#199) -----------------------------------------------


def test_gate_caps_per_key_and_in_total() -> None:
    gate = ConnectionGate(per_key=2, total=3)
    assert gate.enter("a") and gate.enter("a")
    assert not gate.enter("a")  # the third of one key
    assert gate.enter("b")  # another key has its own cap...
    assert not gate.enter("c")  # ...until the total is reached
    assert gate.pending == 3
    gate.leave("a")
    assert gate.enter("c")
    assert gate.pending == 3


def test_gate_refusal_counts_nothing_and_leave_forgets_empty_keys() -> None:
    gate = ConnectionGate(per_key=1, total=10)
    assert gate.enter("a")
    for _ in range(5):
        assert not gate.enter("a")
    assert gate.pending == 1
    gate.leave("a")
    assert gate.pending == 0
    assert gate.enter("a")


def test_gate_keys_an_ipv6_client_by_its_64() -> None:
    gate = ConnectionGate(per_key=1, total=10)
    assert gate.enter(ip_key("2001:db8:1:2::1"))
    assert not gate.enter(ip_key("2001:db8:1:2:ffff::9"))  # same /64: one client
    assert gate.enter(ip_key("2001:db8:1:3::1"))
