"""The nearest need (DEC-43 item M, #738): rows M8 and M12 of mechanics.md, section 7, item M.

Rows M1 to M7 and M9 to M11 are the rows of the older tables re-read under item M (``test_dec43.py``
F2, F7, F11, F12, F16, F17; ``test_dec43_leaves.py`` L13, L17, L20; ``test_dec43_build_pull.py``
J1; ``test_dec43_saddle.py`` K1, K3). Map ``narrows``, ``mvp-4`` (pinned on ``mvp-5``),
``node_key(0, n) = n``.
"""

import dataclasses
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import StanceTable, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, initial_state
from gow_sim.systems.flow import supply_flow, update_flow

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
_MVP5 = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
_EVERY_100 = StanceTable(economy=100, balance=100, war=100)
RULES = dataclasses.replace(
    _MVP5,
    stances=dataclasses.replace(
        _MVP5.stances, cp_period_ticks=_EVERY_100, capital_period_ticks=_EVERY_100
    ),
)
"""``mvp-5`` with the periods of ``mvp-4`` the tables of DEC-43 were written for: a CP quantum and a
charge of the capital every 100 ticks under every stance (DEC-44)."""
NARROWS = load_map(ROOT / "maps" / "narrows.json")
GRANITE, CAIRN, MARLOW, REEDWICK, BRACKENWAY, STONECROSS, MILLBROOK = 0, 1, 2, 4, 6, 7, 8
TORCHESTER, MID_FORK, THE_NARROWS, FAR_FORK, BEACONFORD = 10, 11, 14, 17, 18

MATCH13_OWN0 = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 16, 17, 18, 20, 21, 24)
MATCH13_OWN1 = (15, 19, 22, 23, 25, 26, 27, 28)
MATCH13_STOCKS = {
    0: 4, 1: 3, 2: 1, 4: 3, 7: 1, 8: 3, 10: 3, 17: 1, 18: 3, 20: 2, 21: 1, 24: 3,
    15: 1, 19: 3, 22: 1, 23: 3, 26: 1, 27: 3, 28: 6,
}  # fmt: skip
MATCH13_GROUPS = (
    (0, 10, 4), (0, 14, 3), (0, 17, 3), (0, 20, 3), (0, 21, 3), (0, 24, 4),
    (1, 19, 4), (1, 27, 5), (1, 28, 3),
)  # fmt: skip
"""Tick 4600 of match 13 under ``SIM_VERSION`` 39 (player, node, units, all charged)."""


def _match13() -> GameState:
    state = initial_state(NARROWS, RULES)
    for nid, node in state.nodes.items():
        node.owner = 0 if nid in MATCH13_OWN0 else 1 if nid in MATCH13_OWN1 else None
        node.warehouse = MATCH13_STOCKS.get(nid, 0)
        node.factory = node.owner if nid in (0, 10, 18, 19, 27, 28) else None
    state.groups.clear()
    for player, node, units in MATCH13_GROUPS:
        gid = state.new_id()
        state.groups[gid] = Group(gid, player, units, units, Mode.ATTACK, AtNode(node))
    update_flow(state, RULES)
    return state


def _flow_until(state: GameState, until: int) -> None:
    while state.tick < until:
        state.tick += 1
        state.events = []
        supply_flow(state, RULES)


def test_m8_the_narrows_fills_from_the_idle_rear() -> None:
    """Row M8 (the acceptance case of match 13): The Narrows (``d`` 1, empty, its downhill Far
    Fork a full leaf, its army full) calls the stock farther from the front over Mid Fork and
    Brackenway, uphill; under ``SIM_VERSION`` 39 it stayed empty."""
    state = _match13()
    flow = state.nodes[THE_NARROWS].flow
    assert flow is not None and (flow.d, flow.k) == (1, 0)
    seen: dict[int, int] = {}
    for tick in (100, 200, 300, 600):
        _flow_until(state, tick)
        seen[tick] = state.nodes[THE_NARROWS].warehouse
    assert seen == {100: 1, 200: 3, 300: 3, 600: 3}
    assert state.nodes[MID_FORK].warehouse == 1
    assert state.nodes[GRANITE].warehouse == 0


def _o5(army: bool) -> GameState:
    """The match-12 front of table O (player 0 owns 0..11, 14, 17, 21), ``k = 1``, Brackenway and
    Stonecross 1 each; with ``army`` a group 3/0 in The Narrows."""
    state = initial_state(NARROWS, RULES)
    mine = (*range(12), THE_NARROWS, FAR_FORK, 21)
    for nid, node in state.nodes.items():
        node.owner = 0 if nid in mine else None if nid in (12, 13) else 1
        node.warehouse = {BRACKENWAY: 1, STONECROSS: 1}.get(nid, 0)
        node.factory = node.owner if nid in (0, 28) else None
    state.groups.clear()
    if army:
        gid = state.new_id()
        state.groups[gid] = Group(gid, 0, 3, 0, Mode.ATTACK, AtNode(THE_NARROWS))
    update_flow(state, RULES)
    state.players[0].leaf_shift = 1
    state.tick = 9
    return state


def _sends(state: GameState, until: int) -> dict[int, list[tuple[int, int]]]:
    sends: dict[int, list[tuple[int, int]]] = {}
    while state.tick < until:
        state.tick += 1
        state.events = []
        sent = [
            (e.get("from_node"), e.get("to_node"))
            for e in supply_flow(state, RULES)
            if e.kind == "packet_sent" and e.get("player") == 0
        ]
        if sent:
            sends[state.tick] = sent  # type: ignore[assignment]
    return sends


def test_m12_the_level_gives_into_an_enclave_on_an_armys_call() -> None:
    """Row M12: without an army Stonecross keeps its 1 (the level gives only to a node that holds
    and by its evening, item M7); with a group 3/0 in The Narrows the army calls the level over
    the enclave Mid Fork."""
    assert _sends(_o5(army=False), 60) == {10: [(BRACKENWAY, 5)]}
    assert _sends(_o5(army=True), 60) == {
        10: [(BRACKENWAY, MID_FORK)],
        50: [(MID_FORK, THE_NARROWS)],
        60: [(STONECROSS, MID_FORK)],
    }
