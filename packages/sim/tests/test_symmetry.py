"""Mirror test (AGENTS.md, section 4.1, rule 6; SIM-05): a mirrored start and mirrored commands on
a rot180 map give the mirrored state, here after 600 ticks.

Player 0 is driven by a small scripted controller that reads the state. Player 1 does not decide
anything: each of its commands is the rot180 mirror of player 0's command with the same ``seq``
(nodes and edges through the map's mirror tables, groups through the group correspondence). New
groups of the two players are paired by the ``seq`` of the command that made them.

Systems in the loop: commands, economy, movement, vision. Combat is SIM-09 (#25); until then groups
of both players simply stand or pass each other.
"""

import dataclasses
from itertools import pairwise
from pathlib import Path

import pytest

from gow_sim.commands import (
    Command,
    Merge,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    SetMode,
    SetStance,
    Split,
    UpgradeRoad,
    apply_commands,
    map_group_ids,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Location, Mode, OnEdge, initial_state
from gow_sim.systems.economy import economy
from gow_sim.systems.movement import find_path, movement, traversal_ticks
from gow_sim.systems.vision import vision

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
MAPS = [
    ROOT / "maps" / "pereval.json",
    ROOT / "maps" / "pautina.json",
    ROOT / "maps" / "arteriya.json",
    TESTS_DIR / "maps" / "diamond.json",
    TESTS_DIR / "maps" / "pass.json",
]
TICKS = 600
DECIDE_EVERY = 5


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    """mvp-0 with 50 CP to start with: CP do not limit the controller, every command is used."""
    base = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    return dataclasses.replace(base, cp=dataclasses.replace(base.cp, start=5000, cap=5000))


def _decide(state: GameState, rules: Ruleset, player: int) -> list[Command]:
    """A deterministic controller for player 0 that uses every kind of command now and then."""
    mapdef = state.map

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    cmds: list[Command] = []
    tick = state.tick
    if tick % 150 == 0:
        cmds.append(SetStance([Stance.WAR, Stance.ECONOMY, Stance.BALANCE][tick // 150 % 3]))
    if tick % 100 == 0:
        cmds.append(Recruit(mapdef.capital(player)))
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
            if g.units >= 4:
                cmds.append(Split(g.id, g.units // 2))
            elif tick % 70 == 0:
                cmds.append(SetMode(g.id, Mode.DEFENSE))
            elif tick % 90 == 0:
                internal = [
                    e
                    for e in mapdef.incident[node]
                    if state.nodes[mapdef.edges[e].other(node)].owner == player
                    and state.nodes[node].owner == player
                ]
                if internal:
                    cmds.append(
                        UpgradeRoad(
                            g.id, min(internal, key=lambda e: key(mapdef.edges[e].other(node)))
                        )
                    )
            else:
                dest = _target(state, rules, player, node)
                if dest is not None:
                    cmds.append(Move(g.id, dest, planned=tick % 20 == 0))
    return cmds


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
        case Move(group=g, dest=dest, planned=planned):
            return Move(g, mirror_nodes[dest], planned)
        case UpgradeRoad(group=g, edge=edge):
            return UpgradeRoad(g, mirror_edges[edge])
        case Recruit(node=node):
            return Recruit(mirror_nodes[node])
        case _:
            return cmd


def _mirror_location(state: GameState, loc: Location) -> Location:
    match loc:
        case AtNode(node=node):
            return AtNode(state.map.mirror_nodes[node])
        case OnEdge(edge=edge, from_node=from_node, progress=progress):
            return OnEdge(state.map.mirror_edges[edge], state.map.mirror_nodes[from_node], progress)


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
        None if g.build_edge is None else state.map.mirror_edges[g.build_edge],
    )


def _plain(g: Group) -> tuple[object, ...]:
    order = g.order
    return (
        g.units,
        g.charged,
        g.mode,
        g.location,
        None if order is None else (order.path, order.planned, order.depart_tick),
        g.build_edge,
    )


def _assert_mirrored(state: GameState, groups: dict[int, int]) -> None:
    mapdef = state.map
    swap = {0: 1, 1: 0, None: None}
    for n in range(len(mapdef.nodes)):
        m = mapdef.mirror_nodes[n]
        assert state.nodes[m].owner == swap[state.nodes[n].owner], f"owner of {n}"
        assert state.nodes[m].warehouse == state.nodes[n].warehouse, f"warehouse of {n}"
    for e in range(len(mapdef.edges)):
        assert state.edges[mapdef.mirror_edges[e]].width == state.edges[e].width
    p0, p1 = state.players[0], state.players[1]
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
    for g0 in alive0:
        assert _plain(state.groups[g0]) == _mirrored(state, state.groups[groups[g0]]), g0
    mem0, mem1 = state.vision_memory[0], state.vision_memory[1]
    assert {mapdef.mirror_nodes[n]: s for n, s in mem0.nodes.items()} == mem1.nodes
    assert {mapdef.mirror_edges[e]: s for e, s in mem0.edges.items()} == mem1.edges


def _new_groups(events: list[Event], player: int) -> list[int]:
    """Ids of the groups made by ``player``'s commands, in ``seq`` order."""
    new: list[int] = []
    for e in events:
        if e.get("player") != player or e.kind not in ("group_split", "recruited"):
            continue
        gid = e.get("new_group" if e.kind == "group_split" else "group")
        assert isinstance(gid, int)
        new.append(gid)
    return new


@pytest.mark.parametrize("path", MAPS, ids=lambda p: p.stem)
def test_mirrored_commands_give_the_mirrored_state(path: Path, rules: Ruleset) -> None:
    state = initial_state(load_map(path), rules)
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
    applied = captures = moves_on_edges = 0
    for tick in range(1, TICKS + 1):
        state.tick = tick
        commands = [PlayerCommand(0, seq, cmd) for seq, cmd in enumerate(pending)]
        commands += [
            PlayerCommand(1, seq, _mirror_cmd(state, cmd, groups))
            for seq, cmd in enumerate(pending)
        ]
        results, events = apply_commands(state, rules, commands)
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
        economy(state, rules)
        moved = movement(state, rules)
        captures += sum(e.kind == "node_captured" for e in moved)
        vision(state, rules)
        moves_on_edges += sum(isinstance(g.location, OnEdge) for g in state.groups.values())
        _assert_mirrored(state, groups)
        pending = _decide(state, rules, 0) if tick % DECIDE_EVERY == 0 else []
    # The run did something: commands were applied, groups moved and took nodes.
    assert applied > 20
    assert {"Move", "Split", "SetMode", "Recruit", "SetStance"} <= set(kinds)
    assert moves_on_edges > 0
    # On pass the only way out is the central node 3; both players reach it at once, so it
    # stays neutral (a fight for SIM-09) and nothing is captured.
    assert captures >= (0 if path.stem == "pass" else 2)
