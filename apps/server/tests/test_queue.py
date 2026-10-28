"""MM-01: matchmaking queue (pairing rules, window over time, confirmation), and its HTTP API.

Expected pairs follow the rules of mechanics.md, section 19, "Matchmaking queue": window
``100 + 5 * waited`` rating points, at most 400, both windows must hold the other's rating,
the closest partner first, front of the queue first, never the same pair twice in a row.
"""

from collections.abc import Iterator
from datetime import timedelta
from typing import cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from gow_protocol.messages import UnratedReason
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.identity import hash_token
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle
from gow_server.matches import MatchManager
from gow_server.matchqueue import MatchQueue
from gow_server.models import Match, Player, Rating
from gow_server.settings import Settings

Json = dict[str, object]

RATINGS = {
    "p0": 1500.0,
    "p1": 1520.0,
    "p2": 1580.0,
    "p3": 1700.0,
    "p4": 1850.0,
    "p5": 1300.0,
    "p6": 1100.0,
    "p7": 2000.0,
    "p8": 1450.0,
    "p9": 1210.0,
}
IDS = {name: index + 1 for index, name in enumerate(RATINGS)}


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def queue(clock: ManualClock) -> MatchQueue:
    lifecycle = MatchLifecycle(MatchManager(clock), sessionmaker(), clock)
    return MatchQueue(clock, lifecycle)


def join(queue: MatchQueue, name: str, rating: float | None = None) -> None:
    queue.join(IDS[name], name, RATINGS[name] if rating is None else rating)


def pairs_of(queue: MatchQueue, names: list[str]) -> set[frozenset[str]]:
    """The found pairs among ``names``, by nick."""
    found: set[frozenset[str]] = set()
    for name in names:
        status = queue.status(IDS[name])
        if status is not None and status.state == "found":
            assert status.opponent_nick is not None
            found.add(frozenset((name, status.opponent_nick)))
    return found


def wait_until(queue: MatchQueue, clock: ManualClock, t: float) -> None:
    """Move time second by second to ``t``; every client polls each second (the heartbeat)."""
    while clock.now() < t:
        clock.advance(1)
        for account in IDS.values():
            queue.status(account)


def test_ten_players_are_paired_by_rating_and_the_window_widens(
    queue: MatchQueue, clock: ManualClock
) -> None:
    for name in RATINGS:  # all at t = 0, in this order
        join(queue, name)
    wait_until(queue, clock, 1)  # window 105
    # p0 takes the closest of p1 (20), p8 (50), p2 (80); p5 takes p9 (90); 130 between p2 and
    # p8, 120 between p2 and p3, 150 between p4 and p7 are out of the window.
    assert pairs_of(queue, list(RATINGS)) == {frozenset({"p0", "p1"}), frozenset({"p5", "p9"})}
    assert len(queue) == 10

    wait_until(queue, clock, 3)  # window 115 < 120
    assert pairs_of(queue, ["p2", "p3"]) == set()
    wait_until(queue, clock, 4)  # window 120 holds p2-p3
    assert pairs_of(queue, ["p2", "p3", "p4", "p6", "p7", "p8"]) == {frozenset({"p2", "p3"})}

    wait_until(queue, clock, 9)  # window 145 < 150
    assert pairs_of(queue, ["p4", "p7"]) == set()
    wait_until(queue, clock, 10)  # window 150 holds p4-p7
    assert pairs_of(queue, ["p4", "p6", "p7", "p8"]) == {frozenset({"p4", "p7"})}

    wait_until(queue, clock, 49)  # window 345 < 350 between p6 and p8
    assert pairs_of(queue, ["p6", "p8"]) == set()
    wait_until(queue, clock, 50)  # window 350
    assert pairs_of(queue, ["p6", "p8"]) == {frozenset({"p6", "p8"})}


def test_window_has_a_ceiling(queue: MatchQueue, clock: ManualClock) -> None:
    join(queue, "p0", 1500.0)
    join(queue, "p1", 1901.0)  # 401 apart: over the 400 ceiling
    wait_until(queue, clock, 1000)
    assert pairs_of(queue, ["p0", "p1"]) == set()
    assert queue.window(queue._order[0], clock.now()) == 400.0  # pyright: ignore[reportPrivateUsage]


def test_both_windows_must_accept(queue: MatchQueue, clock: ManualClock) -> None:
    join(queue, "p0", 1500.0)
    wait_until(queue, clock, 40)  # p0 waited 40 s: window 300
    join(queue, "p1", 1750.0)  # 250 apart; p1's window is 100
    wait_until(queue, clock, 69)  # p1 waited 29 s: window 245 < 250
    assert pairs_of(queue, ["p0", "p1"]) == set()
    wait_until(queue, clock, 70)  # p1 waited 30 s: window 250
    assert pairs_of(queue, ["p0", "p1"]) == {frozenset({"p0", "p1"})}


def test_the_same_pair_is_not_made_twice_in_a_row(queue: MatchQueue, clock: ManualClock) -> None:
    join(queue, "p0", 1500.0)
    join(queue, "p1", 1510.0)
    clock.advance(1)
    queue.update()
    assert pairs_of(queue, ["p0", "p1"]) == {frozenset({"p0", "p1"})}
    queue.leave(IDS["p1"])  # p1 declines: p0 returns to the front of the queue
    assert queue.status(IDS["p1"]) is None
    status = queue.status(IDS["p0"])
    assert status is not None and status.state == "searching"

    join(queue, "p1", 1510.0)
    clock.advance(1)
    queue.update()
    assert pairs_of(queue, ["p0", "p1"]) == set()  # not again right away
    join(queue, "p2", 1490.0)  # p0 (front) takes it: 10 apart; p1 stays alone
    wait_until(queue, clock, clock.now() + 1)
    assert pairs_of(queue, ["p0", "p1", "p2"]) == {frozenset({"p0", "p2"})}


def test_unconfirmed_pair_starts_no_match(queue: MatchQueue, clock: ManualClock) -> None:
    join(queue, "p0", 1500.0)
    join(queue, "p1", 1500.0)
    join(queue, "p2", 1500.0)
    clock.advance(1)
    queue.update()
    assert pairs_of(queue, ["p0", "p1", "p2"]) == {frozenset({"p0", "p1"})}
    assert queue.confirm(IDS["p0"]) is None  # one confirmation does not start anything
    wait_until(queue, clock, 16)  # the 15 s to confirm are over
    assert queue.status(IDS["p1"]) is None  # did not confirm: out of the queue
    assert queue.lifecycle.active_of(IDS["p1"]) is None  # and free
    status = queue.status(IDS["p0"])
    assert status is not None and status.state == "found"  # back at the front: paired with p2
    assert status.opponent_nick == "p2"
    assert queue._order == []  # pyright: ignore[reportPrivateUsage]
    assert queue.lifecycle.manager.active == 0


def test_confirmed_pair_returns_once_and_keeps_its_wait(
    queue: MatchQueue, clock: ManualClock
) -> None:
    join(queue, "p0", 1500.0)
    wait_until(queue, clock, 10)
    join(queue, "p1", 1500.0)
    clock.advance(1)
    queue.update()
    queue.confirm(IDS["p1"])
    clock.advance(15)
    queue.update()
    status = queue.status(IDS["p1"])
    assert status is not None and status.state == "searching"
    assert status.waited_s == 16.0
    assert queue.status(IDS["p0"]) is None


def test_queue_claims_the_player(queue: MatchQueue) -> None:
    join(queue, "p0")
    record = queue.lifecycle.active_of(IDS["p0"])
    assert record is not None
    other = queue.lifecycle.open_record()
    with pytest.raises(AlreadyActiveError):
        queue.lifecycle.claim(other, (IDS["p0"],))
    queue.leave(IDS["p0"])
    assert queue.lifecycle.active_of(IDS["p0"]) is None


def test_bot_offer_and_silent_player(queue: MatchQueue, clock: ManualClock) -> None:
    join(queue, "p0")
    for _ in range(59):
        clock.advance(1)
        status = queue.status(IDS["p0"])  # the poll is the heartbeat
        assert status is not None and not status.bot_offer
    clock.advance(1)
    status = queue.status(IDS["p0"])
    assert status is not None and status.bot_offer
    clock.advance(15)  # no poll for 15 s: the tab is closed
    queue.update()
    assert queue.status(IDS["p0"]) is None
    assert queue.lifecycle.active_of(IDS["p0"]) is None


# HTTP ------------------------------------------------------------------------------------------


@pytest.fixture
def api(settings: Settings, clock: ManualClock) -> Iterator[TestClient]:
    # From the loopback address: /internal/metrics answers only there.
    with TestClient(create_app(settings, clock), client=("127.0.0.1", 50000)) as test_client:
        yield test_client


def guest(api: TestClient, nick: str) -> dict[str, str]:
    token = api.post("/api/guest", json={"nick": nick}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def manager_of(api: TestClient) -> MatchManager:
    manager = api.app.state.matches  # type: ignore[attr-defined]
    assert isinstance(manager, MatchManager)
    return manager


def sessions_of(api: TestClient) -> "sessionmaker[Session]":
    return cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]


def status_of(api: TestClient, headers: dict[str, str]) -> Json:
    response = api.get("/api/queue", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def test_http_unconfirmed_pair_creates_no_match(api: TestClient, clock: ManualClock) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    assert api.get("/api/queue", headers=alice).status_code == 404
    assert api.post("/api/queue", headers=alice).json()["state"] == "searching"
    assert api.post("/api/queue", headers=bob).json()["state"] == "searching"
    clock.advance(1)
    found = status_of(api, alice)
    assert (found["state"], found["opponent_nick"], found["confirm_in_s"]) == ("found", "bob", 15)
    assert api.post("/api/queue/confirm", headers=alice).json()["you_confirmed"] is True
    assert status_of(api, bob)["opponent_confirmed"] is True
    clock.advance(15)
    assert status_of(api, alice)["state"] == "searching"
    assert api.get("/api/queue", headers=bob).status_code == 404
    manager = manager_of(api)
    assert manager.active == 0
    sessions = sessions_of(api)
    with sessions() as session:
        assert session.execute(select(Match)).scalars().all() == []
    metrics = api.get("/internal/metrics").text
    assert "gow_queue_size 1" in metrics
    assert api.delete("/api/queue", headers=alice).status_code == 204
    assert "gow_queue_size 0" in api.get("/internal/metrics").text


def account(api: TestClient, nick: str, *, played: int | None = 5) -> dict[str, str]:
    """A password account (DEC-34) with ``played`` rating-changing matches: 5 is calibrated."""
    headers = guest(api, nick)
    token = headers["Authorization"].removeprefix("Bearer ")
    with sessions_of(api).begin() as session:
        player = session.execute(
            select(Player).where(Player.token_hash == hash_token(token))
        ).scalar_one()
        player.password_hash = "scrypt$not-a-real-hash"
        if played is not None:
            session.add(
                Rating(
                    player_id=player.id,
                    rating=1500.0,
                    rd=350.0,
                    volatility=0.06,
                    rated_matches=played,
                )
            )
    return headers


def test_http_confirmed_pair_starts_a_rated_public_match(
    api: TestClient, clock: ManualClock
) -> None:
    alice, bob = account(api, "alice"), account(api, "bob")
    api.post("/api/queue", headers=alice)
    api.post("/api/queue", headers=bob)
    clock.advance(1)
    assert status_of(api, bob)["state"] == "found"
    # In the queue (or a found pair) means busy: no invite meanwhile.
    assert api.post("/api/matches", json={}, headers=alice).status_code == 409
    api.post("/api/queue/confirm", headers=alice)
    started = api.post("/api/queue/confirm", headers=bob).json()
    assert started["state"] == "started"
    match_id = str(started["match_id"])
    assert status_of(api, alice)["match_id"] == match_id
    assert status_of(api, alice)["map_id"] == started["map_id"]
    manager = manager_of(api)
    runner = manager.get(match_id)
    assert runner is not None and runner.private is False
    sessions = sessions_of(api)
    with sessions() as session:
        row = session.get(Match, int(match_id))
        assert row is not None and row.rated is True
    # In a match: the queue refuses (one active match per player).
    assert api.post("/api/queue", headers=alice).status_code == 409
    assert api.post("/api/queue", headers=guest(api, "carol")).status_code == 200


def test_http_a_guest_pair_plays_a_public_unrated_match(
    api: TestClient, clock: ManualClock
) -> None:
    """DEC-34: guests keep playing from the queue, unrated."""
    alice, bob = guest(api, "alice"), guest(api, "bob")
    api.post("/api/queue", headers=alice)
    api.post("/api/queue", headers=bob)
    clock.advance(1)
    api.post("/api/queue/confirm", headers=alice)
    match_id = str(api.post("/api/queue/confirm", headers=bob).json()["match_id"])
    with sessions_of(api)() as session:
        row = session.get(Match, int(match_id))
        assert row is not None and row.rated is False
    runner = manager_of(api).get(match_id)
    assert runner is not None and runner.private is False
    assert runner.intro_notice(0).unrated_reason is UnratedReason.GUEST


def test_http_the_queue_refuses_a_banned_player_with_the_time_left(
    api: TestClient, clock: ManualClock
) -> None:
    alice = account(api, "alice")
    with sessions_of(api).begin() as session:
        session.execute(
            update(Player).values(queue_banned_until=clock.wall() + timedelta(seconds=299.5))
        )
    refused = api.post("/api/queue", headers=alice)
    assert refused.status_code == 429
    assert refused.headers["Retry-After"] == "300"
    assert refused.json() == {
        "detail": {
            "code": "queue_banned",
            "message": "queue ban for repeated resigns",
            "retry_after_s": 300,
        }
    }
    assert api.get("/api/queue", headers=alice).status_code == 404  # the refusal queued nothing
    clock.advance(150)
    assert api.post("/api/queue", headers=alice).status_code == 429
    clock.advance(150)
    assert api.post("/api/queue", headers=alice).status_code == 200


def test_http_a_ban_does_not_touch_other_players(api: TestClient, clock: ManualClock) -> None:
    alice, bob = account(api, "alice"), account(api, "bob")
    with sessions_of(api).begin() as session:
        player = session.execute(select(Player).where(Player.nick == "alice")).scalar_one()
        player.queue_banned_until = clock.wall() + timedelta(hours=2)
    assert api.post("/api/queue", headers=alice).status_code == 429
    assert api.post("/api/queue", headers=bob).status_code == 200


def test_http_me_shows_the_calibration_progress(api: TestClient) -> None:
    newbie = account(api, "newbie", played=2)
    assert api.get("/api/me", headers=newbie).json()["calibration"] == {"played": 2, "total": 5}
    assert api.get("/api/me", headers=account(api, "fresh", played=None)).json()["calibration"] == {
        "played": 0,
        "total": 5,
    }
    assert api.get("/api/me", headers=account(api, "veteran")).json()["calibration"] is None
    assert api.get("/api/me", headers=guest(api, "gus")).json()["calibration"] is None


def test_http_queue_entry_is_rate_limited(settings: Settings, clock: ManualClock) -> None:
    limited = settings.model_copy(update={"queue_rate_limit": 2})
    with TestClient(create_app(limited, clock)) as api:
        alice = guest(api, "alice")
        for _ in range(2):
            assert api.post("/api/queue", headers=alice).status_code == 200
            api.delete("/api/queue", headers=alice)
        response = api.post("/api/queue", headers=alice)
        assert response.status_code == 429
        assert "Retry-After" in response.headers
