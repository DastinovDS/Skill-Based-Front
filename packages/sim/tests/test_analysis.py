"""Match analysis (BOT-04): definitions on hand-made logs, recorder and replays on real matches."""

import dataclasses
from pathlib import Path
from typing import cast

from gow_sim.analysis import (
    CP_CATEGORIES,
    UNFINISHED,
    CommandRecord,
    MatchLog,
    MatchRecorder,
    MoveRecord,
    analyze,
    analyze_stats,
)
from gow_sim.commands import (
    BuildBarracks,
    CancelOrder,
    CancelRecruit,
    Command,
    Forfeit,
    Move,
    PlayerCommand,
    Recruit,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Split,
    Transfer,
    UpgradeRoad,
    UpgradeWarehouse,
)
from gow_sim.maps import load_map
from gow_sim.match import SIM_VERSION, Match
from gow_sim.replay import REPLAY_SUFFIX, analyze_replay, read_replay, replay_log
from gow_sim.ruleset import KindTable, Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode, Event, Group, Mode, event

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
GOLDEN = TESTS / "golden" / f"v{SIM_VERSION}"
HZ = 10
MINUTE = 60 * HZ


def _log(
    events: list[Event],
    moves: list[MoveRecord] | None = None,
    ticks: int = 100,
    commands: list[CommandRecord] | None = None,
) -> MatchLog:
    # Nodes: 0 is the capital of player 0, 1 and 2 are neutral, 3 is the capital of player 1.
    return MatchLog(
        tick_hz=HZ,
        ticks=ticks,
        events=tuple(events),
        moves=tuple(moves or []),
        commands=tuple(commands or []),
        start_stance="balance",
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
        event(10, "fight_started", node=3, edge=None, attacker=0),  # bounced
        event(20, "fight_ended", node=3, edge=None, attacker=0),
        event(30, "fight_started", node=3, edge=None, attacker=0),  # won: the capture follows
        event(50, "fight_ended", node=3, edge=None, attacker=0),  # at the end (DEC-24)
        event(50, "node_captured", node=3, player=0),
        event(60, "fight_started", node=None, edge=4, attacker=None),  # an edge meeting
        event(70, "node_captured", node=0, player=1),  # walk-in into an empty enemy node
        event(80, "fight_started", node=2, edge=None, attacker=None),  # neutral: no siege
        event(90, "fight_ended", node=2, edge=None, attacker=None),
        event(90, "node_captured", node=2, player=1),
        event(100, "match_ended", winner=0, reason="capital"),
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
        log = replay_log(file, ROOT / "rulesets" / "archive", ROOT / "maps")
        m, stats = analyze(log), analyze_stats(log)
        assert m.ticks == final or m.reason != UNFINISHED  # a match may end before the log does
        assert m.accepted[0] + m.rejected[0] >= m.orders[0]
        assert m.sieges_won[0] <= m.captures[0]
        again = replay_log(file, ROOT / "rulesets" / "archive", ROOT / "maps")
        assert m == analyze(again)
        assert stats == analyze_stats(again)
        # The statistics agree with the metrics and with themselves (#375).
        for p, per in enumerate(stats.players):
            assert sum(t for _, t in per.stance_ticks) == log.ticks
            assert sum(per.apm_by_minute) == per.commands
            assert per.orders == m.orders[p]
            assert per.cp_total == sum(c for _, c in per.cp_by_category) >= 0


# Player statistics (#375) ---------------------------------------------------------------------
#
# Definitions: the docstring of ``gow_sim.analysis``. The numbers below are worked out by hand
# from the script and the prices, not read from the output of the code.


def _cmd(
    tick: int, kind: str, cost: int = 0, *, ok: bool = True, planned: bool = False
) -> CommandRecord:
    return CommandRecord(tick, 0, kind, ok, cost if ok else 0, planned)


def test_stance_line_without_changes_is_the_start_stance_for_the_whole_match() -> None:
    p0, p1 = analyze_stats(_log([], ticks=650)).players
    assert p0.stance_timeline == p1.stance_timeline == ((0, "balance"),)
    assert dict(p0.stance_ticks) == {"economy": 0, "balance": 650, "war": 0}


def test_stance_set_at_tick_one_leaves_no_ticks_to_the_start_stance() -> None:
    events = [
        event(1, "stance_changed", player=0, stance="war"),
        event(300, "stance_changed", player=0, stance="economy"),
        event(300, "stance_changed", player=1, stance="economy"),
    ]
    p0, p1 = analyze_stats(_log(events, ticks=1000)).players
    assert p0.stance_timeline == ((0, "balance"), (1, "war"), (300, "economy"))
    # war works in ticks 1..299, economy in 300..1000
    assert dict(p0.stance_ticks) == {"economy": 701, "balance": 0, "war": 299}
    # player 1: balance in ticks 1..299, economy in 300..1000
    assert dict(p1.stance_ticks) == {"economy": 701, "balance": 299, "war": 0}


def test_apm_counts_minutes_by_tick_and_leaves_out_forfeit() -> None:
    commands = [
        _cmd(1, "SetFront"),
        _cmd(MINUTE, "SetFront"),  # the last tick of minute 0
        _cmd(MINUTE + 1, "SetRearMin"),  # the first tick of minute 1
        _cmd(MINUTE + 2, "SetRearMin", ok=False),  # sent, rejected: counts as sent
        _cmd(MINUTE + 3, "Forfeit"),
    ]
    p0, p1 = analyze_stats(_log([], ticks=MINUTE + 3, commands=commands)).players
    assert (p0.commands, p0.rejected) == (4, 1)
    assert p0.apm_by_minute == (2, 2)
    assert p0.apm_peak == 2
    assert p0.apm_avg == round(4 * MINUTE / (MINUTE + 3), 3)  # 4 commands in 603 ticks = 3.98
    assert (p1.commands, p1.apm_by_minute, p1.apm_peak) == (0, (0, 0), 0)


def test_apm_of_an_empty_match_is_undefined() -> None:
    p0, _ = analyze_stats(_log([], ticks=0)).players
    assert p0.apm_avg is None
    assert p0.apm_by_minute == (0,)


def test_cp_by_category_sums_the_prices_charged() -> None:
    # Prices as in mvp-1: move 1 CP, planned move 2, defense 2, road 0.5, recruit 1, barracks 3,
    # warehouse 2; transfer 0.4 and split 0.1 and cancel 0.1 are invented to fill the categories.
    commands = [
        _cmd(10, "Move", 100),
        _cmd(11, "Move", 100),
        _cmd(12, "Move", 200, planned=True),
        _cmd(13, "SetMode", 200),
        _cmd(14, "Recruit", 100),
        _cmd(15, "Recruit", 100),
        _cmd(16, "CancelRecruit"),
        _cmd(17, "UpgradeRoad", 50),
        _cmd(18, "BuildBarracks", 300),
        _cmd(19, "UpgradeWarehouse", 200),
        _cmd(20, "Transfer", 40),
        _cmd(21, "Split", 10),
        _cmd(22, "CancelOrder", 10),
        _cmd(23, "Move", 100, ok=False),  # rejected: nothing charged
        CommandRecord(24, 1, "Move", True, 100),  # the other player
    ]
    events = [
        event(16, "recruit_cancelled", player=0, node=0, cp=100),
        event(30, "recruit_cancelled", player=1, node=3, cp=50),  # the other player
    ]
    p0, p1 = analyze_stats(_log(events, commands=commands)).players
    assert tuple(c for c, _ in p0.cp_by_category) == CP_CATEGORIES
    assert dict(p0.cp_by_category) == {
        "move": 200,
        "planned_move": 200,
        "mode": 200,
        "recruit": 100,  # 2 * 100 - 100 refunded
        "road": 50,
        "barracks": 300,
        "warehouse": 200,
        "transfer": 40,
        "other": 20,
    }
    assert (p0.cp_refunded, p0.cp_total) == (100, 1310)
    assert dict(p1.cp_by_category)["move"] == 100
    assert dict(p1.cp_by_category)["recruit"] == -50  # a refund with no charge in this log
    assert p1.cp_total == 50


def test_stats_to_json_is_plain_data() -> None:
    data = analyze_stats(_log([], commands=[_cmd(5, "SetFront")])).to_json()
    players = data["players"]
    assert isinstance(players, list)
    assert players[0]["stance_timeline"] == [[0, "balance"]]
    assert players[0]["supply"] == {
        "set_front": [5],
        "set_rear_min": [],
        "transfer": [],
        "transfer_charges": 0,
    }
    assert list(cast(dict[str, int], players[0]["cp_by_category"])) == list(CP_CATEGORIES)
    assert players[1]["planned_share"] is None


# A tiny match with a script ---------------------------------------------------------------------
#
# Map ``dec18`` (the same as in test_dec18.py): player 0 owns K = 0 (capital), A = 1, B = 2,
# C = 3 (medium cities); P = 4 is a neutral province next to K and B; road K-A is edge 0.
# Rules: ``mvp-0`` with the numbers pinned here, no CP regeneration, ``city_upgrades`` on (the
# warehouse of a medium city holds 2 charges at level 0, the capital's holds 6).
# Prices in hundredths of CP: move 100, planned move 250, defense 200, road 50, recruit 100,
# barracks 300, warehouse 200, transfer 40, split 10, cancel 10; the rest is free.

K, A, B, C, P = 0, 1, 2, 3, 4


def _script_rules() -> Ruleset:
    base = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    return dataclasses.replace(
        base,
        cp=dataclasses.replace(base.cp, start=3000, cap=5000, per_period=0),
        economy=dataclasses.replace(base.economy, start_stance=Stance.BALANCE),
        orders=dataclasses.replace(
            base.orders,
            stance_cooldown_ticks=100,
            cost=dataclasses.replace(
                base.orders.cost,
                move=100,
                planned_move=250,
                cancel=10,
                split=10,
                merge=0,
                attack=0,
                defense=200,
                build=50,
                recruit=100,
                stance=0,
                front=0,
                rear_min=0,
                transfer=40,
                barracks=300,
                warehouse=200,
            ),
        ),
        recruit=dataclasses.replace(
            base.recruit, unit_ticks=30, queue_max=3, refund_started_pct=50
        ),
        city_upgrades=dataclasses.replace(base.city_upgrades, enabled=True),
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
    )


def _scripted_match() -> MatchLog:
    match = Match(load_map(TESTS / "maps" / "dec18.json"), _script_rules(), bytes(range(32)))
    state = match.state
    gids: dict[str, int] = {}
    for name, units, node in (("g1", 1, A), ("g2", 1, B), ("g3", 1, C), ("g4", 2, K)):
        gid = state.new_id()
        state.groups[gid] = Group(gid, 0, units, units, Mode.ATTACK, AtNode(node))
        gids[name] = gid
    g1, g2, g3, g4 = (gids[n] for n in ("g1", "g2", "g3", "g4"))
    p0: dict[int, list[Command]] = {
        5: [SetStance(Stance.WAR)],
        50: [SetStance(Stance.ECONOMY)],  # rejected: the cooldown of 100 ticks from tick 5
        105: [SetStance(Stance.ECONOMY)],
        150: [Recruit(K), Recruit(K)],
        160: [CancelRecruit(K)],  # the second unit of two: all 100 back
        170: [CancelRecruit(K)],  # the unit in production: 100 * 50 // 100 = 50 back
        200: [Move(g1, P), Move(g2, P, planned=True), Move(g3, B, planned=True)],
        205: [CancelOrder(g1)],  # g1 is on the road
        215: [Split(g4, 1)],
        220: [SetMode(g4, Mode.DEFENSE)],
        230: [UpgradeRoad(0)],
        240: [UpgradeRoad(0)],  # rejected: the road is being built
        250: [BuildBarracks(A)],
        260: [UpgradeWarehouse(B)],
        270: [UpgradeWarehouse(A)],  # rejected: A is building the barracks
        300: [SetFront(0, A)],
        310: [SetFront(1, B)],
        320: [SetRearMin(3)],
        330: [SetRearMin(2)],
        400: [Transfer(K, A, 3)],  # cut to the room of A (2)
        410: [Transfer(K, B, 1)],
        600: [SetRearMin(0)],  # the last tick of minute 0
        601: [SetFront(0, None)],  # the first tick of minute 1
    }
    p1: dict[int, list[Command]] = {10: [SetStance(Stance.ECONOMY)], 650: [Forfeit()]}
    recorder = MatchRecorder()
    recorder.begin(match)
    seq = {0: 0, 1: 0}
    for tick in range(1, 651):
        batch: list[PlayerCommand] = []
        for player, script in ((0, p0), (1, p1)):
            for cmd in script.get(tick, []):
                batch.append(PlayerCommand(player, seq[player], cmd))
                seq[player] += 1
        if tick == 400:  # warehouses as the transfers need them
            state.nodes[K].warehouse, state.nodes[A].warehouse = 3, 0
        if tick == 410:
            state.nodes[K].warehouse, state.nodes[B].warehouse = 1, 0
        match.step(batch)
        recorder.record(match, batch)
    return recorder.log()


def test_scripted_match_statistics() -> None:
    log = _scripted_match()
    assert log.ticks == 650
    p0, p1 = analyze_stats(log).players

    # Stance: balance in ticks 1..4, war in 5..104, economy in 105..650.
    assert p0.stance_timeline == ((0, "balance"), (5, "war"), (105, "economy"))
    assert dict(p0.stance_ticks) == {"economy": 546, "balance": 4, "war": 100}
    assert p1.stance_timeline == ((0, "balance"), (10, "economy"))
    assert dict(p1.stance_ticks) == {"economy": 641, "balance": 9, "war": 0}

    # APM: 26 commands (3 rejected), 25 in minute 0 (the last at tick 600) and 1 in minute 1.
    assert (p0.commands, p0.rejected) == (26, 3)
    assert p0.apm_by_minute == (25, 1)
    assert (p0.apm_avg, p0.apm_peak) == (24.0, 25)  # 26 * 600 / 650
    assert (p1.commands, p1.rejected, p1.apm_by_minute) == (1, 0, (1, 0))  # Forfeit is not counted
    assert p1.apm_avg == 0.923  # 600 / 650

    # Supply actions and the charges the transfers sent (3 cut to 2, then 1).
    assert p0.front_ticks == (300, 310, 601)
    assert p0.rear_min_ticks == (320, 330, 600)
    assert p0.transfer_ticks == (400, 410)
    assert p0.transfer_charges == 3

    # Orders: two planned of three, one planned among the two attacks (the neutral province).
    assert (p0.orders, p0.planned_orders) == (3, 2)
    assert p0.planned_share == 0.6667
    assert p0.planned_attack_share == 0.5
    assert (p1.orders, p1.planned_share, p1.planned_attack_share) == (0, None, None)

    # CP in hundredths: 1 move, 2 planned at 250, defense, 2 recruits less the refunds 100 + 50,
    # road, barracks, warehouse, 2 transfers at 40, split and cancel at 10.
    assert dict(p0.cp_by_category) == {
        "move": 100,
        "planned_move": 500,
        "mode": 200,
        "recruit": 50,
        "road": 50,
        "barracks": 300,
        "warehouse": 200,
        "transfer": 80,
        "other": 20,
    }
    assert (p0.cp_refunded, p0.cp_total) == (150, 1500)
    assert p1.cp_total == 0
    assert (log.accepted, log.rejected) == ((23, 2), (3, 0))  # player 1: stance and Forfeit


def test_analyze_replay_is_analyze_of_the_replay_log() -> None:
    file = GOLDEN / f"pereval-short-forfeit{REPLAY_SUFFIX}"  # the shortest golden match
    archive, maps = ROOT / "rulesets" / "archive", ROOT / "maps"
    assert analyze_replay(file, archive, maps) == analyze(replay_log(file, archive, maps))
