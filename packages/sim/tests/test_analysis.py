"""Match analysis (BOT-04): definitions on hand-made logs, recorder and replays on real matches."""

import dataclasses
from pathlib import Path
from typing import cast

from gow_sim.analysis import (
    CP_CATEGORIES,
    PLACES,
    UNFINISHED,
    CommandRecord,
    MatchLog,
    MatchRecorder,
    MoveRecord,
    analyze,
    analyze_stats,
    charge_stock,
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
from gow_sim.match import SIM_VERSION, Match, run_headless
from gow_sim.replay import REPLAY_SUFFIX, analyze_replay, read_replay, replay_log
from gow_sim.ruleset import KindTable, Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode, Event, Group, Mode, Packet, event

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
    stock: tuple[tuple[int, ...], tuple[int, ...]] = ((), ()),
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
        stock=stock,
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
        log = replay_log(file, ROOT / "rulesets" / "archive", ROOT / "maps" / "fixtures")
        m, stats = analyze(log), analyze_stats(log)
        assert m.ticks == final or m.reason != UNFINISHED  # a match may end before the log does
        assert m.accepted[0] + m.rejected[0] >= m.orders[0]
        assert m.sieges_won[0] <= m.captures[0]
        again = replay_log(file, ROOT / "rulesets" / "archive", ROOT / "maps" / "fixtures")
        assert m == analyze(again)
        assert stats == analyze_stats(again)
        # The statistics agree with the metrics and with themselves (#375).
        for p, per in enumerate(stats.players):
            assert sum(t for _, t in per.stance_ticks) == log.ticks
            assert sum(per.apm_by_minute) == per.commands
            assert per.orders == m.orders[p]
            assert per.cp_total == sum(c for _, c in per.cp_by_category) >= 0
        # The charge stock (#310): one sample per tick, and burning is a part of production.
        for p in (0, 1):
            assert len(log.stock[p]) == log.ticks
            assert 0 <= m.charges_burned[p] <= m.charges_produced[p]
            assert (m.stock_mean_centi[p] or 0) <= m.stock_peak[p] * 100


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
    file = next(GOLDEN.glob(f"*-short-forfeit{REPLAY_SUFFIX}"))  # the shortest golden match
    archive, maps = ROOT / "rulesets" / "archive", ROOT / "maps" / "fixtures"
    assert analyze_replay(file, archive, maps) == analyze(replay_log(file, archive, maps))


# Charge stock and burned share (#310) -----------------------------------------------------------
#
# Definitions: the docstring of ``gow_sim.analysis`` and ``docs/balance/README.md``. Expected
# values are worked out by hand from the definition.


def test_stock_mean_peak_and_burned_share_from_a_hand_made_log() -> None:
    # Player 0 samples 2, 4, 6, 3: sum 15, mean 15 / 4 = 3.75 -> 375 hundredths, peak 6.
    # Player 1 samples 0, 0, 0, 1: sum 1, mean 0.25 -> 25, peak 1.
    # Player 0 produced 3 + 3 = 6 and burned 2 + 1 = 3: 3 * 1000 // 6 = 500 per mille.
    # Player 1 produced 3 and burned 1: 1000 // 3 = 333 (rounded down). Charges lost on a road
    # (``packet_lost``) are no burning.
    events = [
        event(10, "charges_produced", player=0, node=0, charges=3, spill=2),
        event(10, "charges_overflow", player=0, node=0, charges=2),
        event(10, "charges_produced", player=1, node=3, charges=3, spill=1),
        event(10, "charges_overflow", player=1, node=3, charges=1),
        event(60, "charges_produced", player=0, node=0, charges=3, spill=1),
        event(60, "charges_overflow", player=0, node=1, charges=1),
        event(60, "packet_lost", packet=9, player=0, edge=0, charges=5),
    ]
    m = analyze(_log(events, ticks=4, stock=((2, 4, 6, 3), (0, 0, 0, 1))))
    assert m.stock_mean_centi == (375, 25)
    assert m.stock_peak == (6, 1)
    assert m.charges_produced == (6, 3)
    assert m.charges_burned == (3, 1)
    assert m.burned_permille == (500, 333)


def test_stock_metrics_without_samples_or_production_are_undefined() -> None:
    m = analyze(_log([], ticks=0))
    assert m.stock_mean_centi == (None, None)
    assert m.stock_peak == (0, 0)
    assert m.burned_permille == (None, None)
    assert (m.charges_produced, m.charges_burned) == ((0, 0), (0, 0))
    data = analyze(_log([], ticks=1, stock=((7,), (0,)))).to_json()
    assert data["stock_mean_centi"] == [700, 0]
    assert data["stock_peak"] == [7, 0]
    assert data["burned_permille"] == [None, None]


def test_charge_stock_sums_warehouses_packets_and_charged_units() -> None:
    # Map dec18: player 0 owns K = 0, A = 1, B = 2, C = 3; player 1 owns the mirror cities.
    match = Match(load_map(TESTS / "maps" / "dec18.json"), _script_rules(), bytes(range(32)))
    state = match.state
    for node, charges in ((K, 3), (A, 1), (B, 0), (C, 2)):
        state.nodes[node].warehouse = charges  # player 0: 3 + 1 + 0 + 2 = 6
    mirror = [n for n, node in sorted(state.nodes.items()) if node.owner == 1]
    state.nodes[mirror[0]].warehouse = 4  # player 1: 4
    for owner, units, charged, node in ((0, 3, 2, K), (1, 2, 1, mirror[0]), (0, 1, 0, A)):
        gid = state.new_id()
        state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    for owner, charges in ((0, 2), (1, 5)):  # packets: 2 for player 0, 5 for player 1
        pid = state.new_id()
        state.packets[pid] = Packet(pid, owner, 0, K, charges, 1, 31)
    # player 0: warehouses 6 + packets 2 + charged units 2 (the uncharged unit adds nothing) = 10
    # player 1: warehouses 4 + packets 5 + charged units 1 = 10
    assert charge_stock(state) == (10, 10)
    recorder = MatchRecorder()
    recorder.begin(match)
    recorder.record(match, [])
    state.nodes[K].warehouse = 0  # player 0 drops to 7
    recorder.record(match, [])
    assert recorder.log().stock == ((10, 7), (10, 10))


def test_an_idle_match_stock_and_burning_by_hand() -> None:
    # Map dec28, ruleset mvp-1, two idle players, 700 ticks. A quantum comes every 50 ticks:
    # balance stance, 100 * 50 // 100 = 50 hundredths of CP into charges, times 2 charges per CP
    # = 100 hundredths = 1 charge per quantum, at ticks 50, 100, ..., 700: 14 charges.
    # Storage of a player: capital 6 + three medium cities 2 each = 12. Nothing leaves it (no
    # units, no fights), so the stock at tick t is min(12, t // 50) and the 13th and 14th
    # charge (ticks 650 and 700) burn, wherever the supply keeps the rest (packets count).
    # Samples of t = 1..700: 49 zeros, then 50 ticks each at 1..11, then 12 for ticks
    # 600..700 (101 ticks): sum = 50 * (1 + ... + 11) + 12 * 101 = 3300 + 1212 = 4512,
    # mean = 4512 * 100 // 700 = 644 (6.44 charges), peak 12, burned 2 * 1000 // 14 = 142.
    rules = load_ruleset(ROOT / "rulesets" / "mvp-1.toml")
    mapdef = load_map(TESTS / "maps" / "dec28.json")

    class Idle:
        def decide(self, view: object, tick: int) -> list[Command]:
            del view, tick
            return []

    recorder = MatchRecorder()
    run_headless(mapdef, rules, [Idle(), Idle()], max_ticks=700, observer=recorder)
    log = recorder.log()
    m = analyze(log)
    assert log.ticks == 700
    assert [len(s) for s in log.stock] == [700, 700]
    assert log.stock[0][48:50] == (0, 1)  # ticks 49 and 50
    assert max(log.stock[0]) == 12
    assert m.stock_mean_centi == (644, 644)
    assert m.stock_peak == (12, 12)
    assert m.charges_produced == (14, 14)
    assert m.charges_burned == (2, 2)
    assert m.burned_permille == (142, 142)


# Charge ledger and flow (#588) --------------------------------------------------------------------


def test_ledger_and_flow_from_a_hand_made_log() -> None:
    # Player 0 starts with 10 charges and ends with 4. Events: produced 5; overflow 1; fights
    # round spent_0 = 2 (and spent_1 = 1 for the enemy); 2 captures at 1 charge; a packet lost 1;
    # a warehouse lost 1; starvation 1 + 1; attrition of a charged unit 1 and of a discharged one 0.
    # Sinks of player 0: 1 + 2 + 2 + 1 + 1 + 2 + 1 = 10; 10 + 5 - 10 - 4 = 1 is the residual.
    # Player 1 starts with 3, produces nothing, loses 1 in the fight and ends with 2: residual 0.
    events = [
        event(5, "charges_produced", player=0, node=0, charges=5, spill=1),
        event(5, "charges_overflow", player=0, node=0, charges=1),
        event(6, "fight_round", fight=1, node=1, spent_0=2, spent_1=1),
        event(7, "node_captured", node=1, player=0),
        event(8, "node_captured", node=2, player=0),
        event(9, "packet_lost", packet=1, player=0, edge=0, charges=1),
        event(9, "warehouse_lost", node=3, owner=0, charges=1),
        event(10, "starvation", player=0, node=0, warehouse=1, units=1),
        event(11, "attrition", node=0, player=0, group=1, charged=True, destroyed=False),
        event(11, "attrition", node=0, player=0, group=2, charged=False, destroyed=True),
        event(12, "packet_sent", packet=2, player=0, edge=0, from_node=0, to_node=1, charges=4),
        event(13, "packet_delivered", packet=2, player=0, node=1, charges=3),
        event(14, "transfer_started", packet=3, player=0, from_node=0, to_node=1, charges=2),
    ]
    log = dataclasses.replace(
        _log(events),
        capture_charge_cost=1,
        places_start=((1, 2, 3, 4, 0, 0), (3, 0, 0, 0, 0, 0)),
        places_end=((1, 0, 1, 1, 1, 0), (0, 0, 2, 0, 0, 0)),
    )
    a, b = analyze(log).flow
    assert (a.start, a.end, a.residual) == (10, 4, 1)
    assert (a.fights, a.captures, a.packets_lost, a.warehouses_lost) == (2, 2, 1, 1)
    assert (a.starved, a.attrition) == (2, 1)
    assert (a.sent, a.delivered, a.transfers) == (4, 3, 2)
    assert (b.start, b.end, b.fights, b.captures, b.residual) == (3, 2, 1, 0, 0)
    data = analyze(log).to_json()
    assert data["charges_residual"] == [1, 0]
    assert data["charges_captures"] == [2, 0]


def test_stock_by_place_means_and_bottleneck_from_a_hand_made_log() -> None:
    # Samples every 10 ticks; 600 ticks per minute. Player 0 has 61 samples (ticks 10..610):
    # the first 60 (ticks 10..600) belong to minute 0, the last (tick 610) to minute 1.
    # Capital 4 in minute 0 and 2 in minute 1; packets 1 for 30 samples and 2 for 30: 150 -> mean
    # (30 * 1 + 30 * 2) * 100 // 60 = 150.
    samples = (*((4, 0, 0, 0, 0, 1 if i < 30 else 2) for i in range(60)), (2, 0, 0, 0, 0, 0))
    log = dataclasses.replace(
        _log([], ticks=610),
        place_samples=(samples, ()),
        bottleneck=((100, 40, 30, 7), (0, 0, 0, 0)),
    )
    a, b = analyze(log).flow
    places = dict(a.stock_by_place_minute)
    assert places["cap_wh"] == (400, 200)
    assert places["packets"] == (150, 0)
    assert places["front_wh"] == (0, 0)
    assert dict(b.stock_by_place_minute)["cap_wh"] == (None, None)  # no sample
    assert (a.front_empty_permille, a.front_empty_cap_has_permille) == (400, 300)
    assert (b.front_empty_permille, b.front_empty_cap_has_permille) == (None, None)
    assert a.cap_full_ticks == 7


def test_an_idle_match_ledger_balances_and_places_add_up() -> None:
    # The idle match of the test above: nothing but the economy, 14 charges produced, 2 burned,
    # no start stock on this map, 12 in the end; places at the end add up to the stock.
    rules = load_ruleset(ROOT / "rulesets" / "mvp-1.toml")
    mapdef = load_map(TESTS / "maps" / "dec28.json")

    class Idle:
        def decide(self, view: object, tick: int) -> list[Command]:
            del view, tick
            return []

    recorder = MatchRecorder()
    run_headless(mapdef, rules, [Idle(), Idle()], max_ticks=700, observer=recorder)
    log = recorder.log()
    for p, flow in enumerate(analyze(log).flow):
        assert (flow.start, flow.end, flow.residual) == (0, 12, 0)
        assert sum(log.places_end[p]) == log.stock[p][-1] == 12
        assert len(log.place_samples[p]) == 70
        assert [len(v) for _, v in flow.stock_by_place_minute] == [2] * len(PLACES)
        # Each sample splits the stock without loss: sum of the means is within the rounding of
        # the stock mean of the same samples (every sample is an integer, 6 places round down).
        exact = sum(sum(s) for s in log.place_samples[p][:60]) * 100 // 60
        parts = sum(v[0] or 0 for _, v in flow.stock_by_place_minute)
        assert exact - len(PLACES) < parts <= exact
