"""Factories follow the stance like the capital (DEC-47, #888).

Expected values come from the rules of DEC-47 and DEC-44 (mechanics.md, section 6), worked out by
hand. Under ``stances.factories_follow`` every factory other than its owner's capital makes one
charge per ``stances.capital_period_ticks`` of its owner's stance:

| Stance  | Any factory: 1 charge per |
|---------|---------------------------|
| War     | 400 ticks                 |
| Balance | 200 ticks                 |
| Economy | 100 ticks                 |

Each factory has its own counter (``Node.factory_ticks``): 0 when it starts working (the tick its
build ends) or when a capture passes it, +1 in ``economy`` of every later tick, the charge when it
reaches the period, then 0 again. A real stance change carries it over like the capital counter,
``c * P_new // P_old`` (rounded down), applied before ``economy`` of the tick: after a change at
tick ``t`` to a carried counter ``c'`` the next charge comes at ``t + P_new - c' - 1``.

The unit tests play ``mvp-7`` without its ``[map_tempo]`` section (the periods above); the map
tempo test plays it scaled on ``narrows`` (29 nodes, ``pct`` 76, DEC-46).

Map ``dec41`` (rot180): player 0 owns 0..7 (capital K = 0), player 1 the mirror, ``16 - n``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import Ok, PlayerCommand, Reject, SetStance, apply_commands
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import (
    Ruleset,
    RulesetError,
    Stance,
    apply_map_tempo,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
)
from gow_sim.ruleset import to_canonical as rules_canonical
from gow_sim.state import (
    Event,
    FactoryBuild,
    GameState,
    from_canonical,
    initial_state,
    state_hash,
    to_canonical,
)
from gow_sim.systems.build import build
from gow_sim.systems.economy import economy, factory_period
from gow_sim.systems.flow import settle_factories
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
MVP7 = load_ruleset(RULESETS / "mvp-7.toml")
RULES = dataclasses.replace(MVP7, map_tempo=None)
"""mvp-7 with the periods as written: the unit tests below count on 400 / 200 / 100."""
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, C = 0, 1, 3
"""The own capital, a city next to it, a city two roads away (``0 - 1 - 2 - 3``)."""
ENEMY_K = 16
KEY = bytes(range(32))


def _state(rules: Ruleset = RULES, mapdef: MapDef = MAP) -> GameState:
    state = initial_state(mapdef, rules)
    for node in state.nodes.values():
        node.warehouse = 0
    return state


def _set(state: GameState, stance: Stance, player: int = 0, rules: Ruleset = RULES) -> Ok | Reject:
    results, events = apply_commands(state, rules, [PlayerCommand(player, 0, SetStance(stance))])
    state.events.extend(events)
    return results[0].outcome


def _run(
    state: GameState,
    until: int,
    switches: dict[int, Stance] | None = None,
    rules: Ruleset = RULES,
    *,
    with_build: bool = False,
) -> list[Event]:
    """``economy`` (and ``build`` after it, as in ``Match.SYSTEMS``) up to the tick ``until``;
    ``switches``: the stance commands of player 0 by tick, applied before ``economy`` of their
    tick. The warehouses are emptied every tick: the charges are read from the events."""
    made: list[Event] = []
    while state.tick < until:
        state.tick += 1
        state.events = []
        if switches is not None and state.tick in switches:
            assert isinstance(_set(state, switches[state.tick], rules=rules), Ok)
        made += economy(state, rules)
        if with_build:
            made += build(state, rules)
        for node in state.nodes.values():
            node.warehouse = 0
    return made


def _charges(events: list[Event], node: int) -> list[int]:
    return [e.tick for e in events if e.kind == "charges_produced" and e.get("node") == node]


# The ruleset ------------------------------------------------------------------------------------


def test_mvp7_has_the_key_and_older_rulesets_do_not() -> None:
    assert MVP7.stances.factories_follow
    assert MVP7.factories_follow
    for name in ("mvp-5", "mvp-6"):
        rules = load_ruleset(RULESETS / f"{name}.toml")
        assert not rules.factories_follow, name


@pytest.mark.parametrize("name", ["mvp-5", "mvp-6"])
def test_a_ruleset_without_the_key_leaves_it_out_of_its_hash(name: str) -> None:
    """``False`` is left out of the canonical form and so of the hash (``OPTIONAL``); the archive
    of every kept ruleset is checked in ``test_ruleset.py``."""
    rules = load_ruleset(RULESETS / f"{name}.toml")
    stances = rules_canonical(rules)["stances"]
    assert isinstance(stances, dict) and "factories_follow" not in stances


def test_the_key_round_trips_and_counts_in_the_hash() -> None:
    data = rules_canonical(MVP7)
    assert parse_ruleset(data) == MVP7
    off = dataclasses.replace(
        MVP7, stances=dataclasses.replace(MVP7.stances, factories_follow=False)
    )
    assert ruleset_hash(off) != ruleset_hash(MVP7)


def test_the_key_must_be_a_boolean() -> None:
    data = rules_canonical(MVP7)
    stances = data["stances"]
    assert isinstance(stances, dict)
    stances["factories_follow"] = 1
    with pytest.raises(RulesetError, match=r"stances\.factories_follow"):
        parse_ruleset(data)


def test_map_tempo_keeps_the_key() -> None:
    played = apply_map_tempo(MVP7, load_map(ROOT / "maps" / "narrows.json"))
    assert played.factories_follow


# The rate per stance ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("switch", "expected"),
    [
        (None, [200, 400, 600]),  # Balance from the start: 1 per 200
        (Stance.WAR, [400]),  # War at tick 1: 1 per 400
        (Stance.ECONOMY, [100, 200, 300, 400, 500, 600]),  # Economy at tick 1: 1 per 100
    ],
    ids=["balance", "war", "economy"],
)
def test_a_factory_makes_the_capital_rate_of_its_owners_stance(
    switch: Stance | None, expected: list[int]
) -> None:
    """A factory from the start has the capital's phase: both at the same ticks."""
    state = _state()
    state.nodes[A].factory = 0
    events = _run(state, 600, None if switch is None else {1: switch})
    assert _charges(events, A) == expected
    assert _charges(events, K) == expected


def test_the_key_off_keeps_the_global_clock() -> None:
    """The same ruleset with the key off and a built factory of 150 ticks (the key it then needs):
    the built factory on the global clock, whatever the stance."""
    off = dataclasses.replace(
        RULES,
        stances=dataclasses.replace(RULES.stances, factories_follow=False),
        factory=dataclasses.replace(RULES.factory, built_period_ticks=150),
    )
    state = _state(off)
    state.nodes[A].factory = 0
    events = _run(state, 600, {1: Stance.ECONOMY}, off)
    assert _charges(events, A) == [150, 300, 450, 600]
    assert state.nodes[A].factory_ticks == 0


def test_a_switch_mid_period_carries_the_factory_counter() -> None:
    """Balance, War at tick 150: the counter 149 carries to 149 * 400 // 200 = 298, counts 299 at
    the end of tick 150 and reaches 400 at 251 (DEC-44, S4, for a factory); then every 400."""
    state = _state()
    state.nodes[A].factory = 0
    events = _run(state, 700, {150: Stance.WAR})
    assert _charges(events, A) == [251, 651]


def test_economy_mid_period() -> None:
    """Balance, Economy at tick 200: 199 carries to 199 * 100 // 200 = 99, the charge at 200."""
    state = _state()
    state.nodes[A].factory = 0
    events = _run(state, 400, {200: Stance.ECONOMY})
    assert _charges(events, A) == [200, 300, 400]


def test_a_factory_finished_mid_period_has_its_own_phase() -> None:
    """The build of A paid with its time from tick 30 ends at 30 + 100 = 130 (``factory.
    build_ticks``): the counter starts at 0 there, so Balance gives charges at 330 and 530.

    With War at tick 230: A's counter 99 carries to 99 * 400 // 200 = 198, 199 after the tick,
    the charge at 230 + 400 - 199 = 431, then 831. The capital, on its own counter, made one at
    200, so its 29 carries to 58 and its next charge comes at 230 + 400 - 59 = 571."""
    state = _state()
    _run(state, 30)
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=30)
    events = _run(state, 600, with_build=True)
    assert [e.tick for e in events if e.kind == "factory_built"] == [130]
    assert _charges(events, A) == [330, 530]
    assert _charges(events, K) == [200, 400, 600]

    state = _state()
    _run(state, 30)
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=30)
    events = _run(state, 900, {230: Stance.WAR}, with_build=True)
    assert _charges(events, A) == [431, 831]
    assert _charges(events, K) == [200, 571]


def test_a_carry_and_straight_back_never_raises_a_factory_counter() -> None:
    state = _state()
    state.nodes[A].factory = 0
    _run(state, 150)
    assert state.nodes[A].factory_ticks == 150
    _set(state, Stance.WAR)  # 150 * 400 // 200 = 300
    assert state.nodes[A].factory_ticks == 300
    _set(state, Stance.ECONOMY)  # 300 * 100 // 400 = 75
    _set(state, Stance.BALANCE)  # 75 * 200 // 100 = 150
    assert state.nodes[A].factory_ticks == 150


# Capture ----------------------------------------------------------------------------------------


def _capture(state: GameState, node: int, by: int) -> None:
    """A capture at the current tick, settled as the supply step of that tick does."""
    state.nodes[node].owner = by
    settle_factories(state, RULES)


def test_a_capture_starts_the_counter_again() -> None:
    """C (a city of player 0, a factory from the start) counts 150 by tick 150, then player 1
    takes it (with the neutral 17 on its way home, so C is not in a pocket, DEC-43 item H2): the
    counter starts at 0 for player 1, whose Balance gives charges at 350 and 550. Without the reset
    it would have been 200, 400, 600."""
    state = _state()
    state.nodes[C].factory = 0
    _run(state, 150)
    assert state.nodes[C].factory_ticks == 150
    state.nodes[17].owner = 1
    _capture(state, C, by=1)
    assert (state.nodes[C].factory, state.nodes[C].factory_ticks) == (1, 0)
    events = _run(state, 600)
    assert _charges(events, C) == [350, 550]
    made = [e for e in events if e.kind == "charges_produced" and e.get("node") == C]
    assert [e.get("player") for e in made] == [1, 1]


def test_a_destroyed_factory_keeps_no_counter() -> None:
    """The captor is at ``factory.max`` (3: its capital and two more): the factory is destroyed."""
    state = _state()
    state.nodes[C].factory = 0
    state.nodes[15].factory = 1
    state.nodes[14].factory = 1
    _run(state, 120)
    _capture(state, C, by=1)
    assert (state.nodes[C].factory, state.nodes[C].factory_ticks) == (None, 0)


@pytest.mark.parametrize("stance", [Stance.WAR, Stance.ECONOMY], ids=str)
def test_a_captured_capital_follows_the_stance_of_its_captor(stance: Stance) -> None:
    """Player 0 holds the capital of player 1 as a factory from the start: 1 charge per the
    period of player 0's stance; player 1's stance changes nothing."""
    period = 400 if stance is Stance.WAR else 100
    state = _state()
    for node in state.nodes.values():  # a captured capital in a pocket would stop (DEC-43, H2)
        node.owner = 0
    state.nodes[ENEMY_K].factory = 0
    assert factory_period(state, RULES, ENEMY_K) == 200
    assert isinstance(
        _set(state, Stance.WAR if stance is Stance.ECONOMY else Stance.ECONOMY, 1), Ok
    )
    events = _run(state, 800, {1: stance})
    assert _charges(events, ENEMY_K) == list(range(period, 801, period))
    assert factory_period(state, RULES, ENEMY_K) == period


def test_the_counter_runs_in_a_pocket_and_the_charge_does_nothing() -> None:
    """C cut off from the capital (1 and 2 lost): no charge at 200, the counter goes on, so C,
    reconnected at the end of tick 250, makes its next charge at 400 (DEC-44, item 6 and DEC-43,
    item H2 for the capital, the same here)."""
    state = _state()
    state.nodes[C].factory = 0
    for n in (1, 2, 4):
        state.nodes[n].owner = None
    events = _run(state, 250)
    assert _charges(events, C) == []
    assert state.nodes[C].factory_ticks == 50
    for n in (1, 2, 4):
        state.nodes[n].owner = 0
    assert _charges(_run(state, 600), C) == [400, 600]


# Map tempo --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("switch", "expected"),
    [
        # narrows: 29 nodes, pct 76 (DEC-46, T1); 200 * 100 // 76 = 263, 400 * 100 // 76 = 526,
        # 100 * 100 // 76 = 131.
        (None, [263, 526]),
        (Stance.WAR, [526]),
        (Stance.ECONOMY, [131, 262, 393, 524]),
    ],
    ids=["balance", "war", "economy"],
)
def test_map_tempo_on_a_29_node_map(switch: Stance | None, expected: list[int]) -> None:
    narrows = load_map(ROOT / "maps" / "narrows.json")
    played = apply_map_tempo(MVP7, narrows)
    state = _state(played, narrows)
    city = 1  # a large city next to the capital 0 of player 0
    state.nodes[city].factory = 0
    events = _run(state, 600, None if switch is None else {1: switch}, played)
    assert _charges(events, city) == expected
    assert _charges(events, narrows.capital(0)) == expected


# View and fog -----------------------------------------------------------------------------------


def _period_in_view(state: GameState, player: int, node: int) -> int | None:
    return project(state, RULES, player, KEY).nodes[node].factory_period


def test_the_view_shows_the_own_factory_period_of_the_stance() -> None:
    state = _state()
    state.nodes[A].factory = 0
    state.nodes[16 - A].factory = 1
    assert _period_in_view(state, 0, A) == 200
    _set(state, Stance.ECONOMY)
    assert _period_in_view(state, 0, A) == 100
    _set(state, Stance.WAR, player=1)
    assert _period_in_view(state, 1, 16 - A) == 400
    assert _period_in_view(state, 0, 16 - A) is None  # never the enemy's


def test_the_enemy_factory_counter_changes_nothing_in_a_view() -> None:
    """The enemy factory 12 next to the own 17 is shown as a factory (DEC-31 rule), never its
    period, its counter or the enemy's stance."""
    state = _state()
    state.nodes[17].owner = 0
    state.nodes[12].factory = 1
    before = project(state, RULES, 0, KEY)
    assert before.nodes[12].factory is True and before.nodes[12].factory_period is None
    state.nodes[12].factory_ticks = 123
    state.players[1].stance = Stance.WAR
    assert project(state, RULES, 0, KEY) == before


# State, symmetry, versions ----------------------------------------------------------------------


def test_the_counter_is_part_of_the_state() -> None:
    state = _state()
    state.nodes[A].factory = 0
    assert "factory_ticks" not in str(to_canonical(state))
    _run(state, 77)
    data = to_canonical(state)
    assert from_canonical(data) == state
    before = state_hash(state)
    state.nodes[A].factory_ticks += 1
    assert state_hash(state) != before


def test_mirrored_factories_on_a_mirrored_schedule_stay_equal() -> None:
    match = Match(MAP, MVP7, KEY)
    state = match.state
    state.nodes[A].factory = 0
    state.nodes[16 - A].factory = 1
    schedule = {30: Stance.WAR, 170: Stance.ECONOMY, 290: Stance.BALANCE, 291: Stance.WAR}
    for tick in range(1, 601):
        cmds: list[PlayerCommand] = []
        if tick in schedule:
            cmds = [PlayerCommand(p, 0, SetStance(schedule[tick])) for p in (0, 1)]
        match.step(cmds)
        assert state.nodes[A].factory_ticks == state.nodes[16 - A].factory_ticks, tick


def test_without_the_key_the_counters_stay_zero() -> None:
    match = Match(MAP, load_ruleset(RULESETS / "mvp-6.toml"), KEY)
    state = match.state
    state.nodes[A].factory = 0
    for _ in range(450):
        match.step([])
    assert all(n.factory_ticks == 0 for n in state.nodes.values())
