"""Liveness of the automatic supply flow (DEC-43, ``supply.model = "flow"``, #738).

Every playtest of ``mvp-4`` found a node the flow never fed while the rear held stock: the saddle
(item K, match 11), the corridor through a leaf (item L, match 12), the ridge (#738, match 12).
This module looks for all such holes at once instead of one per playtest.

**The property** (per player, the own capital's component only, ``k`` the player's shift):
a **hungry** level node (own, ``d == k``, room in its warehouse; a node where an own group stands
short of a charge has room once its warehouse is empty) and an **idle source** (own, behind the
level, ``d > k``, stock in its warehouse, no pulling army) that can reach it over own internal
roads through nodes that are not ahead of the level (``d >= k``, frozen by item A3) and do not
hold (a node with a pulling army keeps what it gets, item I3). Then:

1. **Settle**: without production and with the armies standing still, the flow reaches a fixed
   point (a dispatch that sends nothing, no packet on the way, and the same warehouses and armies
   at the next dispatch) within ``settle_cap`` dispatches. A state that does not settle has a
   charge cycling while the demand stands still: **churn**.
2. **Rest**: at the fixed point no hungry level node has an idle source that reaches it. The fixed
   point never changes again (nothing moves at all), so such a pair is a node the flow will never
   feed from that stock: a **hole**. This is stronger than "within N dispatches": it holds for
   every N.
3. **Progress**: from the start, if a hungry level node has an idle source that reaches it, at
   least one charge lands in a node that was hungry at the start within ``progress_n`` dispatches
   (``progress_n = (D + 1) * hop``: ``D`` the hop diameter of the map, ``hop`` the dispatches one
   road takes at most, ``ceil(T / dispatch_ticks) + 1`` for the slowest packet ``T``: a charge
   waits at most one dispatch to leave and ``T`` ticks on the road, and no shortest route is longer
   than ``D`` roads).

Shapes of a hole (the first that fits, by the paths from its idle sources to the hungry node over
the allowed nodes): **downhill** (a path behind the level along which ``d`` falls at every step:
the rule fails on its own terms), **saddle** (``d`` never rises, some step is a level road: item
K's case), **ridge** (only through nodes behind the level, some step uphill: #738), **corridor out**
(a path that crosses another level node, and every step out of a level node goes farther from the
capital: item L's case), **corridor in** (only through the level sideways, at an equal
capital distance, or towards the capital: item L allows the gap rule sideways and nothing inward,
by design). Holes whose sources all lie in an enclave (a part behind the level without an own
factory, item L5) are counted apart: the corridor rule L6 forbids them every road inward.

The states: every pool map (``maps/*.json``), ownership splits grown from both capitals by a seeded
generator (``_Rng``, splitmix64: no ``random``, AGENTS.md 4.1 applies to the tests too), then
pushed (single captures, a salient, both), four stock layouts, with and without short armies, every
leaf shift ``0..leaf_shift_max``. Both players are checked in every state.

The test asserts that the counts on ``develop`` do not grow (``BASELINE``); the full sweep and its
report: ``mise exec -- uv run python packages/sim/tests/test_flow_liveness.py --full`` (``--maps``,
``--splits``; ``docs/design/supply-flow-unified.md``).
"""

import sys
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    AtNode,
    FactoryBuild,
    FlowNode,
    GameState,
    Group,
    Mode,
    Node,
    initial_state,
)
from gow_sim.systems.capacity import warehouse_capacities
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.systems.supply import edge_packet_ticks, packet_dest

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
POOL = tuple(sorted(p.stem for p in (ROOT / "maps").glob("*.json")))

LAYOUTS = ("rear", "random", "capital", "one")
"""Stock layouts per player: ``rear`` every node behind the level full, the level and ahead empty;
``random`` every own node 0..cap; ``capital`` the capital full, the rest empty; ``one`` one node
behind the level full, the rest empty."""

PULLS = ("none", "armies", "builds")

SHAPES = ("downhill", "saddle", "ridge", "corridor out", "corridor in")


class _Rng:
    """splitmix64: a seeded generator for the test states only."""

    def __init__(self, seed: int) -> None:
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self) -> int:
        self.s = (self.s + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        z = self.s
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
        return z ^ (z >> 31)

    def below(self, n: int) -> int:
        return self.next() % n

    def pick(self, items: list[int]) -> int:
        return items[self.below(len(items))]


# The states ------------------------------------------------------------------------------------


def _neighbours(mapdef: MapDef, n: int) -> list[int]:
    return [mapdef.edges[e].other(n) for e in mapdef.incident[n]]


def _split(mapdef: MapDef, seed: int) -> tuple[str, dict[int, int | None]]:
    """An ownership split: both territories grown from the capitals one random frontier node at a
    time (some neutral nodes left), then by ``seed % 4``: as grown, single captures across the
    border, a salient (a chain of captures), or both."""
    rng = _Rng(seed)
    count = len(mapdef.nodes)
    owners: dict[int, int | None] = dict.fromkeys(range(count))
    caps = (mapdef.capital(0), mapdef.capital(1))
    owners[caps[0]] = 0
    owners[caps[1]] = 1
    neutral_left = rng.below(count // 5 + 1)
    free = count - 2
    turn = rng.below(2)
    stuck = 0
    while free > neutral_left and stuck < 2:
        frontier = sorted(
            {m for n, o in owners.items() if o == turn for m in _neighbours(mapdef, n)}
            - {n for n, o in owners.items() if o is not None}
        )
        if frontier:
            owners[rng.pick(frontier)] = turn
            free -= 1
            stuck = 0
        else:
            stuck += 1
        turn = 1 - turn
    kind = seed % 4
    label = ("grown", "captures", "salient", "both")[kind]
    if kind in (1, 3):
        for _ in range(1 + rng.below(6)):
            p = rng.below(2)
            border = sorted(
                {
                    m
                    for n, o in owners.items()
                    if o == p
                    for m in _neighbours(mapdef, n)
                    if owners[m] == 1 - p and m != caps[1 - p]
                }
            )
            if border:
                owners[rng.pick(border)] = p
    if kind in (2, 3):
        p = rng.below(2)
        last: int | None = None
        for _ in range(2 + rng.below(5)):
            src = [n for n, o in owners.items() if o == p] if last is None else [last]
            options = sorted(
                {
                    m
                    for n in src
                    for m in _neighbours(mapdef, n)
                    if owners[m] != p and m != caps[1 - p]
                }
            )
            if not options:
                break
            last = rng.pick(options)
            owners[last] = p
    return label, owners


@dataclass(frozen=True, slots=True)
class Case:
    """One generated state: regenerated from these fields (``build``)."""

    map: str
    split: int
    layout: str
    pull: str
    """``none``, ``armies`` (1 or 2 groups 3/0 in own nodes) or ``builds`` (1 or 2 factory builds
    owing 2 in own nodes without a factory)."""
    shift: int

    def label(self) -> str:
        pull = {"none": "no armies", "armies": "armies", "builds": "builds"}[self.pull]
        return f"{self.map} split {self.split} {self.layout} {pull} k={self.shift}"


_MAPS: dict[str, MapDef] = {}


def _map(name: str) -> MapDef:
    if name not in _MAPS:
        _MAPS[name] = load_map(ROOT / "maps" / f"{name}.json")
    return _MAPS[name]


def max_shift(name: str, split: int) -> int:
    """The largest ``leaf_shift_max`` of the two players in the split (the shifts to sweep)."""
    state = _owned(name, split)
    return max(state.players[p].leaf_shift_max for p in sorted(state.players))


def _owned(name: str, split: int) -> GameState:
    mapdef = _map(name)
    _, owners = _split(mapdef, split * 7919 + POOL.index(name))
    state = initial_state(mapdef, RULES)
    state.groups.clear()
    for nid, node in state.nodes.items():
        node.owner = owners[nid]
        node.warehouse = 0
        node.factory = node.owner if mapdef.nodes[nid].capital_of == node.owner else None
    update_flow(state, RULES)
    return state


def build(case: Case) -> GameState:
    """The state of ``case`` at tick 0, its field stored (the first flow step is tick 1, the first
    dispatch tick 10)."""
    state = _owned(case.map, case.split)
    mapdef = state.map
    for p in sorted(state.players):
        ps = state.players[p]
        ps.leaf_shift = min(case.shift, ps.leaf_shift_max)
    update_flow(state, RULES)
    caps = warehouse_capacities(state, RULES)
    rng = _Rng(hash_case(case))
    for p in sorted(state.players):
        own = [n for n in sorted(state.nodes) if state.nodes[n].owner == p]
        main = [n for n in own if not _flow(state, n).pocket]
        behind = [n for n in main if _d(state, n) > _flow(state, n).k]
        one = rng.pick(behind) if behind else None
        for n in own:
            flow = _flow(state, n)
            cap = caps[n]
            if case.layout == "rear":
                stock = cap if _d(state, n) > flow.k else 0
            elif case.layout == "random":
                stock = rng.below(cap + 1)
            elif case.layout == "capital":
                stock = cap if mapdef.nodes[n].capital_of == p else 0
            else:
                stock = cap if n == one else 0
            state.nodes[n].warehouse = stock
        if case.pull == "armies" and main:
            for _ in range(1 + rng.below(2)):
                n = rng.pick(main)
                gid = state.new_id()
                state.groups[gid] = Group(gid, p, 3, 0, Mode.ATTACK, AtNode(n))
        elif case.pull == "builds":
            sites = [n for n in main if state.nodes[n].factory is None]
            for _ in range(1 + rng.below(2)):
                if sites:
                    n = rng.pick(sites)
                    state.nodes[n].factory_build = FactoryBuild(p, 0, 2)
    update_flow(state, RULES)
    return state


def hash_case(case: Case) -> int:
    """A seed from the case (no ``hash()``: it depends on ``PYTHONHASHSEED``)."""
    text = case.label()
    h = 1469598103934665603
    for ch in text.encode():
        h = ((h ^ ch) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return h


def cases(maps: tuple[str, ...], splits: range, layouts: tuple[str, ...]) -> list[Case]:
    result: list[Case] = []
    for name in maps:
        for split in splits:
            top = max_shift(name, split)
            for layout in layouts:
                for pull in PULLS:
                    for shift in range(top + 1):
                        result.append(Case(name, split, layout, pull, shift))
    return result


# The check -------------------------------------------------------------------------------------


def _flow(state: GameState, n: int) -> FlowNode:
    flow = state.nodes[n].flow
    assert flow is not None
    return flow


def _d(state: GameState, n: int) -> int:
    d = _flow(state, n).d
    assert d is not None
    return d


@dataclass(slots=True)
class Hole:
    """A hungry level node that an idle source reaches, at the fixed point."""

    case: Case
    player: int
    node: int
    sources: tuple[int, ...]
    shape: str
    size: int
    """Own nodes of the capital's component (the smallest example is reported)."""
    enclave: bool
    """Every idle source lies in a part behind the level without an own factory (an enclave of
    item L5: the corridor rule L6 forbids it every road towards the capital)."""


@dataclass(slots=True)
class Result:
    case: Case
    settled: bool
    dispatches: int
    holes: list[Hole] = field(default_factory=list[Hole])
    stalled: list[int] = field(default_factory=list[int])
    """Players whose hungry level nodes got nothing within ``progress_n`` dispatches while an idle
    source reached one of them."""
    returns: int = 0
    """Quick returns: a road used back within 60 ticks of a send the other way."""
    sends: int = 0
    stuck: int = 0
    """Contract item 1 at the fixed point: nodes holding an idle charge while an own node nearer
    the front with room is reachable (``stuck_nodes``)."""
    unfed: int = 0
    """Contract item 3 at the fixed point: nodes that hold (an army short of a charge, an unpaid
    build) with room while stock reaches them (``unfed_holders``)."""
    waiting: int = 0
    """Contract item 2: node-dispatches in which stock idles while it could go nearer the front
    (``_order``)."""
    aimless: int = 0
    """Sends from a node that reaches no room nearer the front (nor a node that holds)."""
    frozen: int = 0
    """Contract item 6: sends from or into a node ahead of the level."""
    level_back: int = 0
    """Contract item 6: sends from the level to a node behind it that does not hold."""
    level_side: int = 0
    """Sends from the level to another level node that does not hold (evening, relays, paths)."""
    undrawn: int = 0
    """Contract item 7: node-ticks whose next receivers (``flow_next``) are not all in
    ``flow_down`` (the chevrons)."""


def _hold(state: GameState, player: int) -> dict[int, bool]:
    """The nodes that hold: an own standing group short of a charge or gathering a plan, an own
    build paid in charges that still owes (items A4, I3, J)."""
    holding: dict[int, bool] = {}
    for g in state.groups.values():
        loc = g.location
        if g.owner == player and isinstance(loc, AtNode) and (g.charged < g.units or g.plan > 0):
            holding[loc.node] = True
    for n, node in state.nodes.items():
        if node.owner == player and _owed(node, player) > 0:
            holding[n] = True
    return holding


def _owed(node: Node, player: int) -> int:
    due = 0
    for b in (node.build, node.factory_build, node.fort_build):
        if b is not None and b.owner == player:
            due += b.owed
    return due


def _takes(state: GameState, player: int, caps: tuple[int, ...]) -> dict[int, int]:
    """What every own node of the capital's component takes now: its room (``cap - stock - own
    packets on the way``); a node that pulls for a build alone (no short army there) at most what
    the build still owes beyond its stock and packets (item J5)."""
    incoming = _incoming(state, player)
    armies: dict[int, bool] = {}
    for g in state.groups.values():
        loc = g.location
        if g.owner == player and isinstance(loc, AtNode) and (g.charged < g.units or g.plan > 0):
            armies[loc.node] = True
    takes: dict[int, int] = {}
    for n in _main(state, player):
        node = state.nodes[n]
        room = max(0, caps[n] - node.warehouse - incoming.get(n, 0))
        due = _owed(node, player)
        if due and n not in armies:
            room = min(room, max(0, due - node.warehouse - incoming.get(n, 0)))
        takes[n] = room
    return takes


def _incoming(state: GameState, player: int) -> dict[int, int]:
    incoming: dict[int, int] = {}
    for pk in state.packets.values():
        if pk.owner == player:
            dest = packet_dest(state, pk)
            incoming[dest] = incoming.get(dest, 0) + pk.charges
    return incoming


def _tiers(
    state: GameState, player: int, takes: dict[int, int]
) -> tuple[dict[int, int], int, dict[int, bool], dict[int, dict[int, int]]]:
    """The field ``d``, the level ``k``, the holders and, per tier ``j`` (the ``d`` of a node
    with room), the nodes that reach a node of that tier with room over a **way**: own nodes of
    the capital's component, none ahead of the level, none that holds but the end, none nearer the
    front than the end (``d >= j``: a full node nearer the front keeps its charge), with the
    roads to the nearest such node (0 for the callers themselves)."""
    main = _main(state, player)
    if not main:
        return {}, 0, {}, {}
    k = _flow(state, main[0]).k
    d = {n: _d(state, n) for n in main}
    holding = _hold(state, player)
    c = _capital_distance(state, player, main)
    mapdef = state.map
    reach: dict[int, dict[int, int]] = {}
    for j in sorted({d[t] for t in main if takes[t] and d[t] >= k}):
        start = [t for t in main if takes[t] and d[t] == j]
        seen = dict.fromkeys(start, 0)
        queue = deque(start)
        while queue:
            m = queue.popleft()
            if m in holding and seen[m]:
                continue  # a node that holds keeps what it gets: no way through it
            for n in _neighbours(mapdef, m):
                if n in seen or n not in d or d[n] < j or d[n] < k:
                    continue
                if d[n] == k and c[m] <= c[n] and not (m in holding and m in start):
                    continue  # the level passes on only away from the capital (item L)
                seen[n] = seen[m] + 1
                queue.append(n)
        reach[j] = seen
    return d, k, holding, reach


def stuck_nodes(state: GameState, player: int, caps: tuple[int, ...]) -> list[int]:
    """Contract item 1 (stock settles as close to the front as possible) at a fixed point: own
    nodes of the capital's component, not ahead of the level and not holding, with a charge in the
    warehouse, from which a way (``_tiers``) leads to an own node with room **nearer the front**
    (a smaller ``d``, the field after the shift and the pull). The exceptions are those the rules
    require: nodes ahead of the level (frozen, item A3), pockets (their own rules, item H), stock
    that reaches only through enemy or neutral nodes, through a node that holds (it keeps what it
    gets) or through a full node nearer the front than the receiver."""
    takes = _takes(state, player, caps)
    d, k, holding, reach = _tiers(state, player, takes)
    stuck: list[int] = []
    for n in sorted(d):
        if d[n] < k or n in holding or state.nodes[n].warehouse == 0:
            continue
        if any(j < d[n] and n in seen for j, seen in reach.items()):
            stuck.append(n)
    return stuck


def unfed_holders(state: GameState, player: int, caps: tuple[int, ...]) -> list[int]:
    """Contract item 3 at a fixed point: own nodes that hold (an army short of a charge, an unpaid
    build) and take a charge, while stock reaches them: from behind the level over a way (as in
    ``stuck_nodes``), or from the level over the level only."""
    takes = _takes(state, player, caps)
    main = _main(state, player)
    if not main:
        return []
    k = _flow(state, main[0]).k
    d = {n: _d(state, n) for n in main}
    holding = _hold(state, player)
    c = _capital_distance(state, player, main)
    mapdef = state.map
    unfed: list[int] = []
    for h in sorted(holding):
        if h not in d or not takes[h]:
            continue
        seen = {h: True}  # node -> every road towards ``h`` goes away from the capital
        queue = deque([h])
        found = False
        while queue and not found:
            m = queue.popleft()
            for n in _neighbours(mapdef, m):
                if n in seen or n not in d or d[n] < k or d[n] < d[h] or n in holding:
                    continue
                if d[n] == k and c[m] <= c[n] and m != h:
                    continue  # the level passes on only away from the capital (item L)
                flat = m == h or (seen[m] and c[m] > c[n])
                seen[n] = flat
                if state.nodes[n].warehouse and (d[n] > d[h] or flat):
                    found = True
                    break
                queue.append(n)
        if found:
            unfed.append(h)
    return unfed


def _order(
    state: GameState, player: int, caps: tuple[int, ...], sent: list[tuple[int, int]]
) -> tuple[int, int]:
    """Contract item 2 at one dispatch (read after the step: the landings of the tick are in, the
    packets of the dispatch are taken out of the room again): ``(waiting, aimless)``. Waiting: the
    nodes that send nothing although a charge of theirs could go nearer the front (item 1 during
    the run: the front waits while stock that could fill it idles). Aimless: the sends of a node
    that reaches no node with room nearer the front over a way (nor, from the level, the level)."""
    takes = _takes(state, player, caps)
    senders: dict[int, bool] = {}
    for a, b in sent:
        takes[b] = takes.get(b, 0) + 1  # the room before the dispatch
        senders[a] = True
    d, k, holding, reach = _tiers(state, player, takes)
    aimless = 0
    for a, _ in sent:
        if a in d and not any(a in r and (j < d[a] or j == d[a] == k) for j, r in reach.items()):
            aimless += 1
    waiting = 0
    for n in sorted(d):
        if n in senders or d[n] < k or n in holding or state.nodes[n].warehouse == 0:
            continue
        if any(j < d[n] and n in r for j, r in reach.items()):
            waiting += 1
    return waiting, aimless


def _main(state: GameState, player: int) -> list[int]:
    return [
        n
        for n in sorted(state.nodes)
        if state.nodes[n].owner == player and not _flow(state, n).pocket
    ]


def hungry_and_sources(
    state: GameState, player: int, caps: tuple[int, ...]
) -> list[tuple[int, list[int]]]:
    """``(hungry level node, idle sources that reach it)`` for every hungry level node with any."""
    main = _main(state, player)
    if not main:
        return []
    k = _flow(state, main[0]).k
    d = {n: _d(state, n) for n in main}
    holding = _hold(state, player)
    room = _takes(state, player, caps)
    mapdef = state.map
    member = dict.fromkeys(main, True)
    sources = {n for n in main if d[n] > k and state.nodes[n].warehouse > 0 and n not in holding}
    result: list[tuple[int, list[int]]] = []
    for h in main:
        if d[h] != k or room[h] == 0:
            continue
        seen = {h: True}
        queue = deque([h])
        found: list[int] = []
        while queue:
            m = queue.popleft()
            for n in _neighbours(mapdef, m):
                if n in seen or n not in member or d[n] < k:
                    continue
                seen[n] = True
                if n in sources:
                    found.append(n)
                if n not in holding:
                    queue.append(n)
        if found:
            result.append((h, sorted(found)))
    return result


def shape(state: GameState, player: int, h: int, sources: list[int]) -> str:
    """The shape of a hole (module docstring): the first kind of path that exists."""
    main = _main(state, player)
    k = _flow(state, main[0]).k
    d = {n: _d(state, n) for n in main}
    holding = _hold(state, player)
    c = _capital_distance(state, player, main)
    mapdef = state.map
    src = set(sources)

    def reach(step_ok: Callable[[int, int], bool]) -> bool:
        seen = {h: True}
        queue = deque([h])
        while queue:
            m = queue.popleft()
            for n in _neighbours(mapdef, m):
                if n in seen or n not in d or d[n] < k or (n in holding and n not in src):
                    continue
                if not step_ok(n, m):
                    continue
                if n in src:
                    return True
                seen[n] = True
                queue.append(n)
        return False

    def behind(n: int, m: int) -> bool:
        return d[n] > k and (m == h or d[m] > k)

    if reach(lambda n, m: behind(n, m) and d[n] > d[m]):
        return "downhill"
    if reach(lambda n, m: behind(n, m) and d[n] >= d[m]):
        return "saddle"
    if reach(behind):
        return "ridge"
    if reach(lambda n, m: d[n] > k or c[m] > c[n]):
        return "corridor out"
    return "corridor in"


def all_in_enclaves(state: GameState, player: int, sources: list[int]) -> bool:
    """Every source is in a part behind the level (connected over nodes behind the level) that
    holds no own factory."""
    main = _main(state, player)
    k = _flow(state, main[0]).k
    behind = {n: True for n in main if _d(state, n) > k}
    mapdef = state.map
    for s in sources:
        seen = {s: True}
        queue = deque([s])
        while queue:
            n = queue.popleft()
            if state.nodes[n].factory == player:
                return False
            for m in _neighbours(mapdef, n):
                if m in behind and m not in seen:
                    seen[m] = True
                    queue.append(m)
    return True


def _capital_distance(state: GameState, player: int, main: list[int]) -> dict[int, int]:
    mapdef = state.map
    cap = mapdef.capital(player)
    member = dict.fromkeys(main, True)
    c = {cap: 0} if cap in member else {}
    queue = deque(c)
    while queue:
        n = queue.popleft()
        for m in _neighbours(mapdef, n):
            if m in member and m not in c:
                c[m] = c[n] + 1
                queue.append(m)
    return c


def hop_dispatches(state: GameState) -> int:
    """The dispatches one road takes at most: wait for a dispatch, then the slowest packet."""
    dt = RULES.supply.dispatch_ticks
    slowest = max(edge_packet_ticks(state, RULES, e) for e in state.edges)
    return (slowest + dt - 1) // dt + 1


def diameter(mapdef: MapDef) -> int:
    best = 0
    for s in range(len(mapdef.nodes)):
        dist = {s: 0}
        queue = deque([s])
        while queue:
            n = queue.popleft()
            for m in _neighbours(mapdef, n):
                if m not in dist:
                    dist[m] = dist[n] + 1
                    queue.append(m)
        best = max(best, *dist.values())
    return best


def _snapshot(state: GameState) -> tuple[tuple[int, ...], tuple[int, ...]]:
    return (
        tuple(state.nodes[n].warehouse for n in sorted(state.nodes)),
        tuple(state.groups[g].charged for g in sorted(state.groups)),
    )


def check(case: Case, settle_factor: int = 4) -> Result:
    """Run ``case`` to its fixed point (or ``settle_cap`` dispatches) and check it."""
    state = build(case)
    mapdef = state.map
    caps = warehouse_capacities(state, RULES)
    hop = hop_dispatches(state)
    progress_n = (diameter(mapdef) + 1) * hop
    settle_cap = settle_factor * len(mapdef.nodes) * hop
    dt = RULES.supply.dispatch_ticks
    waiting: dict[int, set[int]] = {}
    for p in sorted(state.players):
        pairs = hungry_and_sources(state, p, caps)
        if pairs:
            waiting[p] = {h for h, _ in pairs}
    fed: dict[int, bool] = {}
    result = Result(case, settled=False, dispatches=0)
    last_send: dict[tuple[int, int], int] = {}
    previous: tuple[tuple[int, ...], tuple[int, ...]] | None = None
    while result.dispatches < settle_cap:
        state.tick += 1
        state.events = []
        events = supply_flow(state, RULES)
        sent = False
        by_player: dict[int, list[tuple[int, int]]] = {}
        for e in events:
            if e.kind == "packet_sent":
                sent = True
                a, b = e.get("from_node"), e.get("to_node")
                p = e.get("player")
                assert isinstance(a, int) and isinstance(b, int) and isinstance(p, int)
                by_player.setdefault(p, []).append((a, b))
                result.sends += 1
                back = last_send.get((b, a))
                if back is not None and state.tick - back <= 60:
                    result.returns += 1
                last_send[(a, b)] = state.tick
            elif e.kind == "packet_delivered":
                p, n = e.get("player"), e.get("node")
                assert isinstance(p, int) and isinstance(n, int)
                if n in waiting.get(p, ()):
                    fed[p] = True
        _contract_tick(state, caps, by_player, result)
        if state.tick % dt:
            continue
        result.dispatches += 1
        if result.dispatches == progress_n:
            result.stalled = [p for p in sorted(waiting) if p not in fed]
        if sent or state.packets:
            previous = None
            continue
        snap = _snapshot(state)
        if snap == previous:
            result.settled = True
            break
        previous = snap
    if result.settled and result.dispatches < progress_n:
        # a fixed point never changes: a waiting player still unfed is stalled for good
        result.stalled = [p for p in sorted(waiting) if p not in fed]
    if result.settled:
        for p in sorted(state.players):
            result.stuck += len(stuck_nodes(state, p, caps))
            result.unfed += len(unfed_holders(state, p, caps))
        for p in sorted(state.players):
            size = len(_main(state, p))
            for h, sources in hungry_and_sources(state, p, caps):
                result.holes.append(
                    Hole(
                        case,
                        p,
                        h,
                        tuple(sources),
                        shape(state, p, h, sources),
                        size,
                        all_in_enclaves(state, p, sources),
                    )
                )
    return result


def _contract_tick(
    state: GameState,
    caps: tuple[int, ...],
    by_player: dict[int, list[tuple[int, int]]],
    result: Result,
) -> None:
    """The per-tick items of the contract: the order of the sends (2), the shift (6), the
    chevrons (7)."""
    for p in sorted(state.players):
        main = _main(state, p)
        if not main:
            continue
        k = _flow(state, main[0]).k
        member = dict.fromkeys(main, True)
        holding = _hold(state, p)
        sent = [(a, b) for a, b in by_player.get(p, []) if a in member]
        if state.tick % RULES.supply.dispatch_ticks == 0:
            wait, aim = _order(state, p, caps, sent)
            result.waiting += wait
            result.aimless += aim
        for a, b in sent:
            da, db = _d(state, a), _d(state, b)
            if da < k or db < k:
                result.frozen += 1
            elif da == k and b not in holding:
                if db > k:
                    result.level_back += 1
                else:
                    result.level_side += 1
        for n in main:
            f = _flow(state, n)
            if any(m not in f.down for m in f.next):
                result.undrawn += 1


# The report ------------------------------------------------------------------------------------


CONTRACT = ("stuck", "unfed", "waiting", "aimless", "frozen", "level_back", "level_side", "undrawn")
"""The contract counters of a ``Result`` (items 1, 3, 2, 6, 7 of the supply contract)."""


@dataclass(slots=True)
class Summary:
    states: int = 0
    churn: int = 0
    stalled: int = 0
    holes: dict[str, dict[str, int]] = field(default_factory=dict[str, dict[str, int]])
    """shape -> map -> holes (hungry nodes)."""
    failing: dict[str, int] = field(default_factory=dict[str, int])
    """map -> (state, player) pairs with at least one hole."""
    smallest: dict[str, Hole] = field(default_factory=dict[str, Hole])
    enclave: dict[str, int] = field(default_factory=dict[str, int])
    """shape -> holes whose sources are all in enclaves."""
    returns: int = 0
    sends: int = 0
    max_dispatches: int = 0
    contract: dict[str, int] = field(default_factory=dict[str, int])
    """Contract counters summed over the results (``CONTRACT``)."""

    def add(self, r: Result) -> None:
        for name in CONTRACT:
            self.contract[name] = self.contract.get(name, 0) + getattr(r, name)
        self.states += 1
        self.churn += 0 if r.settled else 1
        self.stalled += len(r.stalled)
        self.returns += r.returns
        self.sends += r.sends
        if r.settled:
            self.max_dispatches = max(self.max_dispatches, r.dispatches)
        players: set[int] = set()
        for hole in r.holes:
            per = self.holes.setdefault(hole.shape, {})
            per[hole.case.map] = per.get(hole.case.map, 0) + 1
            players.add(hole.player)
            if hole.enclave:
                self.enclave[hole.shape] = self.enclave.get(hole.shape, 0) + 1
            best = self.smallest.get(hole.shape)
            if best is None or (hole.size, len(hole.sources)) < (best.size, len(best.sources)):
                self.smallest[hole.shape] = hole
        if players:
            self.failing[r.case.map] = self.failing.get(r.case.map, 0) + len(players)

    def total(self) -> int:
        return sum(sum(per.values()) for per in self.holes.values())

    def lines(self) -> list[str]:
        out = [
            f"states {self.states} (x2 players), churn (no fixed point) {self.churn}, "
            f"stalled (no progress within N) {self.stalled}, holes {self.total()}, "
            f"failing state-players {sum(self.failing.values())}",
            f"sends {self.sends}, quick returns {self.returns}, "
            f"slowest settle {self.max_dispatches} dispatches",
            "contract: " + ", ".join(f"{n} {self.contract.get(n, 0)}" for n in CONTRACT),
        ]
        maps = sorted({m for per in self.holes.values() for m in per})
        for s in SHAPES:
            per = self.holes.get(s, {})
            if per:
                counts = ", ".join(f"{m} {per.get(m, 0)}" for m in maps)
                out.append(
                    f"  {s}: {sum(per.values())} ({counts}; sources in an enclave "
                    f"{self.enclave.get(s, 0)})"
                )
        for s in SHAPES:
            hole = self.smallest.get(s)
            if hole is not None:
                names = _map(hole.case.map).nodes
                srcs = ", ".join(names[n].name for n in hole.sources)
                out.append(
                    f"  smallest {s}: {hole.case.label()}, player {hole.player}, "
                    f"hungry {names[hole.node].name}, idle {srcs} ({hole.size} own nodes)"
                )
        return out


def sweep(
    maps: tuple[str, ...], splits: range, layouts: tuple[str, ...], summary: Summary | None = None
) -> Summary:
    summary = Summary() if summary is None else summary
    for case in cases(maps, splits, layouts):
        summary.add(check(case))
    return summary


# The tests -------------------------------------------------------------------------------------

QUICK: dict[str, int] = {"crossroads": 57, "highway": 63, "narrows": 28, "ridge": 111}
"""The holes of the quick sweep (splits 0 and 1) on ``develop`` at ``SIM_VERSION`` 39, per map.
A rule that fixes holes lowers them (update the numbers); one that adds holes fails here."""

FULL: dict[str, int] = {"crossroads": 278, "highway": 437, "narrows": 138, "ridge": 366}
"""The same for the full sweep (splits 0..11, the ``--full`` report)."""


@pytest.mark.parametrize("name", POOL)
def test_the_holes_do_not_grow(name: str) -> None:
    summary = sweep((name,), range(2), LAYOUTS)
    assert summary.churn == 0, summary.lines()
    assert summary.total() <= QUICK[name], summary.lines()


@pytest.mark.slow
@pytest.mark.parametrize("name", POOL)
def test_the_holes_of_the_full_sweep_do_not_grow(name: str) -> None:
    summary = sweep((name,), range(12), LAYOUTS)
    assert summary.churn == 0, summary.lines()
    assert summary.total() <= FULL[name], summary.lines()


def main(argv: list[str]) -> None:
    maps = POOL
    splits = range(2)
    layouts = LAYOUTS
    args = iter(argv)
    for arg in args:
        if arg == "--full":
            splits = range(12)
        elif arg == "--maps":
            maps = tuple(next(args).split(","))
        elif arg == "--splits":
            splits = range(int(next(args)))
    total = Summary()
    for name in maps:
        s = sweep((name,), splits, layouts)
        print(f"== {name}")
        for line in s.lines():
            print(line)
        total.states += s.states
        total.churn += s.churn
        total.stalled += s.stalled
        total.returns += s.returns
        total.sends += s.sends
        total.max_dispatches = max(total.max_dispatches, s.max_dispatches)
        for name, n in s.contract.items():
            total.contract[name] = total.contract.get(name, 0) + n
        for shape_name, per in s.holes.items():
            total.holes.setdefault(shape_name, {}).update(per)
        total.failing.update(s.failing)
        for shape_name, n in s.enclave.items():
            total.enclave[shape_name] = total.enclave.get(shape_name, 0) + n
        for shape_name, hole in s.smallest.items():
            best = total.smallest.get(shape_name)
            if best is None or (hole.size, len(hole.sources)) < (best.size, len(best.sources)):
                total.smallest[shape_name] = hole
    print("== all")
    for line in total.lines():
        print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
