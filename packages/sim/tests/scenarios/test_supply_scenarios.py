"""Scenarios of SIM-08 (#24): chain through a node, road level, cut road, flow direction.

Maps, rules and hand computations: see ``packages/sim/tests/test_supply.py`` (``line6``: roads
of 30 ticks, packet time 30 on level 1; DEC-26: a road of any level carries 1 charge per
period, an upgraded one only faster). Dispatch every 10 ticks, buffer 2,
recharge 1 per tick (SIM-01 starting values). Tick convention: step ``t`` runs with
``state.tick == t``; a packet sent at tick ``t`` is delivered at ``t + packet time``.
"""

import dataclasses
import heapq
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import LevelTable, Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, initial_state
from gow_sim.systems.capacity import capacity, change_owner
from gow_sim.systems.economy import economy
from gow_sim.systems.supply import edge_packet_ticks, packet_target, supply

TESTS_DIR = Path(__file__).resolve().parents[1]
ROOT = TESTS_DIR.parents[2]
MVP0: Ruleset = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
RULES: Ruleset = dataclasses.replace(
    MVP0,
    capacity=dataclasses.replace(
        MVP0.capacity,
        by_kind=dataclasses.replace(MVP0.capacity.by_kind, capital=40, city_large=30),
    ),
    supply=dataclasses.replace(
        MVP0.supply,
        base_speed_pct=100,
        base_amount=1,
        fast_speed_pct=LevelTable((150, 200)),
    ),
)
"""As in ``test_supply.py``: capacity never limits ``line6``; the DEC-22 road numbers."""


def _line6() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "line6.json"), RULES)
    state.nodes[2].owner = 0  # setup, not a capture: 2 and 3 start neutral
    state.nodes[3].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, 0, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _step(state: GameState) -> list[Event]:
    state.tick += 1
    return supply(state, RULES)


def test_chain_charges_reach_b_through_a() -> None:
    state = _line6()
    state.nodes[0].warehouse = 10
    state.nodes[1].warehouse = 2  # A holds exactly its target (buffer 2): no own deficit
    b = _group(state, 0, 2, units=5)
    events: list[Event] = []
    for _ in range(69):
        events += _step(state)
    # Tick 10: 0 -> A (1 charge, width 1), arrives 40; tick 40: A -> B, arrives 70.
    assert b.charged == 0
    sent = [
        (e.tick, e.get("from_node"), e.get("charges")) for e in events if e.kind == "packet_sent"
    ]
    assert sent[:5] == [(10, 0, 1), (20, 0, 1), (30, 0, 1), (40, 0, 1), (40, 1, 1)]
    _step(state)
    assert b.charged == 1  # delivered at 70 and recharged in the same tick
    assert state.nodes[1].warehouse == 2  # A passes everything above its target on


def _delivered(level: int) -> int:
    """Charges delivered into node 1 during ticks 41..140 over road 0 of the given level."""
    state = _line6()
    state.edges[0].width = level
    state.nodes[0].warehouse = 200
    _group(state, 0, 1, units=60)  # demand far above what the road carries
    total = 0
    for _ in range(140):
        for e in _step(state):
            if e.kind == "packet_delivered" and e.get("node") == 1 and e.tick > 40:
                total += int(e.get("charges") or 0)
    return total


def test_an_upgraded_road_is_faster_not_wider() -> None:
    # One packet of at most `amount` charges per road per 10-tick period: 10 periods in the window.
    assert _delivered(1) == 10
    assert _delivered(3) == 10  # faster, not more (DEC-26, item 7)


def test_cut_road_stops_refill_and_recharge_behind_it() -> None:
    state = _line6()
    state.nodes[0].warehouse = 30
    b = _group(state, 0, 2, units=30)
    for _ in range(100):
        _step(state)
    assert b.charged > 0
    state.tick = 100
    events = change_owner(state, 1, 1)  # the enemy takes 1: roads 0-1 and 1-2 are buffers
    for _ in range(200):
        events += _step(state)
    assert any(e.kind == "packet_lost" for e in events)
    assert not any(e.kind == "packet_delivered" and e.get("node") == 2 for e in events)
    assert state.nodes[2].warehouse == 0
    charged = b.charged
    for _ in range(100):
        _step(state)
    assert b.charged == charged < b.units  # nothing left to recharge from


def _distances(state: GameState, player: int) -> dict[int, int]:
    """Packet time from the capital over own nodes (independent Dijkstra for the check)."""
    mapdef = state.map
    start = mapdef.capital(player)
    dist = {start: 0}
    heap = [(0, start)]
    while heap:
        d, node = heapq.heappop(heap)
        if d > dist[node]:
            continue
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if state.nodes[nxt].owner != player:
                continue
            nd = d + edge_packet_ticks(state, MVP0, eid)
            if nd < dist.get(nxt, nd + 1):
                dist[nxt] = nd
                heapq.heappush(heap, (nd, nxt))
    return dist


def test_no_packet_moves_towards_the_capital_in_1000_ticks() -> None:
    state = initial_state(load_map(ROOT / "maps" / "pereval.json"), MVP0)
    for g in state.groups.values():
        g.charged = 0
    dist = {p: _distances(state, p) for p in (0, 1)}
    sent = 0
    for _ in range(1000):
        state.tick += 1
        economy(state, MVP0)
        capacity(state, MVP0)
        sent += sum(e.kind == "packet_sent" for e in supply(state, MVP0))
        for p in state.packets.values():
            d = dist[p.owner]
            assert d[packet_target(state, p)] > d[p.from_node], (state.tick, p)
    assert sent > 0
