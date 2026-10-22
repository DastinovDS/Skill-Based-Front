"""Property tests of the simulation (SIM-17, AGENTS.md section 10): Hypothesis on whole matches.

A ``RuleBasedStateMachine`` plays a real ``gow_sim.match.Match`` on a small test map or an MVP
map. Its rules send random commands (valid and invalid, in opaque ids through ``Match.resolve``)
and advance the clock. After every tick the invariants below must hold:

- charge conservation: the charges that exist (warehouses + packets on the way + ``charged`` of
  the groups) equal the charges at the start, plus the ones the capitals produced
  (``charges_produced``), minus the documented sinks: shots and killed charged units
  (``spent`` of ``fight_round``; a group dying by DEC-24 G3: ``fight_group`` with ``encircled``),
  ``warehouse_lost``, ``packet_lost``, ``charges_overflow`` (the part of a delivered packet that
  does not fit the warehouse, and the production of a full capital that finds no room in the
  rear, DEC-28, item 4.4) and ``attrition`` deaths of charged units (a road level costs no
  charges since DEC-28: CP); the charges a cut-off garrison spends (``starvation``, DEC-19; units
  never die of it). A transfer (DEC-18) only moves charges from a warehouse into a
  packet: it is a flow, not a sink. ``charges_produced`` counts all of the production, the part
  that did not fit into the capital (``spill``) included;
- no negative counters, ``charged <= units``, road widths within their limits, every group in an
  existing node or on an existing edge, ids unique, links between groups and intents;
- a garrison never grows without an arrival (``group_arrived``) or a recruit in its city, so an
  overfull city cannot fill up further on its own;
- packets: the route and its times match, every edge of it exists (DEC-18, item 5);
- fog: ``project()`` does not change when everything the player must not see is perturbed
  (extends the synthetic-state test of SIM-14 in ``test_view.py`` to states of real matches),
  including the levels of fogged roads and enemy builds on them (DEC-17, DEC-22), the enemy's
  barracks, warehouse levels and city builds (DEC-26, item 10), the charged units on the range
  level and everything of the enemy groups in fogged halves of edges (DEC-21, DEC-33); known
  levels never exceed the true ones and equal them in sight; capacities are exact (DEC-22,
  item 1); enemy figures never carry internal ids (DEC-33, detail 5).

The machine plays ``mvp-0`` (``city_upgrades`` off) or ``mvp-1`` (on, DEC-26).

A counterexample found by Hypothesis goes into a regression test at the end of the file.
"""

import copy
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Final

import pytest
from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, rule

from gow_sim.commands import (
    BuildBarracks,
    CancelOrder,
    CancelRecruit,
    Command,
    Forfeit,
    Merge,
    Move,
    Ok,
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
    validate,
)
from gow_sim.maps import PLAYERS, ROAD_START_LEVEL, MapDef, load_map
from gow_sim.match import Controller, Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Detail,
    Event,
    GameState,
    Group,
    Mode,
    OnEdge,
    Packet,
    VisionMemory,
)
from gow_sim.systems.capacity import node_capacities
from gow_sim.systems.vision import half_node
from gow_sim.view import opaque_id, project

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
RULESETS: Final[dict[str, Ruleset]] = {
    "mvp-0": RULES,
    "mvp-1": load_ruleset(ROOT / "rulesets" / "mvp-1.toml"),
}
KEY = bytes(range(32))

TEST_MAPS: Final = ("line3", "diamond", "pass", "line6", "fork", "siege")
MVP_MAPS: Final = ("arteriya", "pautina", "pereval")
MAPS: Final[dict[str, MapDef]] = {
    **{n: load_map(TESTS_DIR / "maps" / f"{n}.json") for n in TEST_MAPS},
    **{n: load_map(ROOT / "maps" / f"{n}.json") for n in MVP_MAPS},
}


def _int(e: Event, key: str) -> int:
    value = e.get(key)
    assert isinstance(value, int) and not isinstance(value, bool), (e, key)
    return value


# Charge ledger --------------------------------------------------------------------------------


def total_charges(state: GameState) -> int:
    """Charges that exist: in warehouses, on the way in packets and in the units."""
    return (
        sum(n.warehouse for n in state.nodes.values())
        + sum(p.charges for p in state.packets.values())
        + sum(g.charged for g in state.groups.values())
    )


@dataclass(slots=True)
class Ledger:
    """Cumulative account of the charges of one match, filled from the events of each tick."""

    start: int
    produced: int = 0
    shots: int = 0
    """Charges spent in fights: shots and charged units that died."""
    warehouse_lost: int = 0
    packet_lost: int = 0
    overflow: int = 0
    """``charges_overflow``: a delivered packet that does not fit, a spill that finds no room."""
    attrition: int = 0
    starvation: int = 0
    """Charges a cut-off garrison spent (DEC-19): a documented sink."""
    builds: int = 0
    """Charges a city paid for a road level: none since DEC-28 (item 7: CP, no charges)."""

    @property
    def lost(self) -> int:
        return (
            self.shots + self.warehouse_lost + self.packet_lost + self.overflow
            + self.attrition + self.starvation + self.builds
        )  # fmt: skip

    def record(self, events: list[Event], packets_before: dict[int, int]) -> None:
        for e in events:
            match e.kind:
                case "charges_produced":
                    self.produced += _int(e, "charges")
                case "fight_round":
                    for p in PLAYERS:
                        spent = _int(e, f"spent_{p}")
                        assert spent >= 0, f"a fight created charges: {e}"
                        self.shots += spent
                case "fight_group" if e.get("encircled") is True:
                    self.shots += _int(e, "charged")  # DEC-24, G3: lost with the group
                case "warehouse_lost":
                    self.warehouse_lost += _int(e, "charges")
                case "packet_lost":
                    self.packet_lost += _int(e, "charges")
                case "packet_delivered":
                    sent = packets_before[_int(e, "packet")]
                    assert _int(e, "charges") <= sent, f"a packet grew on the way: {e}"
                case "charges_overflow":
                    self.overflow += _int(e, "charges")
                case "attrition":
                    self.attrition += 1 if e.get("charged") else 0
                case "build_started" if e.get("kind") == "road":
                    assert "charges" not in dict(e.data), f"a road paid with charges: {e}"
                case "starvation":
                    spent = _int(e, "warehouse") + _int(e, "units")
                    assert spent > 0, f"an empty starvation event: {e}"
                    self.starvation += spent
                case _:
                    pass


# Structural invariants ------------------------------------------------------------------------


def check_state(state: GameState) -> None:
    """Counters and links of a state; fails with an ``AssertionError`` naming the broken one."""
    mapdef = state.map
    n_nodes, n_edges = len(mapdef.nodes), len(mapdef.edges)
    for pid, p in state.players.items():
        assert p.cp >= 0 and 0 <= p.charge_acc < 100 and p.vp >= 0, f"player {pid}: {p}"
    for nid, n in state.nodes.items():
        assert n.warehouse >= 0 and n.over_ticks >= 0, f"node {nid}: {n}"
        assert n.owner is None or n.owner in PLAYERS, f"node {nid}: {n}"
        b = n.build
        assert b is None or (n.owner == b.owner and b.edge is None), f"node {nid}"
        assert 0 <= n.warehouse_level <= 2 and n.recruit_queue >= 0, f"node {nid}: {n}"
    for eid, e in state.edges.items():
        static = mapdef.edges[eid]
        assert ROAD_START_LEVEL <= e.width <= static.max_level, f"edge {eid}: {e}"
        b = e.build  # a road build (DEC-28): on an internal road of its player below max_level
        assert b is None or (
            b.edge == eid
            and e.width < static.max_level
            and state.nodes[static.a].owner == b.owner == state.nodes[static.b].owner
        ), f"edge {eid}: {e}"
    for gid, g in state.groups.items():
        assert g.id == gid and g.owner in PLAYERS and gid < state.next_id, f"group {gid}: {g}"
        assert g.units >= 1 and 0 <= g.charged <= g.units, f"group {gid}: {g}"
        _check_location(g, n_nodes, n_edges, state)
        if g.order is not None:
            assert all(0 <= n < n_nodes for n in g.order.path), f"group {gid}: {g.order}"
        assert g.bonus >= 0, f"group {gid}: {g}"
        assert g.intent is None or g.intent in state.intents, f"group {gid}: dangling intent"
    for pid, p in state.packets.items():
        assert p.id == pid and p.owner in PLAYERS and pid < state.next_id, f"packet {pid}: {p}"
        assert p.charges >= 1 and p.arrive_tick > p.depart_tick, f"packet {pid}: {p}"
        assert 0 <= p.edge < n_edges and p.from_node in _ends(mapdef, p.edge), f"packet {pid}: {p}"
        assert len(p.route) == len(p.route_ticks), f"packet {pid}: {p}"
        assert all(0 <= e < n_edges for e in p.route), f"packet {pid}: {p}"
        assert all(t >= 1 for t in p.route_ticks), f"packet {pid}: {p}"
    for iid, i in state.intents.items():
        assert i.id == iid and i.owner in PLAYERS and iid < state.next_id, f"intent {iid}: {i}"
    for fid, f in state.fights.items():  # DEC-24
        assert f.id == fid and fid < state.next_id, f"fight {fid}: {f}"
        assert (f.node is None) != (f.edge is None), f"fight {fid}: node or edge"
        assert (f.point is None) == (f.edge is None), f"fight {fid}: point"
        assert f.point is None or 0 <= f.point <= 2 * 1000, f"fight {fid}: point"
        assert min(f.virtual + f.mute + f.shots + f.losses) >= 0, f"fight {fid}: {f}"
        assert f.next_round > f.start and f.next_round > state.tick - 1, f"fight {fid}"
        for gid, m in f.members.items():
            g = state.groups.get(gid)
            assert g is None or (g.fight == fid and g.owner == m.player), f"fight {fid}: {gid}"
    for gid, g in state.groups.items():
        assert g.fight is None or gid in state.fights[g.fight].members, f"group {gid}: fight"
    for a, b in (
        (state.groups, state.packets),
        (state.groups, state.intents),
        (state.packets, state.intents),
    ):
        assert not set(a) & set(b), "one id names two entities"


def _ends(mapdef: MapDef, edge: int) -> tuple[int, int]:
    e = mapdef.edges[edge]
    return e.a, e.b


def _check_location(g: Group, n_nodes: int, n_edges: int, state: GameState) -> None:
    match g.location:
        case AtNode(node=node):
            assert 0 <= node < n_nodes, f"group {g.id} in a missing node: {g.location}"
        case OnEdge(edge=edge, from_node=from_node, progress=progress):
            assert 0 <= edge < n_edges, f"group {g.id} on a missing edge: {g.location}"
            assert from_node in _ends(state.map, edge), f"group {g.id}: {g.location}"
            assert 0 <= progress <= PROGRESS_SCALE, f"group {g.id}: {g.location}"


def standing(state: GameState) -> dict[tuple[int, int], int]:
    """Units standing in nodes, by ``(player, node)``."""
    out: dict[tuple[int, int], int] = {}
    for g in state.groups.values():
        if isinstance(g.location, AtNode):
            key = (g.owner, g.location.node)
            out[key] = out.get(key, 0) + g.units
    return out


def check_garrisons(
    before: dict[tuple[int, int], int], state: GameState, events: list[Event]
) -> None:
    """Units standing in a node grow only by an arrival or a recruit into that node."""
    fed = {
        (_int(e, "player"), _int(e, "node"))
        for e in events
        if e.kind in ("group_arrived", "recruited")
    }
    for key, units in standing(state).items():
        if units > before.get(key, 0):
            assert key in fed, f"tick {state.tick}: player {key[0]} node {key[1]} grew by itself"


# Tracker: a match plus its ledger -------------------------------------------------------------


@dataclass(slots=True)
class Tracker:
    match: Match
    ledger: Ledger
    seqs: dict[int, int] = field(default_factory=lambda: dict.fromkeys(PLAYERS, 0))
    kinds: set[str] = field(default_factory=set[str])
    """Kinds of events seen so far: to prove that the properties meet the sinks."""

    @classmethod
    def start(cls, mapdef: MapDef, rules: Ruleset = RULES) -> "Tracker":
        match = Match(mapdef, rules, KEY)
        check_state(match.state)
        return cls(match, Ledger(start=total_charges(match.state)))

    def send(self, player: int, cmd: Command) -> PlayerCommand:
        """Wrap an opaque-id command of ``player``: resolved to internal ids, next ``seq``."""
        pc = PlayerCommand(player, self.seqs[player], self.match.resolve(player, cmd))
        self.seqs[player] += 1
        return pc

    def tick(self, commands: list[PlayerCommand] | None = None) -> list[Event]:
        """One tick with all the per-tick checks; does nothing once the match has ended."""
        m = self.match
        if m.finished:
            return []
        packets = {pid: p.charges for pid, p in m.state.packets.items()}
        garrisons = standing(m.state)
        events = m.step(commands or [])
        self.ledger.record(events, packets)
        self.kinds.update(e.kind for e in events)
        check_state(m.state)
        check_garrisons(garrisons, m.state, events)
        now, ledger = total_charges(m.state), self.ledger
        assert now == ledger.start + ledger.produced - ledger.lost, (
            f"tick {m.tick}: {now} charges exist, the ledger says "
            f"{ledger.start} + {ledger.produced} produced - {ledger.lost} lost ({ledger})"
        )
        return events


# Fog ------------------------------------------------------------------------------------------


type Levels = tuple[list[Detail], list[Detail], list[bool]]
"""Node levels, the road level visibility of edges (DEC-17) and the sources (warehouse shown)."""


def perturb_hidden(data: st.DataObject, state: GameState, player: int, levels: Levels) -> None:
    """Change only what ``player`` must not know; ``project()`` must not notice.

    Hidden: numbers of enemy groups outside EXACT places (on the RANGE level only the charged:
    the range of the units shows), enemy groups in fog, in nodes and in halves of edges (may
    vanish, new ones may appear), the orders of enemy groups, warehouses outside the sources,
    enemy packets, the enemy's CP, stance and
    charge accumulator, the enemy's fog memory and the events of the tick; DEC-17: widths of
    fogged edges (only upwards, roads are never torn down) and enemy builds on fogged edges;
    DEC-18: supply priorities of enemy cities and routes of enemy packets (transfers); DEC-19: the
    starvation countdown of enemy cities. DEC-24: the withdrawals of the enemy's groups in a fight
    (its shots and virtual shots there are public, DEC-29, DEC-32); its groups in a fight are
    visible (their counters are in ``PlayerView.fights``), the rest of them is not.
    """
    draw = data.draw
    nodes, edges, sources = levels
    enemy = 1 - player
    for fid in sorted(state.fights):
        f = state.fights[fid]
        # The shots and the virtual shots left of both sides are public (DEC-24, item I1 as
        # revised with DEC-29; DEC-32, item 3): not perturbed.
        for gid in sorted(f.members):
            m = f.members[gid]
            if m.player == enemy:
                f.members[gid] = replace(m, leaving=draw(st.booleans()))
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != enemy:
            continue
        if g.fight is not None:
            g.order = None  # its counters are public in the fight, its order is not
            continue
        loc = g.location
        level = nodes[loc.node if isinstance(loc, AtNode) else half_node(state.map, loc)]
        g.order = None  # the target of a normal order is never shown (DEC-21, item 6)
        if level is Detail.FOG and draw(st.booleans()):
            del state.groups[gid]
        elif level is Detail.RANGE:
            g.charged = draw(st.integers(0, g.units))
        elif level is not Detail.EXACT:
            g.units += draw(st.integers(0, 5))
            g.charged = draw(st.integers(0, g.units))
    fogged = [n for n, level in enumerate(nodes) if level is Detail.FOG]
    for _ in range(draw(st.integers(0, 3))):
        if fogged:
            gid = state.new_id()
            node = draw(st.sampled_from(fogged))
            units = draw(st.integers(1, 9))
            state.groups[gid] = Group(gid, enemy, units, 0, Mode.ATTACK, AtNode(node))
    for n, source in enumerate(sources):
        if not source:
            state.nodes[n].warehouse = draw(st.integers(0, 30))
    for p in state.packets.values():
        if p.owner == enemy:
            p.charges = draw(st.integers(1, 9))
            p.transfer = draw(st.booleans())
    other = state.players[enemy]  # DEC-28: the enemy's front markers and rear minimum are hidden
    other.fronts = (draw(st.none() | st.integers(0, len(nodes) - 1)), None)
    other.rear_min = draw(st.integers(0, 8))
    for node in state.nodes.values():
        if node.owner == enemy:
            node.cut_since = draw(st.none() | st.integers(0, state.tick))
            if not any(  # DEC-26, item 10: hidden unless next to an own node (DEC-31)
                state.nodes[state.map.edges[e].other(node.id)].owner == player
                for e in state.map.incident[node.id]
            ):
                node.has_barracks = draw(st.booleans())
            node.warehouse_level = draw(st.integers(0, 2))
            node.recruit_queue = draw(st.integers(0, 3))  # DEC-25, item 12: hidden
            node.recruit_progress = draw(st.integers(0, 30))
            if node.build is not None and draw(st.booleans()):
                node.build = None
    other = state.players[enemy]
    other.cp = draw(st.integers(0, 10_000))
    other.stance = draw(st.sampled_from(list(Stance)))
    other.charge_acc = draw(st.integers(0, 99))
    state.vision_memory[enemy] = VisionMemory()
    state.events = []
    for e, level in enumerate(edges):
        if level is Detail.FOG:
            edge = state.edges[e]
            edge.width = draw(st.integers(edge.width, state.map.edges[e].max_level))
    for e, level in enumerate(edges):
        b = state.edges[e].build
        if b is not None and b.owner == enemy and level is Detail.FOG and draw(st.booleans()):
            state.edges[e].build = None


# Commands -------------------------------------------------------------------------------------

ALL_KINDS: Final = (
    "move",
    "split",
    "merge",
    "mode",
    "stance",
    "upgrade",
    "recruit",
    "front",
    "rear_min",
    "transfer",
    "cancel",
    "barracks",
    "warehouse",
    "cancel_recruit",
)


def draw_command(data: st.DataObject, tracker: Tracker, player: int) -> Command:
    """A random command of ``player``: the first of a few random candidates that ``validate()``
    accepts, else the last one, so accepted and rejected commands both get exercised."""
    state, rules = tracker.match.state, tracker.match.rules
    candidate = _candidate(data, tracker, player)
    for _ in range(4):
        if isinstance(validate(state, rules, player, tracker.match.resolve(player, candidate)), Ok):
            break
        candidate = _candidate(data, tracker, player)
    return candidate


def _candidate(data: st.DataObject, tracker: Tracker, player: int) -> Command:
    """A random command built from the player's own view; some ids and numbers are bogus."""
    draw = data.draw
    state = tracker.match.state
    groups = tracker.match.view(player).groups
    n_nodes, n_edges = len(state.map.nodes), len(state.map.edges)

    def group() -> int:
        if groups and draw(st.integers(0, 19)) > 0:
            return draw(st.sampled_from(groups)).id
        return draw(st.integers(0, 2**31))  # not an id of the player

    if draw(st.integers(0, 300)) == 0:
        return Forfeit()
    match draw(st.sampled_from(ALL_KINDS)):
        case "move":
            return Move(group(), draw(st.integers(0, n_nodes - 1)), draw(st.booleans()))
        case "split":
            return Split(group(), draw(st.integers(1, 6)))
        case "merge":
            return Merge(tuple(group() for _ in range(draw(st.integers(2, 3)))))
        case "mode":
            return SetMode(group(), draw(st.sampled_from(list(Mode))))
        case "stance":
            return SetStance(draw(st.sampled_from(list(Stance))))
        case "upgrade":
            return UpgradeRoad(draw(st.integers(-1, n_edges)))  # -1, n_edges: no such edge
        case "barracks":
            return BuildBarracks(draw(st.integers(0, n_nodes - 1)))
        case "warehouse":
            return UpgradeWarehouse(draw(st.integers(0, n_nodes - 1)))
        case "cancel_recruit":
            return CancelRecruit(draw(st.integers(0, n_nodes - 1)))
        case "recruit":
            return Recruit(draw(st.integers(0, n_nodes - 1)))
        case "front":
            return SetFront(draw(st.integers(-1, 2)), draw(st.none() | st.integers(0, n_nodes - 1)))
        case "rear_min":
            return SetRearMin(draw(st.integers(-1, 9)))
        case "transfer":
            return Transfer(
                draw(st.integers(0, n_nodes - 1)),
                draw(st.integers(0, n_nodes - 1)),
                draw(st.integers(0, 6)),
            )
        case _:
            return CancelOrder(group())


# The state machine ----------------------------------------------------------------------------


class MatchMachine(RuleBasedStateMachine):
    """Random play on a real match; the invariants are checked by ``Tracker.tick`` every tick."""

    tracker: Tracker

    @initialize(name=st.sampled_from(sorted(MAPS)), ruleset=st.sampled_from(sorted(RULESETS)))
    def start(self, name: str, ruleset: str) -> None:
        self.tracker = Tracker.start(MAPS[name], RULESETS[ruleset])

    @rule(data=st.data())
    def commands(self, data: st.DataObject) -> None:
        """One tick with 1..4 random commands of random players."""
        batch: list[PlayerCommand] = []
        for _ in range(data.draw(st.integers(1, 4))):
            player = data.draw(st.sampled_from(PLAYERS))
            batch.append(self.tracker.send(player, draw_command(data, self.tracker, player)))
        self.tracker.tick(batch)

    @rule(player=st.sampled_from(PLAYERS), dest=st.integers(0, 40))
    def rush(self, player: int, dest: int) -> None:
        """Send every group of ``player`` to one node: contact, fights, captures, attrition.

        The CP of the player are topped up to the cap first (a valid state), so that the rush is
        not just rejected for lack of CP.
        """
        t = self.tracker
        t.match.state.players[player].cp = t.match.rules.cp.cap
        target = dest % len(t.match.state.map.nodes)
        ids = [g.id for g in t.match.view(player).groups]
        t.tick([t.send(player, Move(gid, target)) for gid in ids])

    @rule(ticks=st.integers(20, 150))
    def advance(self, ticks: int) -> None:
        """Let the match run without commands: movement, fights, supply, production, attrition."""
        for _ in range(ticks):
            self.tracker.tick()

    @rule(data=st.data())
    def fog(self, data: st.DataObject) -> None:
        """Hidden state does not leak into the view of a player (fog of war, DEC-04)."""
        player = data.draw(st.sampled_from(PLAYERS))
        m = self.tracker.match
        view = m.view(player)
        own = {opaque_id(KEY, player, g.id) for g in m.state.groups.values() if g.owner == player}
        assert {g.id for g in view.groups} == own
        own_packets = {opaque_id(KEY, player, p.id) for p in _own(m.state, player)}
        assert {p.id for p in view.packets} == own_packets
        levels = (
            [n.detail for n in view.nodes],
            [e.detail for e in view.edges],
            [n.warehouse is not None for n in view.nodes],
        )
        internal = set(m.state.groups)
        for e in view.edges:  # DEC-33: figures only on halves not in fog, never internal ids
            for f in e.enemy_groups:
                assert f.id not in internal
                assert f.detail is not Detail.FOG
        for e in view.edges:  # DEC-17, DEC-22: known levels never exceed the true ones
            road = m.state.edges[e.id]
            assert e.width <= road.width
            assert e.detail is Detail.FOG or e.width == road.width
        capacities = node_capacities(m.state, m.rules)
        assert [n.capacity for n in view.nodes] == list(capacities)
        hidden = copy.deepcopy(m.state)
        perturb_hidden(data, hidden, player, levels)
        assert project(hidden, m.rules, player, KEY) == view


def _own(state: GameState, player: int) -> list[Packet]:
    return [p for p in state.packets.values() if p.owner == player]


TestMatchMachine = MatchMachine.TestCase  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]
TestMatchMachine.settings = settings(stateful_step_count=20)


# Full matches between bots --------------------------------------------------------------------


@pytest.mark.parametrize("name", ["siege", "diamond", "arteriya", "pautina", "pereval"])
def test_ledger_holds_in_a_full_bot_match(
    name: str, expand_bot: Callable[[MapDef, Ruleset], Controller]
) -> None:
    """The same invariants over a whole match of two ``ExpandBot``s (they do fight), and the
    sinks of the ledger are really met: the test is not vacuous."""
    mapdef = MAPS[name]
    bots = [expand_bot(mapdef, RULES) for _ in PLAYERS]
    tracker = Tracker.start(mapdef)
    match = tracker.match
    while not match.finished:
        batch: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in PLAYERS:
                batch += [tracker.send(p, c) for c in bots[p].decide(match.view(p), match.tick)]
        tracker.tick(batch)
    assert {
        "charges_produced",
        "fight_group",
        "packet_delivered",
        "warehouse_lost",
    } <= tracker.kinds
    if name in MVP_MAPS:  # the big maps also meet the sink of a cut-off
        assert "packet_lost" in tracker.kinds
    # No attrition sink here: under the stack limit ExpandBot splits and moves on every 5 ticks
    # (DEC-20), so no city stays overfilled for ``attrition_ticks``. The rush of ``MatchMachine``
    # and ``test_dec20.py`` (example 7) overfill cities.
