"""Mirror test (AGENTS.md, section 4.1, rule 6; SIM-05): a mirrored start and mirrored commands on
a rot180 map give the mirrored state, here after 600 ticks.

Player 0 is driven by a small scripted controller that reads the state. Player 1 does not decide
anything: each of its commands is the rot180 mirror of player 0's command with the same ``seq``
(nodes and edges through the map's mirror tables, groups through the group correspondence). New
groups of the two players are paired by the ``seq`` of the command that made them.

The loop is the full ``Match.step`` (SIM-15): every system in the fixed order, including
``build``, ``orders`` and ``victory``. Fights (DEC-07, SIM-09) happen: on ``choke`` both players
reach the central node 3 at once. Public intents and bonuses are compared mirrored too. If the
match ends, it ends symmetrically: a draw.
Tie-breaks by group id inside a player stay mirrored because the pairing of groups keeps the id
order (initial groups get ids by ``node_key``; new groups are made in ``seq`` order); the test
checks that too.
"""

import dataclasses
from itertools import pairwise
from pathlib import Path

import pytest

from gow_sim.commands import (
    BuildBarracks,
    BuildBunker,
    BuildFactory,
    CancelOrder,
    CancelRecruit,
    Command,
    DrawLine,
    Merge,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    ReleasePlan,
    RemoveLine,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Split,
    Transfer,
    UpgradeRoad,
    UpgradeWarehouse,
    map_group_ids,
)
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Location, Mode, OnEdge
from gow_sim.systems.movement import find_path, traversal_ticks
from gow_sim.systems.supply import is_city, transfer_route
from gow_sim.systems.victory import EndReason, Outcome

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
MAPS = [
    ROOT / "maps" / "fixtures" / "pass.json",
    ROOT / "maps" / "fixtures" / "web.json",
    ROOT / "maps" / "fixtures" / "artery.json",
    # DEC-27, item 1: free coordinates, mirrored rules; provinces of DEC-23.
    ROOT / "maps" / "ridge.json",
    ROOT / "maps" / "crossroads.json",
    ROOT / "maps" / "highway.json",
    ROOT / "maps" / "narrows.json",
    TESTS_DIR / "maps" / "diamond.json",
    TESTS_DIR / "maps" / "choke.json",
]
TICKS = 600
DECIDE_EVERY = 5


@pytest.fixture(scope="module", params=["mvp-0", "mvp-1", "mvp-3"])
def rules(request: pytest.FixtureRequest) -> Ruleset:
    """mvp-0, mvp-1 (``city_upgrades`` on, DEC-26) and mvp-3 (the economy v2, DEC-41) with 50 CP
    to start with: CP do not limit the controller, every command is used."""
    name: str = request.param
    base = load_ruleset(ROOT / "rulesets" / f"{name}.toml")
    return dataclasses.replace(base, cp=dataclasses.replace(base.cp, start=5000, cap=5000))


def _decide(state: GameState, rules: Ruleset, player: int) -> list[Command]:
    """A deterministic controller for player 0 that uses every kind of command now and then."""
    mapdef = state.map

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    cmds: list[Command] = []
    tick = state.tick
    if rules.v2 and tick % 50 == 40:  # a gathering planned order departs now (#646)
        for g in sorted(state.groups.values(), key=lambda g: (key(_node_or_edge(g)), g.id)):
            if g.owner == player and g.plan:
                cmds.append(ReleasePlan(g.id))
    if tick % 50 == 25 or tick % 70 == 10:
        for g in sorted(state.groups.values(), key=lambda g: (key(_node_or_edge(g)), g.id)):
            if g.owner == player and g.order is not None and g.order.planned:
                if isinstance(g.location, AtNode) and tick < g.order.depart_tick:
                    cmds.append(CancelOrder(g.id))
            elif g.owner == player and g.mode is Mode.DEFENSE:
                cmds.append(CancelOrder(g.id))
    if tick % 150 == 0:
        cmds.append(SetStance([Stance.WAR, Stance.ECONOMY, Stance.BALANCE][tick // 150 % 3]))
    if tick % 100 == 0:
        cmds.append(Recruit(mapdef.capital(player)))
    if tick % 100 == 50:  # a second unit queued and taken back (DEC-25)
        cmds.extend((Recruit(mapdef.capital(player)), CancelRecruit(mapdef.capital(player))))
    if tick % 90 == 0:  # every own city's road to its lowest-key own neighbour is upgraded
        for node in sorted(range(len(mapdef.nodes)), key=key):
            internal = [
                e
                for e in mapdef.incident[node]
                if state.nodes[mapdef.edges[e].other(node)].owner == player
                and state.nodes[node].owner == player
            ]
            if internal:
                edge = min(internal, key=lambda e: key(mapdef.edges[e].other(node)))
                cmds.append(UpgradeRoad(edge))
    own_cities = sorted(
        (
            n
            for n in range(len(mapdef.nodes))
            if state.nodes[n].owner == player and is_city(mapdef, n)
        ),
        key=key,
    )
    if tick % 60 == 0 and own_cities:  # move the front markers over the own cities (DEC-28)
        k = tick // 60
        cmds.append(SetFront(k % 2, own_cities[k % len(own_cities)]))
        cmds.append(SetRearMin(k % 3))
    if tick % 80 == 0 and len(own_cities) >= 2:  # ship 2 charges to the farthest own city
        cmds.append(Transfer(own_cities[0], own_cities[-1], 2))
    if tick % 110 == 0 and own_cities:  # DEC-26: the barracks of the last own city
        cmds.append(BuildBarracks(own_cities[-1]))
    if tick % 110 == 55 and own_cities:  # and a warehouse level of the first one
        cmds.append(UpgradeWarehouse(own_cities[0]))
    if rules.v2:
        cmds.extend(_decide_v2(state, rules, player, own_cities))
    idle = sorted(
        (
            g
            for g in state.groups.values()
            if g.owner == player and isinstance(g.location, AtNode) and g.order is None
        ),
        key=lambda g: (key(_node(g)), g.id),
    )
    by_node: dict[int, list[Group]] = {}
    for g in idle:
        by_node.setdefault(_node(g), []).append(g)
    for node in sorted(by_node, key=key):
        here = by_node[node]
        if len(here) >= 2 and tick % 40 == 0:
            cmds.append(Merge(tuple(g.id for g in here)))
            continue
        for g in here:
            if tick % 70 == 5:
                cmds.append(SetMode(g.id, Mode.DEFENSE))
            elif g.units >= 2 and tick % 30 == 0:
                cmds.append(Split(g.id, g.units // 2))
            else:
                dest = _target(state, rules, player, node)
                if dest is not None:
                    planned = tick % 20 == 0
                    bonus = 1 + tick // 20 % 3 if planned and rules.v2 else 0
                    cmds.append(Move(g.id, dest, planned=planned, bonus=bonus))
    return cmds


def _decide_v2(
    state: GameState, rules: Ruleset, player: int, own_cities: list[int]
) -> list[Command]:
    """DEC-41: lines from the capital and from the targets of lines, factories, removals."""
    tick = state.tick
    cmds: list[Command] = []
    if tick % 35 == 0 and len(own_cities) >= 2:
        k = tick // 35
        lines = state.players[player].lines
        sources = [state.map.capital(player), *(lines[i].target for i in sorted(lines))]
        src = sources[k % len(sources)]
        dst = own_cities[k % len(own_cities)]
        route = transfer_route(state, rules, player, src, dst) if src != dst else None
        if route is not None:
            cmds.append(DrawLine(route.nodes))
    if tick % 45 == 0 and own_cities:
        cmds.append(BuildFactory(own_cities[tick // 45 % len(own_cities)]))
    own = sorted(n for n in state.nodes if state.nodes[n].owner == player)
    if tick % 65 == 0 and own:  # a bunker, in a city or a province (#645)
        cmds.append(BuildBunker(own[tick // 65 % len(own)]))
    if tick % 95 == 0:
        cmds.append(RemoveLine(tick // 95 % 3))
    return cmds


def _node_or_edge(g: Group) -> int:
    return g.location.node if isinstance(g.location, AtNode) else g.location.from_node


def _node(g: Group) -> int:
    assert isinstance(g.location, AtNode)
    return g.location.node


def _target(state: GameState, rules: Ruleset, player: int, start: int) -> int | None:
    """The fastest reachable node not owned by the player; ties by node_key."""
    mapdef = state.map
    best: tuple[int, int, int] | None = None
    for dest in range(len(mapdef.nodes)):
        if dest == start or state.nodes[dest].owner == player:
            continue
        path = find_path(state, rules, player, start, dest)
        if path is None:
            continue
        time = sum(traversal_ticks(mapdef, rules, _edge(state, a, b), b) for a, b in pairwise(path))
        cand = (time, mapdef.node_key(player, dest), dest)
        if best is None or cand < best:
            best = cand
    return None if best is None else best[2]


def _edge(state: GameState, a: int, b: int) -> int:
    for e in state.map.incident[a]:
        if state.map.edges[e].other(a) == b:
            return e
    raise AssertionError((a, b))


def _mirror_cmd(state: GameState, cmd: Command, groups: dict[int, int]) -> Command:
    mirror_nodes, mirror_edges = state.map.mirror_nodes, state.map.mirror_edges
    cmd = map_group_ids(cmd, lambda g: groups[g])
    match cmd:
        case Move(group=g, dest=dest, planned=planned, bonus=bonus):
            return Move(g, mirror_nodes[dest], planned, bonus)
        case UpgradeRoad(edge=edge):
            return UpgradeRoad(mirror_edges[edge])
        case Recruit(node=node):
            return Recruit(mirror_nodes[node])
        case CancelRecruit(node=node):
            return CancelRecruit(mirror_nodes[node])
        case BuildBarracks(node=node):
            return BuildBarracks(mirror_nodes[node])
        case UpgradeWarehouse(node=node):
            return UpgradeWarehouse(mirror_nodes[node])
        case SetFront(marker=marker, node=node):
            return SetFront(marker, None if node is None else mirror_nodes[node])
        case Transfer(src=src, dst=dst, n=n):
            return Transfer(mirror_nodes[src], mirror_nodes[dst], n)
        case BuildFactory(node=node):
            return BuildFactory(mirror_nodes[node])
        case BuildBunker(node=node):
            return BuildBunker(mirror_nodes[node])
        case DrawLine(path=path):
            return DrawLine(tuple(mirror_nodes[n] for n in path))
        case _:
            return cmd


def _mirror_location(state: GameState, loc: Location) -> Location:
    match loc:
        case AtNode(node=node):
            return AtNode(state.map.mirror_nodes[node])
        case OnEdge(edge=edge, from_node=from_node, progress=progress, back=back, level=level):
            return OnEdge(
                state.map.mirror_edges[edge],
                state.map.mirror_nodes[from_node],
                progress,
                back,
                level,
            )


def _mirrored(state: GameState, g: Group) -> tuple[object, ...]:
    """Group of player 1 as player 0 would see its mirror (without the id)."""
    mn = state.map.mirror_nodes
    order = g.order
    return (
        g.units,
        g.charged,
        g.mode,
        _mirror_location(state, g.location),
        None
        if order is None
        else (tuple(mn[n] for n in order.path), order.planned, order.depart_tick),
        (g.bonus, g.bonus_tick, g.intent is None, g.fight is None, g.plan, g.plan_tick),
    )


def _plain(g: Group) -> tuple[object, ...]:
    order = g.order
    return (
        g.units,
        g.charged,
        g.mode,
        g.location,
        None if order is None else (order.path, order.planned, order.depart_tick),
        (g.bonus, g.bonus_tick, g.intent is None, g.fight is None, g.plan, g.plan_tick),
    )


def _fights(state: GameState, groups: dict[int, int], mirror: bool) -> list[tuple[object, ...]]:
    """The fights (DEC-24) as comparable tuples; ``mirror``: each as the mirror of itself (nodes,
    edges, the point from the other end, players and paired groups swapped)."""
    mapdef = state.map
    mn, me = mapdef.mirror_nodes, mapdef.mirror_edges
    pair = {**groups, **{g1: g0 for g0, g1 in groups.items()}}

    def node(n: int | None) -> int | None:
        return n if n is None or not mirror else mn[n]

    def swap(t: tuple[int, int]) -> tuple[int, int]:
        return (t[1], t[0]) if mirror else t

    result: list[tuple[object, ...]] = []
    for f in state.fights.values():
        edge, point = f.edge, f.point
        if mirror and edge is not None and point is not None:
            reversed_ = mapdef.edges[me[edge]].a != mn[mapdef.edges[edge].a]
            edge, point = me[edge], 2000 - point if reversed_ else point
        members = sorted(
            (
                pair[gid] if mirror else gid,
                1 - m.player if mirror else m.player,
                m.units,
                m.charged,
                m.edge if m.edge is None or not mirror else me[m.edge],
                node(m.from_node),
                m.returning,
                m.arrived,
                m.leaving,
            )
            for gid, m in f.members.items()
        )
        attacker = f.attacker if f.attacker is None or not mirror else 1 - f.attacker
        result.append(
            (
                node(f.node),
                edge,
                point,
                attacker,
                f.start,
                f.next_round,
                swap(f.virtual),
                swap(f.mute),
                swap(f.shots),
                swap(f.losses),
                tuple(members),
            )
        )
    return sorted(result, key=repr)


def _assert_mirrored(state: GameState, groups: dict[int, int]) -> None:
    mapdef = state.map
    swap = {0: 1, 1: 0, None: None}
    for n in range(len(mapdef.nodes)):
        m = mapdef.mirror_nodes[n]
        assert state.nodes[m].owner == swap[state.nodes[n].owner], f"owner of {n}"
        a, b = state.nodes[n], state.nodes[m]
        assert (
            b.warehouse,
            b.over_ticks,
            b.captured_tick,
            b.cut_since,
            b.recruit_queue,
            b.recruit_progress,
            b.has_barracks,
            b.warehouse_level,
        ) == (
            a.warehouse,
            a.over_ticks,
            a.captured_tick,
            a.cut_since,
            a.recruit_queue,
            a.recruit_progress,
            a.has_barracks,
            a.warehouse_level,
        ), f"node {n}"
        assert (b.factory, b.inbox, b.rr, b.fort) == (swap[a.factory], a.inbox, a.rr, a.fort), (
            f"v2 of {n}"
        )
        for fa, fb in ((a.factory_build, b.factory_build), (a.fort_build, b.fort_build)):
            assert (fb is None) == (fa is None), f"factory or bunker build of {n}"
            if fa is not None and fb is not None:
                assert (fb.owner, fb.since, fb.owed) == (swap[fa.owner], fa.since, fa.owed), (
                    f"factory or bunker build of {n}"
                )
        ab, bb = a.build, b.build
        assert (bb is None) == (ab is None), f"build of {n}"
        if ab is not None and bb is not None:
            assert (bb.edge, bb.owner, bb.since, bb.kind, bb.owed) == (
                None if ab.edge is None else mapdef.mirror_edges[ab.edge],
                swap[ab.owner],
                ab.since,
                ab.kind,
                ab.owed,
            ), f"build of {n}"
    for e in range(len(mapdef.edges)):
        road, mirrored = state.edges[e], state.edges[mapdef.mirror_edges[e]]
        assert mirrored.width == road.width
        assert (mirrored.build is None) == (road.build is None), f"build of edge {e}"
        if road.build is not None and mirrored.build is not None:
            assert (mirrored.build.owner, mirrored.build.since) == (
                swap[road.build.owner],
                road.build.since,
            ), f"build of edge {e}"
    p0, p1 = state.players[0], state.players[1]
    mirror = mapdef.mirror_nodes
    assert p1.fronts == tuple(None if f is None else mirror[f] for f in p0.fronts), "fronts"
    assert p1.rear_min == p0.rear_min
    assert p1.next_line == p0.next_line
    assert {k: tuple(mirror[n] for n in line.path) for k, line in p0.lines.items()} == {
        k: line.path for k, line in p1.lines.items()
    }, "lines"
    assert (p0.cp, p0.stance, p0.charge_acc, p0.vp, p0.stance_changed_tick, p0.forfeited) == (
        p1.cp,
        p1.stance,
        p1.charge_acc,
        p1.vp,
        p1.stance_changed_tick,
        p1.forfeited,
    )
    alive0 = sorted(g for g in state.groups if state.groups[g].owner == 0)
    alive1 = sorted(g for g in state.groups if state.groups[g].owner == 1)
    assert sorted(groups[g] for g in alive0) == alive1
    assert [groups[g] for g in alive0] == alive1, "the pairing keeps the id order"
    for g0 in alive0:
        assert _plain(state.groups[g0]) == _mirrored(state, state.groups[groups[g0]]), g0
    packets = [
        (
            p.owner,
            p.edge,
            p.from_node,
            p.charges,
            p.depart_tick,
            p.arrive_tick,
            p.route,
            p.route_ticks,
            p.transfer,
        )
        for p in state.packets.values()
    ]
    me, mn = mapdef.mirror_edges, mapdef.mirror_nodes
    assert sorted(packets) == sorted(
        (1 - o, me[e], mn[f], c, d, a, tuple(me[x] for x in r), rt, t)
        for o, e, f, c, d, a, r, rt, t in packets
    )
    intents = [
        (i.owner, i.kind, i.origin, i.target, i.created_tick) for i in state.intents.values()
    ]
    assert sorted(intents) == sorted(
        (1 - o, k, mn[a], None if t is None else mn[t], c) for o, k, a, t, c in intents
    )
    assert _fights(state, groups, mirror=False) == _fights(state, groups, mirror=True)
    mem0, mem1 = state.vision_memory[0], state.vision_memory[1]
    assert {mapdef.mirror_nodes[n]: s for n, s in mem0.nodes.items()} == mem1.nodes
    assert {(me[e], mn[n]): s for (e, n), s in mem0.halves.items()} == mem1.halves
    assert {me[e]: w for e, w in mem0.widths.items()} == mem1.widths
    pair = {g1: g0 for g0, g1 in groups.items()}  # a group of player 1 to its mirror
    assert {pair[g]: t for g, t in mem0.spotted.items()} == mem1.spotted


def _new_groups(events: list[Event], player: int) -> list[int]:
    """Ids of the groups made by ``player``'s commands, in ``seq`` order."""
    new: list[int] = []
    for e in events:
        if e.kind not in ("group_split", "recruited") or e.get("player") != player:
            continue
        gid = e.get("new_group" if e.kind == "group_split" else "group")
        assert isinstance(gid, int)
        new.append(gid)
    return new


@pytest.mark.parametrize("path", MAPS, ids=lambda p: p.stem)
def test_mirrored_commands_give_the_mirrored_state(path: Path, rules: Ruleset) -> None:
    match = Match(load_map(path), rules, bytes(range(32)))
    state = match.state
    mapdef = state.map
    groups: dict[int, int] = {}
    for g0 in sorted(state.groups):
        if state.groups[g0].owner == 0:
            mirror = AtNode(mapdef.mirror_nodes[_node(state.groups[g0])])
            (g1,) = [g for g in state.groups.values() if g.owner == 1 and g.location == mirror]
            groups[g0] = g1.id
    _assert_mirrored(state, groups)
    pending: list[Command] = []
    kinds: list[str] = []
    applied = captures = moves_on_edges = fights = sent = 0
    for tick in range(1, TICKS + 1):
        commands = [PlayerCommand(0, seq, cmd) for seq, cmd in enumerate(pending)]
        commands += [
            PlayerCommand(1, seq, _mirror_cmd(state, cmd, groups))
            for seq, cmd in enumerate(pending)
        ]
        events = match.step(commands)
        assert state.tick == tick
        results = match.results
        by_seq = {(r.player, r.seq): r.outcome for r in results}
        for seq, cmd in enumerate(pending):
            assert type(by_seq[(0, seq)]) is type(by_seq[(1, seq)])
            if isinstance(cmd, Merge) and isinstance(by_seq[(0, seq)], Ok):
                groups[min(cmd.groups)] = min(groups[g] for g in cmd.groups)
        applied += sum(isinstance(r.outcome, Ok) for r in results)
        kinds.extend(
            type(cmd).__name__
            for seq, cmd in enumerate(pending)
            if isinstance(by_seq[(0, seq)], Ok)
        )
        groups.update(zip(_new_groups(events, 0), _new_groups(events, 1), strict=True))
        captures += sum(e.kind == "node_captured" for e in events)
        fights += sum(e.kind == "fight_started" for e in events)
        sent += sum(e.kind == "packet_sent" for e in events)
        moves_on_edges += sum(isinstance(g.location, OnEdge) for g in state.groups.values())
        _assert_mirrored(state, groups)
        if match.finished:
            break
        pending = _decide(state, rules, 0) if tick % DECIDE_EVERY == 0 else []
    if match.finished:
        # Only a symmetric end is possible: both capitals fall in the same tick.
        assert match.outcome == Outcome(None, EndReason.DOUBLE_DEFEAT)
        assert captures >= 2 and applied > 5
        return
    # The run did something: commands were applied, groups moved and took nodes.
    assert applied > 20
    assert {"Move", "Split", "Recruit", "CancelRecruit", "CancelOrder"} <= set(kinds)
    if rules.v2:  # DEC-41: the v1 supply commands are disabled, the lines are mirrored
        assert {"DrawLine", "RemoveLine", "BuildBunker", "BuildFactory"} <= set(kinds)
        assert "SetMode" not in kinds  # "Defense" is removed (item 5, #645)
        assert sent > 0, "the lines carried charges"
        assert not {"SetStance", "SetFront", "SetRearMin", "Transfer", "UpgradeRoad"} & set(kinds)
    else:
        assert {"SetStance", "SetFront", "SetRearMin", "SetMode"} <= set(kinds)
    if rules.city_upgrades.enabled:  # DEC-26: the city development is mirrored as well
        assert {"BuildBarracks", "UpgradeWarehouse"} <= set(kinds)
    assert moves_on_edges > 0
    # On choke the only way out is the central node 3; both players reach it at once and fight
    # there (DEC-07, rule 5; DEC-24) with equal sides, so both bounce and nothing is captured.
    assert captures >= (0 if path.stem == "choke" else 2)
    if path.stem == "choke":
        assert fights > 0
