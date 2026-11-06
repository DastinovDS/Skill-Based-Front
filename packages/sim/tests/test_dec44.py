"""Stances of economy v2 with local progress (DEC-44, #772).

Expected values come from the table of DEC-44 (mechanics.md, section 6), worked out by hand:

| Stance  | CP quantum per | Own capital: 1 charge per |
|---------|----------------|---------------------------|
| War     | 80 ticks       | 400 ticks                 |
| Balance | 100 ticks      | 200 ticks                 |
| Economy | 200 ticks      | 100 ticks                 |

A counter starts at 0 and grows by 1 in ``economy`` of every tick, so a player who stays in a
stance gets its quantum at the ticks ``P, 2P, ...``. A command of tick ``t`` is applied before
``economy`` of tick ``t``, so after a change at tick ``t`` the counters show 1 at the end of the
tick and the first quantum comes at ``t + P - 1``.

Map ``dec41`` (rot180): player 0 owns K = 0 (capital) and A = 1, player 1 the mirror, ``16 - n``.
``K`` starts with a warehouse of 6 under ``mvp-4``; the tests below empty it so that nothing spills.
"""

import gzip
import tomllib
from collections.abc import Callable, Sequence
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
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import (
    Ruleset,
    RulesetError,
    Stance,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
)
from gow_sim.ruleset import to_canonical as rules_canonical
from gow_sim.state import Event, GameState, from_canonical, initial_state, state_hash, to_canonical
from gow_sim.systems.economy import economy, factory_period
from gow_sim.view import PlayerView, project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
RULES = load_ruleset(RULESETS / "mvp-4-stances.toml")
SUP200 = load_ruleset(RULESETS / "mvp-4-sup200.toml")
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


def test_the_ruleset_is_sup200_plus_the_section() -> None:
    raw = _raw("mvp-4-stances")
    section = raw.pop("stances")
    assert raw["combat"].pop("terrain_burn") is True  # the other change of the file: DEC-45
    assert raw == _raw("mvp-4-sup200")
    assert section == {
        "cp_period_ticks": {"war": 80, "balance": 100, "economy": 200},
        "capital_period_ticks": {"war": 400, "balance": 200, "economy": 100},
    }


def test_balance_is_the_rate_of_sup200() -> None:
    assert RULES.economy.start_stance is Stance.BALANCE
    assert RULES.stances is not None and SUP200.factory is not None
    assert RULES.stances.cp_period_ticks.balance == SUP200.cp.period_ticks
    assert RULES.stances.capital_period_ticks.balance == SUP200.factory.capital_period_ticks


@pytest.mark.parametrize(
    "name", ["mvp-0", "mvp-1", "mvp-2", "mvp-3", "mvp-4", "test-short"], ids=str
)
def test_the_hash_of_a_ruleset_without_the_section_is_the_archived_one(name: str) -> None:
    """The section is optional and left out of the hash: the archived hashes still resolve."""
    rules = load_ruleset(RULESETS / f"{name}.toml")
    assert rules.stances is None
    assert "stances" not in rules_canonical(rules)
    assert (RULESETS / "archive" / f"{ruleset_hash(rules)}.toml").is_file()


def test_the_section_round_trips_and_counts_in_the_hash() -> None:
    assert parse_ruleset(rules_canonical(RULES)) == RULES
    assert ruleset_hash(RULES) != ruleset_hash(SUP200)


def test_the_section_is_only_for_v2() -> None:
    raw = _raw("mvp-2")
    raw["stances"] = _raw("mvp-4-stances")["stances"]
    with pytest.raises(RulesetError, match=r"stances: only with economy\.model = 'v2'"):
        parse_ruleset(raw)


def test_a_period_of_zero_is_an_error() -> None:
    raw = _raw("mvp-4-stances")
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


def test_a_switch_resets_both_counters() -> None:
    """Balance to War at tick 150. Before it the CP counter holds 49 (the quantum of tick 100, then
    ticks 101..149) and the capital counter 149. After the change tick 150 counts as 1, so the CP
    quantum comes at 150 + 80 - 1 = 229 and 309, the charge at 150 + 400 - 1 = 549."""
    state = _state()
    _run(state, 149)
    me = state.players[0]
    assert (me.cp_ticks, me.capital_ticks) == (49, 149)
    switches = {150: Stance.WAR}
    assert _cp_ticks(state, 320, switches) == [229, 309]
    assert (me.cp_ticks, me.capital_ticks) == (11, 171)
    assert _charges(_run(state, 560), K) == [549]


def test_progress_is_lost_right_before_a_quantum() -> None:
    """The counters hold 99 and 199 at tick 199; a change at tick 200 takes the quantum of that
    tick away: Economy gives its CP at 200 + 200 - 1 = 399 and its charge at 299."""
    state = _state()
    switches = {200: Stance.ECONOMY}
    quanta = _cp_ticks(state, 400, switches)
    assert quanta == [100, 399]
    assert _charges(_run(_state(), 400, switches), K) == [299, 399]


def test_a_switch_back_does_not_return_the_progress() -> None:
    """War at 150 and Balance again at 151: the counters are 1 and 1 at tick 151 (the change back
    is real), so the next CP comes at 151 + 100 - 1 = 250 and the charge at 151 + 200 - 1 = 350."""
    switches = {150: Stance.WAR, 151: Stance.BALANCE}
    assert _cp_ticks(_state(), 260, switches) == [100, 250]
    assert _charges(_run(_state(), 360, switches), K) == [350]


def test_a_command_for_the_current_stance_changes_nothing() -> None:
    """``NO_CHANGE``, like every stance command for the stance in force: the tick of the next
    quantum stays, and so does the tick of the last real change."""
    state = _state()
    _run(state, 150)
    me = state.players[0]
    assert (me.cp_ticks, me.capital_ticks, me.stance_changed_tick) == (50, 150, None)
    outcome = _set(state, Stance.BALANCE)
    assert isinstance(outcome, Reject) and outcome.code is RejectCode.NO_CHANGE
    assert (me.cp_ticks, me.capital_ticks, me.stance_changed_tick) == (50, 150, None)
    assert _charges(_run(state, 200), K) == [200]


def test_no_cooldown_and_no_price() -> None:
    state = _state()
    state.tick = 5
    cp = state.players[0].cp
    assert RULES.orders.stance_cooldown_ticks == 100  # the key stays and does nothing
    for stance in (Stance.WAR, Stance.ECONOMY, Stance.BALANCE, Stance.WAR):
        outcome = _set(state, stance)
        assert isinstance(outcome, Ok) and outcome.cost == 0
    assert state.players[0].cp == cp


def test_a_switch_of_one_player_leaves_the_other_alone() -> None:
    state = _state()
    _run(state, 150)
    _set(state, Stance.WAR, player=1)
    assert (state.players[0].cp_ticks, state.players[0].capital_ticks) == (50, 150)
    assert (state.players[1].cp_ticks, state.players[1].capital_ticks) == (0, 0)


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


def test_a_state_without_stances_has_no_counters_in_its_canonical_form() -> None:
    """So the state hash of every ruleset without ``[stances]`` stays as it was."""
    match = Match(MAP, SUP200, KEY)
    for _ in range(150):
        match.step([])
    assert "cp_ticks" not in str(to_canonical(match.state))
    assert "capital_ticks" not in str(to_canonical(match.state))


def _views(state: GameState, player: int) -> tuple[int | None, int | None, Stance]:
    me = project(state, RULES, player, KEY).me
    return me.cp_ticks, me.capital_ticks, me.stance


def test_a_view_has_the_own_counters_only() -> None:
    state = _state()
    _run(state, 150)
    _set(state, Stance.WAR, player=1)
    _run(state, 170)
    assert _views(state, 0) == (70, 170, Stance.BALANCE)
    assert _views(state, 1) == (20, 20, Stance.WAR)


def test_the_enemy_stance_and_counters_change_nothing_in_a_view() -> None:
    state = _state()
    before = project(state, RULES, 0, KEY)
    enemy = state.players[1]
    enemy.stance = Stance.WAR
    enemy.cp_ticks = 77
    enemy.capital_ticks = 333
    assert project(state, RULES, 0, KEY) == before


def test_the_counters_are_absent_without_the_section() -> None:
    state = initial_state(MAP, SUP200)
    me = project(state, SUP200, 0, KEY).me
    assert me.cp_ticks is None and me.capital_ticks is None


# Flag off ---------------------------------------------------------------------------------------


def test_set_stance_stays_disabled_without_the_section() -> None:
    state = initial_state(MAP, SUP200)
    cmd: Command = SetStance(Stance.WAR)
    results, _ = apply_commands(state, SUP200, [PlayerCommand(0, 0, cmd)])
    outcome = results[0].outcome
    assert isinstance(outcome, Reject) and outcome.code is RejectCode.FEATURE_DISABLED
    assert state.players[0].stance is Stance.BALANCE


def test_without_the_section_the_counters_stay_zero() -> None:
    match = Match(MAP, SUP200, KEY)
    for _ in range(450):
        match.step([])
    for p in match.state.players.values():
        assert (p.cp_ticks, p.capital_ticks) == (0, 0)


@pytest.mark.parametrize("path", sorted((TESTS_DIR / "golden" / "v40").glob("*.gz")), ids=str)
def test_the_golden_games_of_the_version_before_are_unchanged(path: Path) -> None:
    """DEC-44 changed no ruleset without ``[stances]``: the same commands and the same checkpoint
    hashes as the version before, tick by tick; only ``sim_version`` of the header differs."""
    before = gzip.decompress(path.read_bytes()).decode().split("\n")
    after = gzip.decompress((TESTS_DIR / "golden" / "v41" / path.name).read_bytes()).decode()
    assert after.split("\n")[1:] == before[1:]


def test_a_match_in_balance_is_a_match_of_sup200(
    expand_bot: Callable[[MapDef, Ruleset], Controller],
) -> None:
    """Both players stay in Balance: the same commands give the same events tick by tick (the
    burn of DEC-45 is another rule of the file: off here)."""
    bots = [expand_bot(MAP, SUP200), expand_bot(MAP, SUP200)]
    stances = replace(RULES, combat=replace(RULES.combat, terrain_burn=False))
    one, two = Match(MAP, SUP200, KEY), Match(MAP, stances, KEY)
    seqs = [0, 0]
    for tick in range(1300):
        commands: list[PlayerCommand] = []
        if tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(one.view(p), tick):
                    commands.append(PlayerCommand(p, seqs[p], one.resolve(p, cmd)))
                    seqs[p] += 1
        assert one.step(commands) == two.step(commands)
        if one.finished:
            break
        assert (one.state.players[0].cp, one.state.players[1].cp) == (
            two.state.players[0].cp,
            two.state.players[1].cp,
        )
    assert one.tick == two.tick > 500


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
    tick 100 (3 -> 4 CP) in Balance, the War quanta at 146 + 79 = 225, 305, 385, 465 and 545, of
    which only the first fits under the cap of 5 CP; the capital at 146 + 399 = 545. Player 1:
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
    assert stats.stances is True
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
