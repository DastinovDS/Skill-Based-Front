"""Match analysis (BOT-04): definitions on hand-made logs, recorder and replays on real matches."""

from pathlib import Path

from gow_sim.analysis import UNFINISHED, MatchLog, MoveRecord, analyze
from gow_sim.match import SIM_VERSION
from gow_sim.replay import REPLAY_SUFFIX, analyze_replay, read_replay
from gow_sim.state import Event, event

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
GOLDEN = TESTS / "golden" / f"v{SIM_VERSION}"
HZ = 10
MINUTE = 60 * HZ


def _log(events: list[Event], moves: list[MoveRecord] | None = None, ticks: int = 100) -> MatchLog:
    # Nodes: 0 is the capital of player 0, 1 and 2 are neutral, 3 is the capital of player 1.
    return MatchLog(
        tick_hz=HZ,
        ticks=ticks,
        events=tuple(events),
        moves=tuple(moves or []),
        initial_owners=(0, None, None, 1),
        vp=(5, 3),
        accepted=(4, 2),
        rejected=(1, 0),
    )


def test_unfinished_empty_match() -> None:
    m = analyze(_log([]))
    assert (m.winner, m.reason, m.ticks, m.duration_s) == (None, UNFINISHED, 100, 10.0)
    assert m.cities == (1, 1)
    assert m.captures_by_minute == ((0,), (0,))
    assert m.planned_attack_share == (None, None)


def test_neutral_captures_are_no_sieges_and_go_by_minute() -> None:
    events = [
        event(5, "node_captured", node=1, player=0),
        event(MINUTE, "node_captured", node=2, player=1),  # last tick of minute 0
        event(MINUTE + 1, "node_captured", node=2, player=0),  # first tick of minute 1: a siege
    ]
    m = analyze(_log(events, ticks=MINUTE + 1))
    assert m.captures == (2, 1)
    assert m.captures_by_minute == ((1, 1), (1, 0))
    assert (m.sieges, m.sieges_won) == ((1, 0), (1, 0))
    assert m.cities == (3, 1)


def test_siege_attempts_and_successes() -> None:
    events = [
        event(10, "fight", node=3, edge=None, attacker=0),  # bounced
        event(20, "fight", node=3, edge=None, attacker=0),  # won: the capture follows
        event(20, "node_captured", node=3, player=0),
        event(30, "fight", node=None, edge=4, attacker=None),  # an edge meeting: no siege
        event(40, "node_captured", node=0, player=1),  # walk-in into an empty enemy node
        event(50, "fight", node=2, edge=None, attacker=None),  # neutral fight: no siege
        event(50, "node_captured", node=2, player=1),
        event(60, "match_ended", winner=0, reason="capital"),
    ]
    m = analyze(_log(events))
    assert m.sieges == (2, 1)
    assert m.sieges_won == (1, 1)
    assert m.captures == (1, 2)
    assert (m.winner, m.reason) == (0, "capital")


def test_planned_attack_share_counts_attacks_only() -> None:
    moves = [
        MoveRecord(1, 0, planned=True, attack=True),
        MoveRecord(2, 0, planned=False, attack=True),
        MoveRecord(3, 0, planned=True, attack=False),  # a planned move home: not an attack
        MoveRecord(4, 1, planned=False, attack=False),
    ]
    m = analyze(_log([], moves))
    assert m.orders == (3, 1)
    assert m.attack_orders == (2, 0)
    assert m.planned_attack_orders == (1, 0)
    assert m.planned_attack_share == (0.5, None)


def test_to_json_is_plain_data() -> None:
    data = analyze(_log([event(60, "match_ended", winner=None, reason="draw")])).to_json()
    assert data["winner"] is None
    assert data["vp"] == [5, 3]
    assert data["captures_by_minute"] == [[0], [0]]


def test_replays_of_real_matches_are_analyzed() -> None:
    files = sorted(GOLDEN.glob(f"*{REPLAY_SUFFIX}"))
    assert files
    for file in files:
        final = read_replay(file).checkpoints[-1].tick
        m = analyze_replay(file, ROOT / "rulesets" / "archive", ROOT / "maps")
        assert m.ticks == final or m.reason != UNFINISHED  # a match may end before the log does
        assert m.accepted[0] + m.rejected[0] >= m.orders[0]
        assert m.sieges_won[0] <= m.captures[0]
        assert m == analyze_replay(file, ROOT / "rulesets" / "archive", ROOT / "maps")
