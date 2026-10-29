"""SRV-02: the tick loop of a match and the match manager, on a manual clock."""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Final

import pytest

from gow_protocol import commands as wire
from gow_protocol.codec import SnapshotFrame
from gow_protocol.messages import (
    AckMsg,
    EndReason,
    MatchEndMsg,
    PausedMsg,
    ServerMsg,
    SnapshotMsg,
)
from gow_server.clock import ManualClock
from gow_server.matches import (
    ManagerDrainingError,
    MatchManager,
    MatchRunner,
    Outbox,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import Ruleset, Stance, load_ruleset

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1


@pytest.fixture(scope="module")
def line3() -> MapDef:
    return load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json")


@pytest.fixture(scope="module")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")


def run[T](scenario: Callable[[], Coroutine[None, None, T]]) -> T:
    return asyncio.run(scenario())


async def settle() -> None:
    """Let every task woken by ``ManualClock.advance`` run its tick and go back to sleep."""
    for _ in range(3):
        await asyncio.sleep(0)


async def tick(clock: ManualClock, n: int = 1) -> None:
    for _ in range(n):
        clock.advance(DT)
        await settle()


def drain(box: Outbox) -> list[ServerMsg]:
    """The queued messages; snapshot frames decoded and validated as a client does it."""
    out: list[ServerMsg] = []
    while (msg := box.get_nowait()) is not None:
        out.append(msg.message() if isinstance(msg, SnapshotFrame) else msg)
    return out


def test_two_fake_controllers_play_to_the_end(line3: MapDef, short_rules: Ruleset) -> None:
    """Both players change their stance; the match ends by the timer, no real waiting."""

    async def scenario() -> None:
        clock = ManualClock()
        manager = MatchManager(clock, new_id=lambda: "m1")
        runner = manager.create("line3", line3, short_rules, (101, 202))
        boxes = [runner.attach(0), runner.attach(1)]
        await settle()
        received: list[list[ServerMsg]] = [[], []]
        seqs = [0, 0]
        while manager.get("m1") is not None:
            await tick(clock)
            for player, box in enumerate(boxes):
                msgs = drain(box)
                received[player] += msgs
                snaps = [m for m in msgs if isinstance(m, SnapshotMsg)]
                if snaps and snaps[-1].tick % 100 == 0 and not box.closed:
                    seqs[player] += 1
                    stance = Stance.WAR if seqs[player] % 2 else Stance.ECONOMY
                    assert runner.submit(player, seqs[player], wire.SetStanceCmd(stance=stance))
        assert runner.match.tick == short_rules.match_ticks
        assert clock.now() == pytest.approx(short_rules.match_ticks * DT, abs=DT)
        for player, msgs in enumerate(received):
            acks = [m for m in msgs if isinstance(m, AckMsg)]
            assert [a.seq for a in acks] == list(range(1, seqs[player] + 1))
            assert all(a.reject_code is None for a in acks)
            # applied at the start of the tick after the snapshot that triggered it
            assert [a.applied_tick for a in acks] == [100 * k + 1 for k in range(1, len(acks) + 1)]
            end = msgs[-1]
            assert isinstance(end, MatchEndMsg)
            assert end.tick == short_rules.match_ticks
            final = msgs[-2]
            assert isinstance(final, SnapshotMsg) and final.tick == end.tick
            assert boxes[player].closed
        assert manager.active == 0

    run(scenario)


def test_frozen_clock_does_not_burst(
    line3: MapDef, short_rules: Ruleset, caplog: pytest.LogCaptureFixture
) -> None:
    """The clock jumps 2 s (20 ticks) at once: one step and a new schedule, not 20 steps."""

    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner("m", "line3", line3, short_rules, (1, 2), clock)
        task = asyncio.create_task(runner.run())
        await settle()
        assert runner.match.tick == 1  # the first tick is due at once
        await tick(clock, 5)
        assert runner.match.tick == 6
        clock.advance(2.0)
        await settle()
        assert runner.match.tick == 7
        assert runner.resets == 1
        # The reset is logged at once with its length (#546), not only by the 30 s alert.
        assert any("tick schedule reset" in r.getMessage() for r in caplog.records)
        await tick(clock, 3)
        assert runner.match.tick == 10
        task.cancel()

    run(scenario)


def test_small_lag_is_caught_up(line3: MapDef, short_rules: Ruleset) -> None:
    """Up to 3 ticks behind the loop catches up step by step without a reset."""

    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner("m", "line3", line3, short_rules, (1, 2), clock)
        task = asyncio.create_task(runner.run())
        await settle()
        clock.advance(3 * DT)
        await settle()
        assert runner.match.tick == 4
        assert runner.resets == 0
        task.cancel()

    run(scenario)


def test_pause_waits_and_restarts_schedule(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner("m", "line3", line3, short_rules, (1, 2), clock)
        task = asyncio.create_task(runner.run())
        await settle()
        runner.pause()
        await tick(clock, 30)
        assert runner.match.tick == 1
        runner.resume()
        await settle()
        assert runner.match.tick == 2  # one step at once, no catch-up of the 3 paused seconds
        assert runner.resets == 0
        await tick(clock, 2)
        assert runner.match.tick == 4
        task.cancel()

    run(scenario)


def test_repeated_seq_is_dropped(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner("m", "line3", line3, short_rules, (1, 2), clock)
        box = runner.attach(0)
        cmd = wire.SetStanceCmd(stance=Stance.WAR)
        assert runner.submit(0, 1, cmd)
        assert not runner.submit(0, 1, cmd)
        assert runner.submit(0, 3, cmd)
        assert not runner.submit(0, 2, cmd)
        assert runner.submit(1, 1, cmd)  # seq counts per player
        assert runner.last_seq(0) == 3
        runner.step()
        acks = [m for m in drain(box) if isinstance(m, AckMsg)]
        assert [(a.seq, a.applied_tick) for a in acks] == [(1, 1), (3, 1)]

    run(scenario)


def test_slow_reader_gets_latest_snapshot_and_every_ack(
    line3: MapDef, short_rules: Ruleset
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner("m", "line3", line3, short_rules, (1, 2), clock)
        box = runner.attach(0)
        for seq in range(1, 11):
            runner.submit(0, seq, wire.SetStanceCmd(stance=Stance.WAR))
            runner.step()
        msgs = drain(box)
        assert [m.seq for m in msgs if isinstance(m, AckMsg)] == list(range(1, 11))
        snaps = [m for m in msgs if isinstance(m, SnapshotMsg)]
        assert [s.tick for s in snaps] == [10]

    run(scenario)


def test_outbox_overflow_stops_the_connection() -> None:
    async def scenario() -> None:
        box = Outbox(limit=2)
        for seq in (1, 2, 3):
            box.put(AckMsg(seq=seq, applied_tick=1))
        assert box.overflowed
        assert await box.get() is None

    run(scenario)


class _Crashing(MatchRunner):
    def step(self) -> None:
        if self.match.tick == 3:
            raise RuntimeError("boom")
        super().step()


def test_crash_of_one_match_does_not_stop_another(
    line3: MapDef, short_rules: Ruleset, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        manager = MatchManager(clock)
        bad = _Crashing("bad", "line3", line3, short_rules, (1, 2), clock)
        good = MatchRunner("good", "line3", line3, short_rules, (3, 4), clock)
        bad_box = bad.attach(0)
        manager.start(bad)
        manager.start(good)
        await settle()
        await tick(clock, 10)
        assert manager.get("bad") is None
        assert manager.get("good") is good
        assert good.match.tick == 11
        assert bad_box.closed
        await manager.shutdown()
        assert manager.active == 0

    with caplog.at_level(logging.INFO, logger="gow_server.matches"):
        run(scenario)
    crashes = [r for r in caplog.records if r.getMessage() == "match crashed"]
    assert len(crashes) == 1
    assert crashes[0].__dict__["match_id"] == "bad"
    assert crashes[0].exc_info is not None


def test_draining_refuses_new_matches(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        manager = MatchManager(ManualClock())
        manager.create("line3", line3, short_rules, (1, 2))
        manager.drain()
        with pytest.raises(ManagerDrainingError):
            manager.create("line3", line3, short_rules, (3, 4))
        assert manager.active == 1
        manager.undrain()
        manager.create("line3", line3, short_rules, (3, 4))
        assert manager.active == 2
        await manager.shutdown()

    run(scenario)


def test_match_key_is_secret_and_not_in_repr(line3: MapDef, short_rules: Ruleset) -> None:
    a = MatchRunner("a", "line3", line3, short_rules, (1, 2), ManualClock())
    b = MatchRunner("b", "line3", line3, short_rules, (1, 2), ManualClock())
    assert a.match.match_key != b.match.match_key
    assert len(a.match.match_key) == 32
    assert a.match.match_key.hex() not in repr(a)


# Disconnects and pauses (DEC-05, SRV-04) -------------------------------------------------------


def _runner(
    line3: MapDef, rules: Ruleset, clock: ManualClock, *, private: bool = False
) -> MatchRunner:
    return MatchRunner(
        "m",
        "line3",
        line3,
        rules,
        (1, 2),
        clock,
        private=private,
        reconnect_window_s=5.0,
        pause_max_s=5.0,
    )


def test_window_expiry_queues_a_forfeit_in_the_log_path(
    line3: MapDef, short_rules: Ruleset
) -> None:
    """Nobody is connected at the start; player 1 never comes, player 0 stays."""

    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock)
        box = runner.attach(0)
        task = asyncio.create_task(runner.run())
        await settle()
        await tick(clock, 49)
        assert not runner.finished  # 4.9 s: the window is still open
        await tick(clock, 3)
        await task
        outcome = runner.match.outcome
        assert outcome is not None and outcome.winner == 0
        end = [m for m in drain(box) if isinstance(m, MatchEndMsg)]
        assert [(m.reason, m.winner) for m in end] == [(EndReason.DISCONNECT, 0)]
        # the same path as a command of the player: it has a seq in the player's sequence
        assert runner.last_seq(1) == 1

    run(scenario)


def test_reconnect_inside_the_window_cancels_the_forfeit(
    line3: MapDef, short_rules: Ruleset
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock)
        runner.attach(0)
        box1 = runner.attach(1)
        task = asyncio.create_task(runner.run())
        await settle()
        runner.detach(1, box1)
        await tick(clock, 40)  # 4 s of 5
        runner.attach(1)
        await tick(clock, 100)  # far past the original deadline
        assert not runner.finished
        assert runner.connected(1)
        assert runner.last_seq(1) == 0
        task.cancel()

    run(scenario)


def test_replaced_connection_does_not_start_a_window(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock)
        runner.attach(0)
        old = runner.attach(1)
        task = asyncio.create_task(runner.run())
        await settle()
        runner.attach(1)  # a second tab takes over
        runner.detach(1, old)  # the old connection ends: no longer the current one
        await tick(clock, 100)
        assert not runner.finished
        task.cancel()

    run(scenario)


def test_both_players_gone_is_a_draw(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock)
        task = asyncio.create_task(runner.run())
        await settle()
        await tick(clock, 60)
        await task
        outcome = runner.match.outcome
        assert outcome is not None and outcome.winner is None

    run(scenario)


def test_rated_match_has_no_pause(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> None:
        runner = _runner(line3, short_rules, ManualClock(), private=False)
        assert not runner.request_pause(0)
        assert not runner.paused

    run(scenario)


def test_private_pause_is_one_per_player_and_ends_by_itself(
    line3: MapDef, short_rules: Ruleset
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock, private=True)
        boxes = [runner.attach(0), runner.attach(1)]
        task = asyncio.create_task(runner.run())
        await settle()
        assert runner.request_pause(0)
        assert not runner.request_pause(1)  # already paused
        assert not runner.request_resume(1)  # not their pause
        tick_at_pause = runner.match.tick
        await tick(clock, 30)  # 3 s
        assert runner.match.tick == tick_at_pause
        for box in boxes:
            paused = [m for m in drain(box) if isinstance(m, PausedMsg)]
            assert paused == [PausedMsg(paused=True, by=0, ends_in_s=5)]
        await tick(clock, 25)  # past the 5 s of the pause
        assert not runner.paused
        assert runner.match.tick > tick_at_pause
        for box in boxes:
            assert [m for m in drain(box) if isinstance(m, PausedMsg)] == [
                PausedMsg(paused=False, by=None, ends_in_s=None)
            ]
        assert not runner.request_pause(0)  # spent
        assert runner.request_pause(1)  # the other player has theirs
        task.cancel()

    run(scenario)


def test_pauser_can_resume_early_and_a_reconnect_sees_the_pause(
    line3: MapDef, short_rules: Ruleset
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = _runner(line3, short_rules, clock, private=True)
        runner.attach(0)
        old = runner.attach(1)
        task = asyncio.create_task(runner.run())
        await settle()
        assert runner.request_pause(1)
        await tick(clock, 20)  # 2 s
        runner.detach(1, old)
        box = runner.attach(1)
        assert drain(box) == [PausedMsg(paused=True, by=1, ends_in_s=3)]
        assert runner.request_resume(1)
        await settle()
        assert not runner.paused
        assert [m for m in drain(box) if isinstance(m, PausedMsg)] == [
            PausedMsg(paused=False, by=None, ends_in_s=None)
        ]
        task.cancel()

    run(scenario)


def test_technical_defeat_ends_a_pause(line3: MapDef, short_rules: Ruleset) -> None:
    """A pause must not delay the forfeit of a player who is gone."""

    async def scenario() -> None:
        clock = ManualClock()
        runner = MatchRunner(
            "m",
            "line3",
            line3,
            short_rules,
            (1, 2),
            clock,
            private=True,
            reconnect_window_s=3.0,
            pause_max_s=30.0,
        )
        runner.attach(0)
        task = asyncio.create_task(runner.run())
        await settle()
        assert runner.request_pause(0)
        await tick(clock, 31)
        await tick(clock, 2)
        await task
        outcome = runner.match.outcome
        assert outcome is not None and outcome.winner == 0

    run(scenario)
