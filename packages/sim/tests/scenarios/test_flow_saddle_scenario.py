"""The match-11 saddle through the whole tick (DEC-43 item K, #732).

The situation of row K1 of mechanics.md (section 7, DEC-43 item K): tick 2420 of the owner's match
11 on ``narrows`` under ``mvp-4``, played by ``Match.step`` with every system, no commands. The
capital's production of tick 100 goes into its own warehouse (Iron Hold holds 4 after its send of
tick 80, room 2), so the sends of row K1 are unchanged; the first charge reaches The Narrows at
tick 100 and its army is 4/1, 4/2 when the second lands at 150.
"""

from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode
from gow_sim.systems.flow import update_flow

ROOT = Path(__file__).resolve().parents[4]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
NARROWS = load_map(ROOT / "maps" / "narrows.json")
THE_NARROWS, FAR_FORK, BEACONFORD, LOWMOOR, FLINTCROSS, THORNWAY = 14, 17, 18, 19, 21, 22
LARKFIELD, BARROW, IRON_HOLD = 23, 27, 28
STOCKS = {
    **{16: 2, BEACONFORD: 3, LOWMOOR: 3, 20: 3, FLINTCROSS: 1, THORNWAY: 1, LARKFIELD: 1},
    **{24: 3, 26: 1, BARROW: 3, IRON_HOLD: 5},
}


def _match() -> Match:
    match = Match(NARROWS, RULES, HEADLESS_MATCH_KEY)
    state = match.state
    for nid, node in state.nodes.items():
        node.owner = 1 if nid >= THE_NARROWS else 0
        node.warehouse = STOCKS.get(nid, 0)
    state.groups.clear()
    for node, units, charged in ((BEACONFORD, 5, 5), (LOWMOOR, 5, 5), (THE_NARROWS, 4, 0)):
        gid = state.new_id()
        state.groups[gid] = Group(gid, 1, units, charged, Mode.ATTACK, AtNode(node))
    update_flow(state, RULES)
    return match


def _army(match: Match) -> tuple[int, int]:
    groups = [g for g in match.state.groups.values() if g.location == AtNode(THE_NARROWS)]
    return sum(g.units for g in groups), sum(g.charged for g in groups)


def test_the_narrows_is_supplied_through_the_saddle() -> None:
    match = _match()
    sends: dict[int, list[tuple[int, int]]] = {}
    armies: dict[int, tuple[int, int]] = {}
    while match.tick < 150:
        events = match.step([])
        sent = [
            (e.get("from_node"), e.get("to_node"))  # type: ignore[misc]
            for e in events
            if e.kind == "packet_sent" and e.get("player") == 1
        ]
        if sent:
            sends[match.tick] = sent  # type: ignore[assignment]
        armies[match.tick] = _army(match)
    # since #738 (item M) the rest of the rear fills the nodes nearer the front at the same time
    to_narrows = {
        t: [p for p in s if p in ((THORNWAY, FAR_FORK), (FAR_FORK, THE_NARROWS))]
        for t, s in sends.items()
        if t <= 110
    }
    assert {t: s for t, s in to_narrows.items() if s} == {
        10: [(THORNWAY, FAR_FORK)],
        50: [(FAR_FORK, THE_NARROWS)],
        60: [(THORNWAY, FAR_FORK)],
        100: [(FAR_FORK, THE_NARROWS)],
        110: [(THORNWAY, FAR_FORK)],
    }
    assert armies[99] == (4, 0)
    assert armies[100] == (4, 1)
    assert armies[150] == (4, 2)
    assert not match.finished
