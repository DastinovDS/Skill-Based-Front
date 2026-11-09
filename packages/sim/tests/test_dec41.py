"""Factories (DEC-41, #642; implementation #644): the start stock and the factories.

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": items 2 and
9 and the implementation notes of #644. The tables of DEC-41 are written for its starting values
(the capital a charge per 50 ticks, a built factory per 100, ``cost = 4``, ``build_ticks = 100``,
``max = 3``, a capture costs 1), so ``RULES`` pins them on top of ``mvp-6`` (the capital period
under every stance, DEC-44, set to 50) and gives the cities a warehouse of 4, so that one stock
pays a factory. The supply flow, the spill of a full factory and the pockets of DEC-43 are in the
``test_dec43*.py`` modules; the stances in ``test_dec44.py``; DEC-47 in ``test_dec47.py``.

Map ``dec41`` (rot180): player 0 owns K = 0 (capital), A = 1 (large), B, C, D = 2, 3, 4
(medium), E, F, G = 5, 6, 7 (small); M = 8 is a neutral province in the middle; player 1 owns the
mirror, ``16 - n``; the neutral provinces 17..20 join the halves a second way.
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_sim.commands import (
    BuildFactory,
    Command,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import CityKindTable, StanceTable, load_ruleset
from gow_sim.state import Event, FactoryBuild, GameState, event, from_canonical, initial_state
from gow_sim.state import to_canonical as state_canonical
from gow_sim.systems.build import build
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.economy import economy
from gow_sim.systems.flow import settle_factories

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
MVP6 = load_ruleset(RULESETS / "mvp-6.toml")
RULES = replace(
    MVP6,
    stances=replace(MVP6.stances, capital_period_ticks=StanceTable(economy=50, balance=50, war=50)),
    factory=replace(MVP6.factory, built_period_ticks=100, cost=4, build_ticks=100, max=3),
    capture=replace(MVP6.capture, charge_cost=1),
    warehouse=replace(
        MVP6.warehouse,
        start_by_kind=CityKindTable(capital=6, city_large=4, city_medium=4, city_small=4),
    ),
)
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)


def _state(tick: int = 0) -> GameState:
    state = initial_state(MAP, RULES)
    state.tick = tick
    return state


def _cmd(state: GameState, cmd: Command, player: int = 0) -> Ok | Reject:
    results, events = apply_commands(state, RULES, [PlayerCommand(player, 0, cmd)])
    state.events.extend(events)
    return results[0].outcome


def _code(outcome: Ok | Reject) -> RejectCode | None:
    return outcome.code if isinstance(outcome, Reject) else None


# Item 9: the starting supply -------------------------------------------------------------------


@pytest.mark.parametrize("player", [0, 1])
def test_crossroads_starts_with_22_charges_per_side(player: int) -> None:
    """Item 9: only the capital keeps its stock (cut to its warehouse of 6, DEC-43 item C1), the
    units stay charged: ``crossroads`` 30 -> 22."""
    mapdef = load_map(ROOT / "maps" / "crossroads.json")
    state = initial_state(mapdef, load_ruleset(RULESETS / "mvp-7.toml"))
    stock = sum(n.warehouse for n in state.nodes.values() if n.owner == player)
    assert stock + sum(g.charged for g in state.groups.values() if g.owner == player) == 22


def test_only_the_capital_keeps_a_start_stock() -> None:
    state = _state()
    assert state.nodes[K].warehouse == 6
    assert [state.nodes[n].warehouse for n in (A, B, C, D, E, F, G)] == [0] * 7


# Item 2: factories -----------------------------------------------------------------------------


def test_the_capital_is_the_main_factory_from_the_start() -> None:
    state = _state()
    assert state.nodes[K].factory == 0 and state.nodes[16].factory == 1
    assert [n.id for n in state.nodes.values() if n.factory is not None] == [K, 16]


def test_the_capital_makes_a_charge_every_50_ticks() -> None:
    state = _state()
    state.nodes[K].warehouse = 4
    stock: list[int] = []
    for tick in range(1, 101):
        state.tick = tick
        economy(state, RULES)
        stock.append(state.nodes[K].warehouse)
    assert stock[48] == 4 and stock[49] == 5  # tick 49, tick 50
    assert stock[98] == 5 and stock[99] == 6  # tick 99, tick 100


def test_a_built_factory_makes_a_charge_every_100_ticks() -> None:
    state = _state()
    state.nodes[A].factory = 0
    made: list[Event] = []
    for tick in range(1, 101):
        state.tick = tick
        made += [
            e for e in economy(state, RULES) if e.kind == "charges_produced" and e.get("node") == A
        ]
    assert made == [event(100, "charges_produced", player=0, node=A, charges=1, spill=0)]
    assert state.nodes[A].warehouse == 1


def test_build_factory_costs_4_charges_and_takes_100_ticks() -> None:
    state = _state(10)
    state.nodes[A].warehouse = 4
    cp = state.players[0].cp
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert state.nodes[A].warehouse == 0
    assert state.players[0].cp == cp  # not CP-priced
    assert event(10, "build_started", player=0, node=A, kind="factory") in state.events
    events: list[Event] = []
    for tick in range(11, 111):
        state.tick = tick
        events = build(state, RULES)
        assert state.nodes[A].factory == (0 if tick >= 110 else None), tick
    assert events == [event(110, "factory_built", player=0, node=A)]


def test_build_factory_checks() -> None:
    state = _state(10)
    assert _code(_cmd(state, BuildFactory(99))) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert _code(_cmd(state, BuildFactory(16))) is RejectCode.NOT_OWNER
    assert _code(_cmd(state, BuildFactory(K))) is RejectCode.ALREADY_BUILT
    state.nodes[M].owner = 0
    assert _code(_cmd(state, BuildFactory(M))) is RejectCode.NOT_CITY
    # #645, item 7: the payment is progressive, so an empty warehouse does not reject it.
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)


def test_at_most_three_factories_with_the_capital_and_the_builds() -> None:
    """``factory.max = 3`` including the capital; a build under way counts."""
    state = _state(10)
    for node in (A, B, C):
        state.nodes[node].warehouse = 4
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert isinstance(_cmd(state, BuildFactory(B)), Ok)
    assert _code(_cmd(state, BuildFactory(C))) is RejectCode.FACTORY_LIMIT
    assert _code(_cmd(state, BuildFactory(A))) is RejectCode.ALREADY_BUILT
    assert state.nodes[C].warehouse == 4


def test_a_capture_stops_a_factory_build() -> None:
    state = _state(10)
    state.nodes[A].warehouse = 4
    _cmd(state, BuildFactory(A))
    state.tick = 50
    change_owner(state, A, 1)
    events = build(state, RULES)
    assert events == [
        event(50, "build_stopped", player=0, node=A, kind="factory", reason="interrupted")
    ]
    assert state.nodes[A].factory is None and state.nodes[A].factory_build is None


def test_a_captured_factory_passes_as_a_built_one() -> None:
    """Item 2: the capturer has 1 factory (its capital) < 3: A becomes its factory with the built
    rate; a captured capital counts as a built factory too."""
    state = _state(1)
    state.nodes[A].factory = 0
    change_owner(state, A, 1)
    change_owner(state, K, 1)
    settle_factories(state, RULES)
    assert state.nodes[A].factory == 1 and state.nodes[K].factory == 1
    for node in (D, 18):  # A and K join the rest of player 1 (no pocket, DEC-43 item H2)
        state.nodes[node].owner = 1
    state.tick = 50
    produced = [e.get("node") for e in economy(state, RULES) if e.kind == "charges_produced"]
    assert K not in produced  # the built rate: 100 ticks, not 50
    state.tick = 100
    produced = [e.get("node") for e in economy(state, RULES) if e.kind == "charges_produced"]
    assert K in produced and A in produced


def test_a_captured_factory_is_destroyed_at_the_cap() -> None:
    """Item 2: the capturer has 3 factories already: the captured one is destroyed."""
    state = _state(1)
    state.nodes[A].factory = 0
    for node in (15, 14):  # player 1: its capital and two built factories
        state.nodes[node].factory = 1
    change_owner(state, A, 1)
    settle_factories(state, RULES)
    assert state.nodes[A].factory is None


def test_two_captures_at_the_cap_go_in_node_key_order() -> None:
    """Rule 6 of 4.1: player 1 can take one more factory; of A and B the one with the smaller
    ``node_key`` for player 1 (the mirror id: A -> 15, B -> 14) passes, so B."""
    state = _state(1)
    state.nodes[A].factory = state.nodes[B].factory = 0
    state.nodes[15].factory = 1  # player 1: capital + one built factory
    change_owner(state, A, 1)
    change_owner(state, B, 1)
    settle_factories(state, RULES)
    assert (state.nodes[A].factory, state.nodes[B].factory) == (None, 1)


# The state ------------------------------------------------------------------------------------


def test_the_factory_fields_round_trip() -> None:
    """The canonical form carries the factories and the factory builds."""
    state = _state(7)
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=3, owed=2)
    state.nodes[B].factory = 0
    state.nodes[B].factory_ticks = 5
    assert from_canonical(state_canonical(state)) == state
