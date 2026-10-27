"""SRV-09: match lifecycle: state table, results in the database, no-show, one active match."""

import asyncio
import itertools
import shutil
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import httpx2
import pytest
import uvicorn
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_protocol.commands import ForfeitCmd
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.identity import hash_token
from gow_server.lifecycle import (
    TRANSITIONS,
    IllegalTransitionError,
    MatchLifecycle,
    MatchRecord,
    MatchState,
    abort_orphans,
    archive_rulesets,
)
from gow_server.matches import MatchRunner
from gow_server.models import Match, MatchPlayer, Player, Rating
from gow_server.rating import apply_match
from gow_server.settings import Settings
from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import load_ruleset, ruleset_hash

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1
TIMEOUT_S: Final = 30.0
Json = dict[str, object]


@pytest.fixture
def live_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copy(ROOT / "maps" / "fixtures" / "web.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=tmp_path / "rulesets",
        rulesets_bundled_dir=ROOT / "rulesets" / "archive",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
    )


@dataclass
class Live:
    clock: ManualClock
    lifecycle: MatchLifecycle
    sessions: sessionmaker[Session]
    http: httpx2.AsyncClient
    settings: Settings

    async def guest(self, nick: str) -> dict[str, str]:
        token = (await self.http.post("/api/guest", json={"nick": nick})).json()["token"]
        return {"Authorization": f"Bearer {token}"}

    async def account(self, headers: dict[str, str]) -> int:
        token = headers["Authorization"].removeprefix("Bearer ")
        with self.sessions() as session:
            return session.execute(
                select(Player.id).where(Player.token_hash == hash_token(token))
            ).scalar_one()

    async def invite_post(self, headers: dict[str, str], code: str, action: str) -> httpx2.Response:
        return await self.http.post(f"/api/matches/{code}/{action}", headers=headers)

    async def invite(self, headers: dict[str, str]) -> str:
        response = await self.http.post("/api/matches", json={"map_id": "web"}, headers=headers)
        assert response.status_code == 201, response.text
        return str(response.json()["code"])

    async def bot_match(self, headers: dict[str, str]) -> httpx2.Response:
        return await self.http.post(
            "/api/bot-matches", json={"level": "easy", "map_id": "web"}, headers=headers
        )

    async def run_until(self, condition: Callable[[], bool], step: float = DT) -> None:
        """Move match time in ticks (and let threads finish) until ``condition`` holds."""
        for _ in range(int(TIMEOUT_S / 0.01)):
            if condition():
                return
            self.clock.advance(step)
            await asyncio.sleep(0.01)
        raise AssertionError("condition not reached")

    def row(self, pk: str) -> tuple[Match, list[MatchPlayer]]:
        with self.sessions() as session:
            match = session.get(Match, int(pk))
            assert match is not None
            sides = list(
                session.execute(
                    select(MatchPlayer)
                    .where(MatchPlayer.match_id == int(pk))
                    .order_by(MatchPlayer.side)
                ).scalars()
            )
            return match, sides


@asynccontextmanager
async def live_server(settings: Settings) -> AsyncGenerator[Live]:
    clock = ManualClock()
    app = create_app(settings, clock)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    host = f"127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        async with httpx2.AsyncClient(base_url=f"http://{host}") as http:
            yield Live(clock, app.state.lifecycle, app.state.sessions, http, settings)
    finally:
        server.should_exit = True
        await task


# State table -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("old", "new"), list(itertools.product(MatchState, MatchState)), ids=lambda s: s.value
)
def test_every_state_change_follows_the_table(old: MatchState, new: MatchState) -> None:
    record = MatchRecord(state=old)
    if new in TRANSITIONS[old]:
        record.advance(new)
        assert record.state is new and record.history == [old, new]
    else:
        with pytest.raises(IllegalTransitionError):
            record.advance(new)
        assert record.state is old


# Invite flow ---------------------------------------------------------------------------------


def test_invite_match_has_a_row_and_its_result_is_saved(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice, bob = await live.guest("alice"), await live.guest("bob")
            code = await live.invite(alice)
            assert (await live.invite_post(bob, code, "join")).status_code == 200
            await live.invite_post(alice, code, "ready")
            started = (await live.invite_post(bob, code, "ready")).json()
            match_id = started["match_id"]
            assert match_id.isdecimal()

            runner = live.lifecycle.manager.get(match_id)
            assert runner is not None
            row, sides = live.row(match_id)
            assert (row.status, row.rated, row.started_at is not None) == ("running", False, True)
            assert row.ruleset_hash == ruleset_hash(runner.match.rules)
            assert row.ended_at is None
            assert [s.player_id for s in sides] == list(runner.players)

            loser = runner.players[0]
            assert runner.submit(0, 1, ForfeitCmd())
            await live.run_until(lambda: live.row(match_id)[0].status == "saved")
            row, sides = live.row(match_id)
            assert (row.end_reason, row.ended_at is not None) == ("forfeit", True)
            assert row.ticks is not None and row.ticks > 0
            assert [s.result for s in sides] == ["loss", "win"]
            assert sides[0].player_id == loser
            assert live.lifecycle.manager.get(match_id) is None
            await live.run_until(lambda: len(live.lifecycle) == 0)  # cleaned from memory
            # SRV-07: the frames file is linked to the row created by the lifecycle
            await live.run_until(lambda: live.row(match_id)[0].replay_path is not None)

            # #170: the replay link of the result screen works for an invite match
            carol = await live.guest("carol")
            url = f"/api/replays/{match_id}"
            for headers in (alice, bob):
                got = await live.http.get(url, headers=headers)
                assert got.status_code == 200 and got.content
            assert (await live.http.get(url, headers=carol)).status_code == 403
            assert (await live.http.get(url)).status_code == 401

    asyncio.run(scenario())


def test_match_record_passes_every_state(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice = await live.guest("alice")
            response = await live.bot_match(alice)
            assert response.status_code == 201, response.text
            match_id = response.json()["match_id"]
            record = live.lifecycle._records[match_id]  # pyright: ignore[reportPrivateUsage]
            assert record.state is MatchState.RUNNING
            runner = live.lifecycle.manager.get(match_id)
            assert runner is not None
            human = 1 - runner.bot.slot if runner.bot else 0
            assert runner.submit(human, 1, ForfeitCmd())
            await live.run_until(lambda: record.state is MatchState.CLEANED)
            assert record.history == [
                MatchState.CREATED,
                MatchState.RUNNING,
                MatchState.FINISHED,
                MatchState.SAVED,
                MatchState.CLEANED,
            ]
            await live.run_until(lambda: live.row(match_id)[0].replay_path is not None)
            url = f"/api/replays/{match_id}"  # #170: also for a bot match
            assert (await live.http.get(url, headers=alice)).status_code == 200
            assert (
                await live.http.get(url, headers=await live.guest("mallory"))
            ).status_code == 403
            assert (await live.http.get(url)).status_code == 401
            row, sides = live.row(match_id)
            assert [s.bot for s in sides].count("turtle") == 1
            assert sorted(s.result or "" for s in sides) == ["loss", "win"]
            assert row.status == "saved"

    asyncio.run(scenario())


def test_ready_timeout_is_a_no_show(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice, bob = await live.guest("alice"), await live.guest("bob")
            code = await live.invite(alice)
            await live.invite_post(bob, code, "join")
            invite = live.lifecycle.active_of(await live.account(alice))
            assert invite is not None and invite.state is MatchState.WAITING
            await live.invite_post(alice, code, "ready")

            live.clock.advance(live.settings.ready_timeout_s - 1)
            assert (await live.http.get(f"/api/matches/{code}", headers=bob)).status_code == 200
            live.clock.advance(1)
            assert (await live.http.get(f"/api/matches/{code}", headers=bob)).status_code == 404
            assert (await live.invite_post(alice, code, "ready")).status_code == 404
            assert invite.history == [
                MatchState.CREATED,
                MatchState.WAITING,
                MatchState.ABORTED,
                MatchState.CLEANED,
            ]
            assert invite.abort_reason == "no_show"
            assert len(live.lifecycle) == 0
            # both are free again
            assert live.lifecycle.active_of(await live.account(alice)) is None
            assert (await live.bot_match(bob)).status_code == 201

    asyncio.run(scenario())


def test_expired_invite_is_aborted(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice = await live.guest("alice")
            await live.invite(alice)
            assert len(live.lifecycle) == 1
            live.clock.advance(live_settings.invite_ttl_s)
            live.lifecycle.sweep()
            assert len(live.lifecycle) == 0

    asyncio.run(scenario())


# One active match per player -------------------------------------------------------------


def test_second_active_match_is_refused(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice, bob, carol = [await live.guest(n) for n in ("alice", "bob", "carol")]
            code = await live.invite(alice)
            assert (await live.invite_post(bob, code, "join")).status_code == 200  # alice, bob busy

            other = await live.invite(carol)
            for headers in (alice, bob):
                response = await live.http.post("/api/matches", json={}, headers=headers)
                assert response.status_code == 409, "a new invite while in a match"
                assert (await live.bot_match(headers)).status_code == 409
            joined = await live.invite_post(bob, other, "join")
            assert joined.status_code == 409 and "active match" in joined.json()["detail"]

            # the host of a waiting invite is busy: nobody else joins their other invite
            dave = await live.guest("dave")
            eve = await live.guest("eve")
            dave_invite = await live.invite(dave)
            assert (await live.bot_match(dave)).status_code == 201
            refused = await live.invite_post(eve, dave_invite, "join")
            assert refused.status_code == 409 and "host" in refused.json()["detail"]

    asyncio.run(scenario())


def test_player_is_free_when_the_match_is_over(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice = await live.guest("alice")
            first = await live.bot_match(alice)
            assert first.status_code == 201
            assert (await live.bot_match(alice)).status_code == 409
            runner = live.lifecycle.manager.get(first.json()["match_id"])
            assert runner is not None and runner.bot is not None
            runner.submit(1 - runner.bot.slot, 1, ForfeitCmd())
            await live.run_until(lambda: runner.finished)
            assert (await live.bot_match(alice)).status_code == 201

    asyncio.run(scenario())


# Results of broken matches -----------------------------------------------------------------


def test_nobody_comes_is_a_no_show_draw(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice, bob = await live.guest("alice"), await live.guest("bob")
            code = await live.invite(alice)
            await live.invite_post(bob, code, "join")
            await live.invite_post(alice, code, "ready")
            match_id = (await live.invite_post(bob, code, "ready")).json()["match_id"]
            live.clock.advance(live.settings.reconnect_window_s)  # nobody connected
            await live.run_until(lambda: live.row(match_id)[0].status == "saved")
            row, sides = live.row(match_id)
            assert row.end_reason == "no_show"
            assert [s.result for s in sides] == ["draw", "draw"]

    asyncio.run(scenario())


def test_server_stop_aborts_a_running_match(live_settings: Settings) -> None:
    async def scenario() -> tuple[str, sessionmaker[Session]]:
        async with live_server(live_settings) as live:
            response = await live.bot_match(await live.guest("alice"))
            return str(response.json()["match_id"]), live.sessions

    match_id, sessions = asyncio.run(scenario())
    with sessions() as session:
        match = session.get(Match, int(match_id))
        assert match is not None
        assert (match.status, match.end_reason) == ("aborted", "server_stopped")
        results = session.execute(
            select(MatchPlayer.result).where(MatchPlayer.match_id == match.id)
        ).scalars()
        assert list(results) == [None, None]


def test_orphan_rows_are_aborted_at_startup(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            with live.sessions.begin() as session:
                session.add(Match(id=77, map_id="m", ruleset_hash="x", status="running"))
            assert abort_orphans(live.sessions) == 1
            row = live.row("77")[0]
            assert (row.status, row.end_reason) == ("aborted", "server_restart")
            assert abort_orphans(live.sessions) == 0

    asyncio.run(scenario())


# End reason of the runner ------------------------------------------------------------------


@pytest.mark.parametrize(("connect", "expected"), [(True, "disconnect"), (False, "no_show")])
def test_end_reason_of_a_technical_defeat(connect: bool, expected: str) -> None:
    async def scenario() -> None:
        rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
        runner = MatchRunner(
            "t",
            "web",
            load_map(ROOT / "maps" / "fixtures" / "web.json"),
            rules,
            (1, 2),
            ManualClock(),
        )
        assert runner.end_reason() is None
        if connect:
            runner.attach(0)
        runner.technical_defeat(0)
        runner.step()
        assert runner.finished and runner.end_reason() == expected

    asyncio.run(scenario())


def test_end_reason_of_a_normal_end() -> None:
    async def scenario() -> None:
        rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
        runner = MatchRunner(
            "t",
            "web",
            load_map(ROOT / "maps" / "fixtures" / "web.json"),
            rules,
            (1, 2),
            ManualClock(),
        )
        runner.submit(0, 1, ForfeitCmd())
        runner.step()
        assert runner.end_reason() == "forfeit"

    asyncio.run(scenario())


# Rulesets ------------------------------------------------------------------------------------


def test_test_short_ruleset_is_not_for_prod() -> None:
    short, full = ROOT / "rulesets" / "test-short.toml", ROOT / "rulesets" / "mvp-0.toml"
    for env in ("dev", "e2e"):
        assert Settings(env=env, ruleset_path=short).ruleset_path == short  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="only for dev and e2e"):
        Settings(env="prod", ruleset_path=short)
    assert Settings(env="prod", ruleset_path=full).env == "prod"


def test_ruleset_is_archived_next_to_the_bundled_archive(tmp_path: Path) -> None:
    bundled, volume = ROOT / "rulesets" / "archive", tmp_path / "data" / "rulesets"
    path = ROOT / "rulesets" / "test-short.toml"
    archived = archive_rulesets(path, volume, bundled)
    assert archived == volume / f"{ruleset_hash(load_ruleset(path))}.toml"
    assert archived.read_bytes() == path.read_bytes()
    for file in bundled.glob("*.toml"):
        assert (volume / file.name).exists(), "bundled archive stays readable"
    assert archive_rulesets(path, volume, bundled) == archived  # again: no-op
    assert archive_rulesets(path, bundled, bundled).parent == bundled  # image dir: nothing copied


def test_server_archives_its_ruleset_at_start(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings):
            name = f"{ruleset_hash(load_ruleset(live_settings.ruleset_path))}.toml"
            assert (live_settings.rulesets_dir / name).is_file()

    asyncio.run(scenario())


# Ratings of rated matches (RAT-02) -------------------------------------------------------------
#
# Expected numbers come from an independent Glicko-2 implementation (the PyPI package
# ``glicko2``, tau = 0.5), not from ``gow_server.rating``: two new players, the first one wins
# twice in a row. The displayed rating is ``r - 2 * RD``.
#
#                    first win              second win
#   winner r / RD    1662.3109 / 290.3190   1720.3172 / 260.4888
#   loser r / RD     1337.6891 / 290.3190   1279.6828 / 260.4888
#   winner displayed 1082 (from 800)        1199 (from 1082)
#   loser displayed  757 (from 800)         759 (from 757)


async def _play_rated(live: Live, mapdef: MapDef, accounts: tuple[int, int], loser: int) -> int:
    """Start a rated match between two accounts, ``loser`` (a slot) forfeits, wait for the save."""
    lifecycle = live.lifecycle
    rules = load_ruleset(live.settings.ruleset_path)
    record = lifecycle.open_record()
    runner = await lifecycle.start(
        record, "web", mapdef, rules, accounts, private=False, rated=True
    )
    assert runner.submit(loser, 1, ForfeitCmd())
    pk = int(runner.match_id)
    await live.run_until(lambda: live.row(runner.match_id)[0].status == "saved")
    return pk


def _ratings(live: Live, accounts: tuple[int, int]) -> list[Rating]:
    with live.sessions() as session:
        return [session.get_one(Rating, a) for a in accounts]


def test_two_rated_matches_in_a_row_and_no_double_counting(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            mapdef = load_map(live.settings.maps_dir / "web.json")
            alice = await live.account(await live.guest("alice"))
            bob = await live.account(await live.guest("bob"))

            first = await _play_rated(live, mapdef, (alice, bob), loser=1)
            row, sides = live.row(str(first))
            assert row.rating_applied
            assert [s.result for s in sides] == ["win", "loss"]
            assert [round(s.rating_before or 0) for s in sides] == [800, 800]
            assert [round(s.rating_after or 0) for s in sides] == [1082, 757]
            win, loss = _ratings(live, (alice, bob))
            assert (win.rating, win.rd) == pytest.approx((1662.3109, 290.3190), abs=0.001)
            assert (loss.rating, loss.rd) == pytest.approx((1337.6891, 290.3190), abs=0.001)
            assert (win.rated_matches, loss.rated_matches) == (1, 1)

            second = await _play_rated(live, mapdef, (alice, bob), loser=1)
            _, sides = live.row(str(second))
            assert [round(s.rating_before or 0) for s in sides] == [1082, 757]
            assert [round(s.rating_after or 0) for s in sides] == [1199, 759]
            win, loss = _ratings(live, (alice, bob))
            assert (win.rating, win.rd) == pytest.approx((1720.3172, 260.4888), abs=0.001)
            assert (loss.rating, loss.rd) == pytest.approx((1279.6828, 260.4888), abs=0.001)
            assert (win.rated_matches, loss.rated_matches) == (2, 2)

            # processing a match again changes nothing
            with live.sessions.begin() as session:
                assert apply_match(session, first) is False
                assert apply_match(session, second) is False
            again = _ratings(live, (alice, bob))
            assert [(r.rating, r.rd, r.volatility, r.rated_matches) for r in again] == [
                (win.rating, win.rd, win.volatility, 2),
                (loss.rating, loss.rd, loss.volatility, 2),
            ]

    asyncio.run(scenario())


def test_unrated_matches_do_not_touch_ratings(live_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice, bob = await live.guest("alice"), await live.guest("bob")
            code = await live.invite(alice)
            await live.invite_post(bob, code, "join")
            await live.invite_post(alice, code, "ready")
            match_id = (await live.invite_post(bob, code, "ready")).json()["match_id"]
            runner = live.lifecycle.manager.get(match_id)
            assert runner is not None and runner.ratings is None
            assert runner.submit(0, 1, ForfeitCmd())
            await live.run_until(lambda: live.row(match_id)[0].status == "saved")
            row, sides = live.row(match_id)
            assert not row.rated and not row.rating_applied
            assert [s.rating_after for s in sides] == [None, None]
            with live.sessions() as session:
                assert session.execute(select(Rating)).first() is None
                # even a match flagged as rated is not rated without a result or with a bot
                assert apply_match(session, int(match_id)) is False

    asyncio.run(scenario())


def test_rated_flag_is_ignored_for_a_bot_match(live_settings: Settings) -> None:
    """DEC-06: a match against a bot never changes a rating, whatever the caller passes."""

    async def scenario() -> None:
        async with live_server(live_settings) as live:
            alice = await live.guest("alice")
            match_id = (await live.bot_match(alice)).json()["match_id"]
            with live.sessions.begin() as session:
                session.get_one(Match, int(match_id)).rated = True  # a bug elsewhere
            runner = live.lifecycle.manager.get(match_id)
            assert runner is not None and runner.bot is not None
            assert runner.submit(1 - runner.bot.slot, 1, ForfeitCmd())
            await live.run_until(lambda: live.row(match_id)[0].status == "saved")
            _, sides = live.row(match_id)
            assert [s.rating_after for s in sides] == [None, None]
            with live.sessions() as session:
                assert session.execute(select(Rating)).first() is None
                assert session.execute(select(MatchPlayer.rating_before)).scalars().all() == [
                    None,
                    None,
                ]

    asyncio.run(scenario())
