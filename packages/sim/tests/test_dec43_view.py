"""The supply flow in the ``PlayerView`` (DEC-43, #697; implementation #704).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)": item E (the own-only fields, ``None`` for nodes
that are not own and under ``supply.model = "lines"``), item B5 (the enemy sees nothing of the
shift, the field or the level) and the rows V1..V4 of its table. The map and the base of the table
are those of ``test_dec43.py``.
"""

import dataclasses
from pathlib import Path
from typing import cast

import pytest

from gow_sim.commands import PlayerCommand, SetLeafShift
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, FlowIdle, FlowNode, GameState, Group, Mode, initial_state
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.view import NodeView, PlayerView, SelfView, project, view_to_canonical

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MVP3 = load_ruleset(ROOT / "rulesets" / "mvp-3.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
KEY = HEADLESS_MATCH_KEY
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_PASSES = (17, 18)  # North Pass, South Pass: player 1's in the base of the tables (#724)
OWN = (K, A, B, C, D, E, F, G)
ENEMY_CAPITAL = 16
FLOW_FIELDS = ("front_dist", "flow_down", "flow_next", "flow_idle", "flow_pocket")
ME_FIELDS = ("leaf_shift", "leaf_shift_max", "next_dispatch_tick")


def _state(stocks: dict[int, int], shift: int = 0, tick: int = 5) -> GameState:
    """The base of the table at ``tick`` after its flow step."""
    state = initial_state(MAP, RULES)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n in ENEMY_PASSES:  # the passes are player 1's (#724: a neutral never makes a leaf)
        state.nodes[n].owner = 1
    for n, stock in stocks.items():
        state.nodes[n].warehouse = stock
    update_flow(state, RULES)
    state.players[0].leaf_shift = shift
    while state.tick < tick:
        state.tick += 1
        state.events = []
        supply_flow(state, RULES)
    return state


def _flow(n: NodeView) -> tuple[object, ...]:
    return tuple(getattr(n, name) for name in FLOW_FIELDS)


def _view(state: GameState, player: int = 0) -> PlayerView:
    return project(state, RULES, player, KEY)


def test_v1_before_the_dispatch() -> None:
    view = _view(_state({K: 6}))
    assert _flow(view.nodes[K]) == (2, (A,), (A, E), None, False)
    assert _flow(view.nodes[C]) == (0, (), (), FlowIdle.LEAF, False)
    assert _flow(view.nodes[A]) == (1, (D,), (), FlowIdle.EMPTY, False)
    me = view.me
    assert (me.leaf_shift, me.leaf_shift_max, me.next_dispatch_tick) == (0, 2, 10)


def test_v2_the_shift_changes_the_idle_reasons_not_the_field() -> None:
    view = _view(_state({K: 6, A: 3, C: 2, F: 2}, shift=1))
    assert [view.nodes[n].flow_idle for n in (C, D, A, B)] == [
        FlowIdle.AHEAD,
        FlowIdle.AHEAD,
        None,  # A gives 1 to B at the next dispatch: the level evens out (#724)
        FlowIdle.LEAF,
    ]
    assert view.nodes[A].flow_next == (B,)
    base = {C: 0, D: 0, A: 1, B: 1, K: 2, E: 2, F: 2, G: 2}
    assert {n: view.nodes[n].front_dist for n in OWN} == base


def test_v3_after_the_dispatch() -> None:
    view = _view(_state({K: 6}, tick=10))
    assert view.nodes[K].flow_next == (A, E)
    assert view.me.next_dispatch_tick == 20


def test_v4_the_enemy_sees_none_of_it() -> None:
    """The enemy's view of the own nodes has no flow field, also where an enemy group stands
    (a source of vision, ``EXACT``)."""
    state = _state({K: 6, A: 3, C: 2, F: 2}, shift=1)
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, 2, 2, Mode.ATTACK, AtNode(C))
    view = _view(state, 1)
    assert all(_flow(view.nodes[n]) == (None,) * 5 for n in OWN)
    assert _flow(view.nodes[ENEMY_CAPITAL]) != (None,) * 5  # its own capital does have them


@pytest.mark.parametrize("name", ["d", "k", "pocket", "down", "next", "idle"])
def test_fog_the_enemy_view_does_not_depend_on_a_flow_field(name: str) -> None:
    """A fog test per field of item E (``Node.flow`` of the player's nodes): the enemy's view
    is the same whatever the value, also with an enemy group standing in a player's node."""
    state = _state({K: 6, A: 3, C: 2, F: 2})
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, 2, 2, Mode.ATTACK, AtNode(A))
    before = view_to_canonical(_view(state, 1))
    other: dict[str, object] = {
        "d": 7,
        "k": 3,
        "pocket": True,
        "down": (E, G),
        "next": (F, B),
        "idle": FlowIdle.FULL,
    }
    for n in OWN:
        flow = state.nodes[n].flow
        assert flow is not None
        state.nodes[n].flow = dataclasses.replace(flow, **{name: other[name]})
    assert view_to_canonical(_view(state, 1)) == before
    assert (
        view_to_canonical(_view(state, 0))
        != view_to_canonical(_view(_state({K: 6, A: 3, C: 2, F: 2}), 0))
        or name == "k"
    )  # k shows only through the derived fields


@pytest.mark.parametrize("name", ["leaf_shift", "leaf_shift_max"])
def test_fog_the_enemy_view_does_not_depend_on_the_shift(name: str) -> None:
    state = _state({K: 6})
    before = view_to_canonical(_view(state, 1))
    setattr(state.players[0], name, 2 if name == "leaf_shift" else 5)
    assert view_to_canonical(_view(state, 1)) == before
    assert getattr(_view(state, 0).me, name) == getattr(state.players[0], name)


def test_fog_next_dispatch_tick_is_the_tick_only() -> None:
    """``next_dispatch_tick`` follows from the tick and ``supply.dispatch_ticks``: the same for
    both players, nothing of the other player in it."""
    state = _state({K: 6}, tick=17)
    assert _view(state, 0).me.next_dispatch_tick == _view(state, 1).me.next_dispatch_tick == 20


def _no_packet_ids(view: PlayerView) -> dict[str, object]:
    """The canonical view without the opaque ids of the own packets: they hash the internal ids
    of one counter for both players (AGENTS.md 4.4), so the other player's packets shift them
    without telling anything."""
    data = view_to_canonical(view)
    packets = cast(list[dict[str, object]], data["packets"])
    rows = [{k: v for k, v in p.items() if k != "id"} for p in packets]
    data["packets"] = sorted(rows, key=repr)
    return data


def test_fog_a_shift_does_not_change_the_enemy_view_of_a_match() -> None:
    """V4: two matches equal except player 0's ``SetLeafShift``; player 1's views are equal in
    every tick although player 0's flow differs."""
    a, b = Match(MAP, RULES, KEY), Match(MAP, RULES, KEY)
    differs = False
    for tick in range(1, 81):
        cmds = [PlayerCommand(0, 0, SetLeafShift(2))] if tick == 1 else []
        a.step(cmds)
        b.step()
        assert _no_packet_ids(a.view(1)) == _no_packet_ids(b.view(1))
        differs = differs or view_to_canonical(a.view(0)) != view_to_canonical(b.view(0))
    assert a.state.players[0].leaf_shift == 2 and b.state.players[0].leaf_shift == 0
    assert differs


def test_the_fields_are_none_under_lines() -> None:
    state = initial_state(MAP, MVP3)
    view = project(state, MVP3, 0, KEY)
    assert all(_flow(n) == (None,) * 5 for n in view.nodes)
    assert all(getattr(view.me, name) is None for name in ME_FIELDS)
    assert view.me.auto_lines is True


def test_under_flow_no_lines_and_no_auto_lines() -> None:
    view = _view(_state({}))
    assert view.lines == () and view.me.auto_lines is None


def test_the_view_fields_are_the_stored_flow() -> None:
    """The view copies ``Node.flow`` of the own nodes (computed in the flow step, item A13)."""
    state = _state({K: 6})
    state.nodes[K].flow = FlowNode(d=4, k=1, pocket=True, down=(A,), next=(), idle=FlowIdle.FULL)
    assert _flow(_view(state).nodes[K]) == (4, (A,), (), FlowIdle.FULL, True)
    assert {f.name for f in dataclasses.fields(SelfView)} >= set(ME_FIELDS)
