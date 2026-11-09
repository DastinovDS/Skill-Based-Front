"""Stances with local progress (DEC-44, #772).

Expected values come from the table of DEC-44 (mechanics.md, section 6), worked out by hand:

| Stance  | CP quantum per | Own capital: 1 charge per |
|---------|----------------|---------------------------|
| War     | 80 ticks       | 400 ticks                 |
| Balance | 100 ticks      | 200 ticks                 |
| Economy | 200 ticks      | 100 ticks                 |

A counter starts at 0 and grows by 1 in ``economy`` of every tick, so a player who stays in a
stance gets its quantum at the ticks ``P, 2P, ...``. A command of tick ``t`` is applied before
``economy`` of tick ``t``. A real change carries each counter over to the periods of the new
stance, ``c * P_new // P_old`` (revised 2026-11-07, #792), so after a change at tick ``t`` the
counter shows ``c' + 1`` at the end of the tick and the next quantum comes at
``t + P_new - c' - 1``.

Map ``dec41`` (rot180): player 0 owns K = 0 (capital) and A = 1, player 1 the mirror, ``16 - n``.
``K`` starts with a warehouse of 6 under ``mvp-5``; the tests below empty it so that nothing spills.
The ruleset is ``mvp-5``: the table above and a built factory every 200 ticks on the global clock.
"""

import tomllib
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from gow_sim.analysis import MatchRecorder, analyze, analyze_stats
from gow_sim.commands import (
    Command,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetStance,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import (
    RulesetError,
    Stance,
    StanceTable,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
)
from gow_sim.ruleset import to_canonical as rules_canonical
from gow_sim.state import Event, GameState, from_canonical, initial_state, state_hash, to_canonical
from gow_sim.systems.economy import carry, economy, factory_period
from gow_sim.view import PlayerView, project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
RULES = load_ruleset(RULESETS / "mvp-5.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A = 0, 1
ENEMY_K = 16
KEY = bytes(range(32))


def _state() -> GameState:
    state = initial_state(MAP, RULES)
    state.nodes[K].warehouse = 0
    state.nodes[ENEMY_K].warehouse = 0
    return state


def _set(state: GameState, stance: Stance, player: int = 0) -> Ok | Reject:
    results, events = apply_commands(state, RULES, [PlayerCommand(player, 0, SetStance(stance))])
    state.events.extend(events)
    return results[0].outcome


def _run(
    state: GameState,
    until: int,
    switches: dict[int, Stance] | None = None,
    player: int = 0,
) -> list[Event]:
    """``economy`` up to the tick ``until``; ``switches``: the stance commands by tick, applied
    before ``economy`` of their tick, as ``Match.step`` does. The warehouses stay roomy: the
    charges are read from the events."""
    made: list[Event] = []
    while state.tick < until:
        state.tick += 1
        state.events = []
        if switches is not None and state.tick in switches:
            assert isinstance(_set(state, switches[state.tick], player), Ok)
        made += economy(state, RULES)
        for n in (K, A, ENEMY_K):
            state.nodes[n].warehouse = 0
    return made


def _charges(events: list[Event], node: int) -> list[int]:
    return [e.tick for e in events if e.kind == "charges_produced" and e.get("node") == node]


def _cp_ticks(state: GameState, until: int, switches: dict[int, Stance]) -> list[int]:
    """The ticks a CP quantum of player 0 lands; CP are taken away, so the cap never bites."""
    quanta: list[int] = []
    while state.tick < until:
        state.players[0].cp = 0
        _run(state, state.tick + 1, switches)
        if state.players[0].cp == RULES.cp.per_period:
            quanta.append(state.tick)
    return quanta


# The ruleset ------------------------------------------------------------------------------------


def _raw(name: str) -> dict[str, Any]:
    return tomllib.loads((RULESETS / f"{name}.toml").read_text(encoding="utf-8"))


def test_the_section_round_trips_and_counts_in_the_hash() -> None:
    assert parse_ruleset(rules_canonical(RULES)) == RULES
    other = replace(
        RULES,
        stances=replace(
            RULES.stances,
            cp_period_ticks=StanceTable(economy=200, balance=100, war=81),
        ),
    )
    assert ruleset_hash(other) != ruleset_hash(RULES)


def test_a_period_of_zero_is_an_error() -> None:
    raw = _raw("mvp-5")
    raw["stances"]["cp_period_ticks"]["war"] = 0
    with pytest.raises(RulesetError, match=r"stances\.cp_period_ticks\.war"):
        parse_ruleset(raw)


# Quanta by stance -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("switch", "cp", "capital"),
    [
        (None, [100, 200, 300, 400], [200, 400]),
        # A change at tick 1: the counters are 0 before ``economy`` of tick 1, as at the start.
        (Stance.WAR, [80, 160, 240, 320, 400], [400]),
        (Stance.ECONOMY, [200, 400], [100, 200, 300, 400]),
    ],
    ids=["balance", "war", "economy"],
)
def test_quantum_ticks_per_stance(switch: Stance | None, cp: list[int], capital: list[int]) -> None:
    switches = {} if switch is None else {1: switch}
    assert _cp_ticks(_state(), 400, switches) == cp
    assert _charges(_run(_state(), 400, switches), K) == capital


def test_the_quantum_is_cp_per_period() -> None:
    state = _state()
    state.players[0].cp = 0
    _run(state, 80, {1: Stance.WAR})
    assert state.players[0].cp == 100  # 1 CP


def test_the_cap_and_the_burn_stay() -> None:
    state = _state()
    state.players[0].cp = RULES.cp.cap
    events = _run(state, 100)
    assert state.players[0].cp == RULES.cp.cap
    # Player 1 starts at 3 CP, far from the cap: only player 0 burns its quantum.
    burned = [(e.tick, e.get("player"), e.get("cp")) for e in events if e.kind == "cp_burned"]
    assert burned == [(100, 0, 100)]


# The switch -------------------------------------------------------------------------------------


# The carry of 2026-11-07 (#792, DEC-44 item 4 revised): ``new = old * new_period // old_period``.
CARRY_TABLE = [
    # (counter, before, stance before, stance after, after): worked out by hand.
    ("capital", 300, Stance.WAR, Stance.ECONOMY, 75),  # 300 * 100 // 400
    ("cp", 60, Stance.WAR, Stance.ECONOMY, 150),  # 60 * 200 // 80
    ("cp", 50, Stance.BALANCE, Stance.WAR, 40),  # 50 * 80 // 100
    ("cp", 33, Stance.BALANCE, Stance.WAR, 26),  # 33 * 80 // 100 = 26.4, rounded down
]


def _periods(counter: str) -> StanceTable:
    assert RULES.stances is not None
    if counter == "cp":
        return RULES.stances.cp_period_ticks
    return RULES.stances.capital_period_ticks


@pytest.mark.parametrize(
    ("counter", "before", "old", "new", "after"), CARRY_TABLE, ids=["C1", "C2", "C3", "C4"]
)
def test_the_carry_table(counter: str, before: int, old: Stance, new: Stance, after: int) -> None:
    periods = _periods(counter)
    assert carry(before, periods.of(old), periods.of(new)) == after
    state = _state()
    me = state.players[0]
    me.stance = old
    setattr(me, f"{counter}_ticks", before)
    assert isinstance(_set(state, new), Ok)
    assert getattr(me, f"{counter}_ticks") == after


def test_war_300_ticks_then_economy() -> None:
    """C1 and C2 in a match: War from tick 1, so at the end of tick 300 the CP counter holds
    300 - 3 * 80 = 60 and the capital counter 300. Economy at tick 301 carries them to 150 and 75;
    tick 301 makes them 151 and 76, so the CP quantum comes at 301 + 49 = 350 and the charges of
    the capital at 301 + 24 = 325, 425."""
    state = _state()
    _run(state, 300, {1: Stance.WAR})
    me = state.players[0]
    assert (me.cp_ticks, me.capital_ticks) == (60, 300)
    state.tick = 301
    assert isinstance(_set(state, Stance.ECONOMY), Ok)
    assert (me.cp_ticks, me.capital_ticks) == (150, 75)
    switches = {1: Stance.WAR, 301: Stance.ECONOMY}
    assert _cp_ticks(_state(), 360, switches) == [80, 160, 240, 350]
    assert _charges(_run(_state(), 430, switches), K) == [325, 425]


def test_a_switch_carries_both_counters() -> None:
    """C3 in a match: Balance to War at tick 151. Before it the counters hold 50 (the quantum of
    tick 100, then ticks 101..150) and 150; War carries them to 50 * 80 // 100 = 40 and
    150 * 400 // 200 = 300, tick 151 makes them 41 and 301. The CP quanta come at 151 + 39 = 190
    and 270, the charge at 151 + 99 = 250."""
    state = _state()
    _run(state, 150)
    me = state.players[0]
    assert (me.cp_ticks, me.capital_ticks) == (50, 150)
    switches = {151: Stance.WAR}
    assert _cp_ticks(_state(), 280, switches) == [100, 190, 270]
    assert _charges(_run(_state(), 640, switches), K) == [250]
    assert _charges(_run(_state(), 650, switches), K) == [250, 650]


def test_no_progress_is_lost_right_before_a_quantum() -> None:
    """The counters hold 99 and 199 at the end of tick 199; Economy at tick 200 carries them to
    99 * 200 // 100 = 198 and 199 * 100 // 200 = 99. Tick 200 makes the capital 100: its charge
    comes at 200 as in Balance, then 300, 400; the CP counter is 199 and its quantum comes at 201
    (the share it had, 99 of 100, is 198 of 200), then 401."""
    switches = {200: Stance.ECONOMY}
    assert _cp_ticks(_state(), 410, switches) == [100, 201, 401]
    assert _charges(_run(_state(), 400, switches), K) == [200, 300, 400]


def test_a_switch_back_costs_at_most_the_rounding() -> None:
    """War at 150 and Balance again at 151. At 150: 49 and 149 carry to 39 and 298, then 40 and
    299. At 151: back to 40 * 100 // 80 = 50 and 299 * 200 // 400 = 149, then 51 and 150. Without
    the switch they would be 51 and 151: the next CP comes at 200 as before, the charge at 201
    instead of 200."""
    switches = {150: Stance.WAR, 151: Stance.BALANCE}
    state = _state()
    _run(state, 151, switches)
    assert (state.players[0].cp_ticks, state.players[0].capital_ticks) == (51, 150)
    assert _cp_ticks(_state(), 260, switches) == [100, 200]
    assert _charges(_run(_state(), 360, switches), K) == [201]


PAIRS = [(a, b) for a in Stance for b in Stance if a is not b]


@pytest.mark.parametrize(("a", "b"), PAIRS, ids=[f"{a}-{b}" for a, b in PAIRS])
def test_a_switch_and_straight_back_never_raises_a_counter(a: Stance, b: Stance) -> None:
    """A to B and back to A in one tick, for every value of both counters below the period of A:
    each ends at or below where it was, so flipping never pays."""
    state = _state()
    me = state.players[0]
    cp, capital = _periods("cp").of(a), _periods("capital").of(a)
    for value in range(max(cp, capital)):
        me.stance, me.cp_ticks, me.capital_ticks = a, value % cp, value % capital
        before = (me.cp_ticks, me.capital_ticks)
        commands = [PlayerCommand(0, 0, SetStance(b)), PlayerCommand(0, 1, SetStance(a))]
        results, _ = apply_commands(state, RULES, commands)
        assert all(isinstance(r.outcome, Ok) for r in results)
        assert me.cp_ticks <= before[0] and me.capital_ticks <= before[1]
        for counter, start in zip(("cp", "capital"), before, strict=True):
            periods = _periods(counter)
            there = carry(start, periods.of(a), periods.of(b))
            assert carry(there, periods.of(b), periods.of(a)) <= start


@pytest.mark.parametrize(("a", "b"), PAIRS, ids=[f"{a}-{b}" for a, b in PAIRS])
def test_a_tick_in_another_stance_counts_at_its_rate_and_no_more(a: Stance, b: Stance) -> None:
    """A to B at tick ``t`` and back at ``t + 1``: the one tick under B adds at most ``1 / P_B``
    of a cycle, the rate of B, to the share the counter had (``c / P_A``). So a counter that B
    makes slower never ends above the counter without the switch; one that B makes faster gains
    what that tick under B is worth, which is the trade of the stance."""
    state = _state()
    me = state.players[0]
    for counter in ("cp", "capital"):
        periods = _periods(counter)
        pa, pb = periods.of(a), periods.of(b)
        for start in range(pa - 1):  # ``start + 1`` stays below P_A: no quantum without a switch
            me.stance = a
            setattr(me, f"{counter}_ticks", start)
            state.nodes[K].warehouse = 0
            state.tick = 1000
            _set(state, b)
            economy(state, RULES)
            if getattr(me, f"{counter}_ticks") == 0:
                continue  # the tick under B finished a cycle of B: a quantum at the rate of B
            state.tick = 1001
            _set(state, a)
            back = getattr(me, f"{counter}_ticks")
            assert back * pb <= start * pb + pa
            if pb >= pa:
                assert back <= start + 1


def test_a_command_for_the_current_stance_changes_nothing() -> None:
    """``NO_CHANGE``, like every stance command for the stance in force: the tick of the next
    quantum stays."""
    state = _state()
    _run(state, 150)
    me = state.players[0]
    assert (me.cp_ticks, me.capital_ticks) == (50, 150)
    outcome = _set(state, Stance.BALANCE)
    assert isinstance(outcome, Reject) and outcome.code is RejectCode.NO_CHANGE
    assert (me.cp_ticks, me.capital_ticks) == (50, 150)
    assert _charges(_run(state, 200), K) == [200]


def test_no_cooldown_and_no_price() -> None:
    state = _state()
    state.tick = 5
    cp = state.players[0].cp
    for stance in (Stance.WAR, Stance.ECONOMY, Stance.BALANCE, Stance.WAR):
        outcome = _set(state, stance)
        assert isinstance(outcome, Ok) and outcome.cost == 0
    assert state.players[0].cp == cp


def test_a_switch_of_one_player_leaves_the_other_alone() -> None:
    state = _state()
    _run(state, 150)
    _set(state, Stance.WAR, player=1)
    assert (state.players[0].cp_ticks, state.players[0].capital_ticks) == (50, 150)
    # Player 1 carries 50 and 150 to 50 * 80 // 100 = 40 and 150 * 400 // 200 = 300.
    assert (state.players[1].cp_ticks, state.players[1].capital_ticks) == (40, 300)


# What the stance does not touch -----------------------------------------------------------------


@pytest.mark.parametrize("stance", [Stance.WAR, Stance.ECONOMY], ids=str)
def test_a_built_factory_keeps_the_global_clock(stance: Stance) -> None:
    """``factory.built_period_ticks = 200``: ticks 200, 400 and 600 under any stance, with changes
    at 50, 150 and 250 in between."""
    other = Stance.BALANCE
    switches = {50: stance, 150: other, 250: stance}
    state = _state()
    state.nodes[A].factory = 0
    assert _charges(_run(state, 600, switches), A) == [200, 400, 600]


@pytest.mark.parametrize("stance", [Stance.WAR, Stance.ECONOMY], ids=str)
def test_a_captured_capital_is_a_built_factory_on_the_global_clock(stance: Stance) -> None:
    """Player 0 holds the capital of player 1 as a built factory: 200, 400, whatever the stances
    of both players; player 1 has no own capital, its counter runs and its quantum does nothing."""
    state = _state()
    for node in state.nodes.values():  # a captured capital in a pocket would stop (DEC-43, H2)
        node.owner = 0
    state.nodes[ENEMY_K].factory = 0
    assert factory_period(state, RULES, ENEMY_K) == 200
    switches = {50: stance}
    events = _run(state, 400, switches)
    assert _charges(events, ENEMY_K) == [200, 400]
    assert all(e.get("player") == 0 for e in events if e.kind == "charges_produced")
    _set(state, stance, player=1)
    assert factory_period(state, RULES, ENEMY_K) == 200
    assert _charges(_run(state, 800), ENEMY_K) == [600, 800]


def test_the_capital_counter_runs_while_the_capital_is_lost() -> None:
    """Item 6 of DEC-44: it counts and the quantum does nothing, so a capital taken back goes on
    with the counter: lost before tick 1 and back at the end of tick 290, the quanta of ticks 200
    gave nothing and the next one comes at 400."""
    state = _state()
    state.nodes[K].owner = 1
    state.nodes[K].factory = None
    events = _run(state, 290)
    assert _charges(events, K) == []
    assert not [e for e in events if e.kind == "charge_burned" and e.get("node") == K]
    assert state.players[0].capital_ticks == 90
    state.nodes[K].owner = 0
    state.nodes[K].factory = 0
    assert _charges(_run(state, 400), K) == [400]


def test_the_capital_without_its_factory_makes_nothing() -> None:
    """The capital taken back after its factory was destroyed: the quantum does nothing."""
    state = _state()
    state.nodes[K].factory = None
    assert _charges(_run(state, 400), K) == []
    assert state.players[0].capital_ticks == 0


def test_a_full_capital_spills_by_the_rule_of_a8() -> None:
    """DEC-43, item A8: the quantum of a full capital is a spill or a burn, never lost silently."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    capacity = 6
    state.nodes[K].warehouse = capacity
    made = 0
    for _ in range(200):
        made += sum(
            e.kind in ("charges_produced", "charge_burned") and e.get("node") == K
            for e in match.step([])
        )
    assert made == 1


def test_the_period_a_view_shows_follows_the_stance() -> None:
    state = _state()
    assert factory_period(state, RULES, K) == 200
    _set(state, Stance.ECONOMY)
    assert factory_period(state, RULES, K) == 100
    _set(state, Stance.WAR)
    assert factory_period(state, RULES, K) == 400
    assert factory_period(state, RULES, ENEMY_K) == 200  # the stance of its own owner


# Symmetry, state, fog ---------------------------------------------------------------------------


def test_both_players_on_the_same_schedule_stay_equal() -> None:
    """Mirror symmetry of the counters; ``test_symmetry.py`` plays the whole ruleset as well."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    schedule = {30: Stance.WAR, 170: Stance.ECONOMY, 290: Stance.BALANCE, 291: Stance.WAR}
    for tick in range(1, 601):
        stance = schedule.get(tick)
        commands = (
            [] if stance is None else [PlayerCommand(p, 0, SetStance(stance)) for p in (0, 1)]
        )
        events = match.step(commands)
        p0, p1 = state.players[0], state.players[1]
        assert (p0.cp, p0.stance, p0.cp_ticks, p0.capital_ticks) == (
            p1.cp,
            p1.stance,
            p1.cp_ticks,
            p1.capital_ticks,
        )
        made = [e for e in events if e.kind in ("charges_produced", "charge_burned")]
        assert sum(e.get("player") == 0 for e in made) == sum(e.get("player") == 1 for e in made)


def test_the_counters_are_part_of_the_state() -> None:
    state = _state()
    _run(state, 37)
    back = from_canonical(to_canonical(state))
    assert (back.players[0].cp_ticks, back.players[0].capital_ticks) == (37, 37)
    assert state_hash(back) == state_hash(state)
    other = _state()
    _run(other, 37)
    other.players[0].capital_ticks = 36
    assert state_hash(other) != state_hash(state)


def _views(state: GameState, player: int) -> tuple[int | None, int | None, Stance]:
    me = project(state, RULES, player, KEY).me
    return me.cp_ticks, me.capital_ticks, me.stance


def test_a_view_has_the_own_counters_only() -> None:
    state = _state()
    _run(state, 150)
    _set(state, Stance.WAR, player=1)
    _run(state, 170)
    assert _views(state, 0) == (70, 170, Stance.BALANCE)
    assert _views(state, 1) == (60, 320, Stance.WAR)  # 40 and 300 at tick 150, then 20 ticks


def test_the_enemy_stance_and_counters_change_nothing_in_a_view() -> None:
    state = _state()
    before = project(state, RULES, 0, KEY)
    enemy = state.players[1]
    enemy.stance = Stance.WAR
    enemy.cp_ticks = 77
    enemy.capital_ticks = 333
    assert project(state, RULES, 0, KEY) == before


# The statistics (#772) --------------------------------------------------------------------------


class _Script:
    """Sends ``SetStance(stance)`` at the decision of tick ``at``: applied at tick ``at + 1``."""

    def __init__(self, at: int | None, stance: Stance) -> None:
        self.at = at
        self.stance = stance

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        del view
        return [SetStance(self.stance)] if tick == self.at else []


def test_the_statistics_by_stance() -> None:
    """600 ticks, nobody spends. Player 0: Balance in ticks 1..145, War from tick 146: the CP of
    tick 100 (3 -> 4 CP) in Balance; the counters 45 and 145 carry to 36 and 290, so the War
    quanta come at 146 + 43 = 189, 269, 349, 429, 509 and 589, of which only the first fits under
    the cap of 5 CP, and the capital at 146 + 109 = 255. Player 1:
    Balance all match: CP at 100 and 200 (the cap), the capital at 200, 400 and 600."""
    recorder = MatchRecorder()
    run_headless(
        MAP,
        RULES,
        [_Script(145, Stance.WAR), _Script(None, Stance.WAR)],
        max_ticks=600,
        observer=recorder,
    )
    log = recorder.log()
    stats = analyze_stats(log)
    p0, p1 = stats.players
    assert dict(p0.stance_ticks) == {"economy": 0, "balance": 145, "war": 455}
    assert p0.stance_switches == 1 and p1.stance_switches == 0
    assert dict(p0.stance_share) == {"economy": 0.0, "balance": 0.2417, "war": 0.7583}
    assert dict(p0.cp_by_stance) == {"economy": 0, "balance": 100, "war": 100}
    assert dict(p1.cp_by_stance) == {"economy": 0, "balance": 200, "war": 0}
    assert p0.charges_by_stance == (("economy", 0, 0), ("balance", 0, 0), ("war", 1, 0))
    assert p1.charges_by_stance == (("economy", 0, 0), ("balance", 3, 0), ("war", 0, 0))
    assert (p0.charges_capital, p0.charges_built, p1.charges_capital) == (1, 0, 3)
    assert analyze(log).charges_produced == (1, 3)


def test_built_factories_count_apart_from_the_capital() -> None:
    """A built factory of player 0 on the global clock: charges at 200 and 400 go to ``built``
    under the stance of the tick, the capital in Economy (from tick 1) at 100, 200, 300, 400."""

    recorder = MatchRecorder()

    class Observer:
        def begin(self, match: Match) -> None:
            match.state.nodes[A].factory = 0
            recorder.begin(match)

        def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
            recorder.record(match, commands)

    run_headless(
        MAP,
        RULES,
        [_Script(0, Stance.ECONOMY), _Script(None, Stance.WAR)],
        max_ticks=400,
        observer=Observer(),
    )
    stats = analyze_stats(recorder.log())
    assert stats.players[0].charges_by_stance == (
        ("economy", 4, 2),
        ("balance", 0, 0),
        ("war", 0, 0),
    )
