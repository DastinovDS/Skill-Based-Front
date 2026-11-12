"""#1022: the defense of the smart bots (``gow_bots.bots.defense``, ``SmartBot`` item 29).

Expected values come from the rules: the pool and the shots that take a node (DEC-07, rules 1 to
4, ``shots_to_take``), the public intents of planned orders and their bonus of at most the charged
units (DEC-08, DEC-41 item 10), the public fights of an own node (DEC-24, item I1), and from the
step 4b plan of the owner (2026-11-12): a picket on every front node worth holding, a garrison on
the valuable ones, a salient given up, a mobile reserve behind the line, an answer to a strike at
any node, a retake of a lost node, the source of a siege and the empty rear while the enemy army
is committed.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_bots.bots import SmartExploiter, SmartHoarder, SmartStrangler
from gow_bots.bots.defense import (
    HOLD,
    PICKET,
    W_BREACH,
    W_RAID,
    W_RETAKE,
    W_SOURCE,
)
from gow_bots.bots.utility import shots_to_take, takes
from gow_sim.commands import GroupMove, Move
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import (
    AtNode,
    Detail,
    FightView,
    GroupView,
    IntentKind,
    IntentView,
    Mode,
    NodeView,
    PlayerView,
    Sighting,
)

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
TICK = 3000
LAST_OWN = 24
"""Crossroads split for the tests: nodes 0..24 are player 0's, 25..48 player 1's (no neutral)."""


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _group(gid: int, node: int, units: int, charged: int) -> GroupView:
    return GroupView(gid, units, charged, Mode.ATTACK, AtNode(node), None)


def _settled(
    mapdef: MapDef,
    rules: Ruleset,
    groups: tuple[GroupView, ...],
    owner: dict[int, int] | None = None,
    seen: dict[int, Sighting] | None = None,
    tick: int = TICK,
) -> PlayerView:
    """The view of player 0 on a crossroads without neutral nodes (the midgame)."""
    view = Match(mapdef, rules, KEY).view(0)
    nodes: list[NodeView] = []
    for n in view.nodes:
        o = (owner or {}).get(n.id, 0 if n.id <= LAST_OWN else 1)
        nodes.append(dataclasses.replace(n, owner=o, seen=(seen or {}).get(n.id)))
    return dataclasses.replace(
        view,
        tick=tick,
        me=dataclasses.replace(view.me, cp=400),
        nodes=tuple(nodes),
        groups=groups,
        intents=(),
        fights=(),
    )


def _seen(charged: int) -> Sighting:
    return Sighting(TICK, Detail.EXACT, (Mode.ATTACK,), charged, charged)


def _threats() -> dict[int, Sighting]:
    return {25: _seen(2), 27: _seen(3), 28: _seen(2)}


def _front(view: PlayerView, mapdef: MapDef, node: int) -> bool:
    nb = [e.other(node) for e in mapdef.edges if node in (e.a, e.b)]
    return view.nodes[node].owner == 0 and any(view.nodes[m].owner == 1 for m in nb)


def _army() -> tuple[GroupView, ...]:
    return (
        _group(1, 0, 4, 4),
        _group(2, 7, 3, 3),
        _group(3, 13, 2, 2),
        _group(4, 16, 2, 2),
        _group(5, 20, 3, 3),
        _group(6, 24, 3, 3),
        _group(7, 18, 2, 2),
        _group(8, 10, 3, 3),
    )


def test_the_line_holds_the_front_nodes_an_enemy_faces(crossroads: MapDef, rules: Ruleset) -> None:
    # Enemy forces in sight next to Millstead (18, from 25), Sentinel (20, from 27) and Crossroads
    # and Wallside (24, 21, from 28); nothing seen next to North Outpost (23, by 30).
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    view = _settled(crossroads, rules, _army(), seen=_threats())
    bot.decide(view, TICK)
    line = bot.defense.line
    units = sum(g.units for g in view.groups)
    budget = (units - bot.params["guard"]) * bot.HOLD_SHARE // 100
    held = [n for n, h in enumerate(line.hold) if h]
    assert held, "the midgame holds a line"
    assert all(_front(view, crossroads, n) for n in held)  # only the front nodes
    assert sum(line.hold) <= budget
    assert all(h in (PICKET, HOLD, HOLD + 1) for h in line.hold if h)
    for node in held:
        assert bot.front_hold(node) >= line.hold[node]
    assert line.hold[18] >= HOLD and line.hold[20] >= HOLD  # cities: a garrison
    assert line.hold[23] == 0  # no enemy in sight: nobody stands there


def test_a_salient_is_given_up(crossroads: MapDef, rules: Ruleset) -> None:
    # Loop (26, a province) with one own neighbour (Old Road, 19) and two enemy ones (30, 31).
    owner = {26: 0}
    big = (*_army(), _group(9, 15, 3, 3), _group(10, 11, 3, 3), _group(11, 12, 3, 3))
    seen = {**_threats(), 30: _seen(2), 31: _seen(2)}
    view = _settled(crossroads, rules, big, owner=owner, seen=seen)
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(view, TICK)
    assert crossroads.nodes[26].vp == 0
    assert bot.defense.line.hold[26] == 0
    assert any(bot.defense.line.hold)


def test_the_opening_holds_no_line(crossroads: MapDef, rules: Ruleset) -> None:
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    view = Match(crossroads, rules, KEY).view(0)  # most of the map is neutral
    bot.decide(view, 0)
    assert not any(bot.defense.line.hold)


@pytest.mark.parametrize("bench", [SmartExploiter, SmartHoarder])
def test_the_benchmarks_keep_no_defense(
    crossroads: MapDef, rules: Ruleset, bench: type[SmartHoarder]
) -> None:
    bot = bench(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, _army()), TICK)
    assert not bot.defending()
    assert not any(bot.defense.line.hold) and not bot.defense.bonus


def test_a_strike_at_a_lesser_city_is_reinforced_when_the_sum_holds(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # Millstead (18, 1 VP, plains) holds 1 charged unit; the strike comes from South Outpost (25)
    # where 2 charged units are seen: 2 charges and a bonus of 2 (at most the charged units).
    target, origin, helper = 18, 25, 13
    groups = (_group(1, 0, 2, 2), _group(2, target, 1, 1), _group(3, helper, 2, 2))
    view = _settled(crossroads, rules, groups, seen={origin: _seen(2)})
    strike = IntentView(77, 1, IntentKind.PLANNED_MOVE, origin, target, TICK - 5)
    view = dataclasses.replace(view, intents=(strike,))
    terrain = crossroads.nodes[target].terrain
    shots = 2 * 2
    assert shots_to_take(rules, terrain, 1, 1) <= shots  # the picket alone falls
    assert shots_to_take(rules, terrain, 3, 3) > shots  # with the helper it holds
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert not bot.worth_defending(target)  # the old answer leaves a 1-VP city alone
    cmds = bot.decide(view, TICK)
    assert Move(3, target) in cmds
    assert 77 in bot.defense.answered


def test_a_garrison_a_strike_would_kill_whole_pulls_out(crossroads: MapDef, rules: Ruleset) -> None:
    # Wallside (21, a province, plains) holds one discharged unit; 3 charged units are seen in
    # Lookout (28): a strike of 6 shots kills it and nothing reaches it in time.
    target, origin = 21, 28
    groups = (_group(1, 0, 2, 2), _group(2, target, 1, 0))
    view = _settled(crossroads, rules, groups, seen={origin: _seen(3)})
    strike = IntentView(78, 1, IntentKind.PLANNED_MOVE, origin, target, TICK - 5)
    view = dataclasses.replace(view, intents=(strike,))
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    cmds = bot.decide(view, TICK)
    moves = [c for c in cmds if isinstance(c, Move) and c.group == 2]
    assert len(moves) == 1
    # Out to an own neighbour away from the enemy (Fairgate 16 or Glade 17), not Crossroads (24).
    assert moves[0].dest in (16, 17)


def test_a_lost_node_scores_a_retake(crossroads: MapDef, rules: Ruleset) -> None:
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, _army()), TICK)
    # Bend (22) falls; two own neighbours stay (Glade 17, Millstead 18): a breach.
    later = _settled(crossroads, rules, _army(), owner={22: 1}, tick=TICK + 5)
    bot.decide(later, TICK + 5)
    assert 22 in bot.defense.lost
    assert bot.defense.bonus[22] == W_RETAKE + W_BREACH * (2 - 1)


def test_a_siege_marks_its_source_and_the_empty_rear(crossroads: MapDef, rules: Ruleset) -> None:
    # The enemy besieges Sentinel (20) with 4 units; Overhill (27) is next to it, and the enemy
    # rear node Black Spring (38) was seen empty.
    empty = Sighting(TICK, Detail.EXACT, (), None, None)
    view = _settled(crossroads, rules, _army(), seen={27: _seen(1), 38: empty})
    fight = FightView(
        900,
        20,
        None,
        None,
        1,
        TICK - 10,
        TICK + 5,
        (5,),
        4,
        4,
        (0, 0),
        (0, 0),
        (0, 0),
        (0, 0),
        None,
    )
    view = dataclasses.replace(view, fights=(fight,))
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(view, TICK)
    assert bot.defense.bonus[27] >= W_SOURCE
    assert bot.defense.bonus[38] >= W_RAID


def test_a_breakthrough_is_retaken_by_the_nearest_groups_together(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # The owner's input of 2026-11-12: a broken node is sealed before the attacks. Bend (22,
    # forest province) falls to 2 charged units: the pool of 2 charges in the forest and 2 units
    # need more than the 3 charged units of Flint (13) or of Millstead (18) alone, but their sum
    # takes it with the capture charge (DEC-07, DEC-38): one synchronized group order (DEC-48),
    # though Millstead next to the breach holds a garrison now.
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    groups = (_group(1, 0, 2, 2), _group(2, 13, 3, 3), _group(3, 18, 3, 3))
    bot.decide(_settled(crossroads, rules, groups), TICK)
    seen = {22: Sighting(TICK + 5, Detail.EXACT, (Mode.ATTACK,), 2, 2)}
    later = _settled(crossroads, rules, groups, owner={22: 1}, seen=seen, tick=TICK + 5)
    terrain = crossroads.nodes[22].terrain
    need = shots_to_take(rules, terrain, 2, 2) + bot.params["margin"]
    assert not takes(rules, 3, 0, need) and takes(rules, 6, 0, need)
    cmds = bot.decide(later, TICK + 5)
    sealed = [c for c in cmds if isinstance(c, GroupMove) and c.dest == 22]
    assert len(sealed) == 1 and sorted(sealed[0].groups) == [2, 3]


def test_a_plains_stretch_is_held_only_with_a_counter_attack_ready(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # The owner's input of 2026-11-12: a defender on the plains burns a charge in the first round
    # (DEC-45), so a plains province is held only while a counter-attack stands ready behind it,
    # and then by a garrison, never a thin picket. Wallside (21, plains province, a warehouse of
    # 3) faces Lookout (28), where an enemy force is seen.
    assert rules.terrain.defense_mod.of(crossroads.nodes[21].terrain) < 0
    assert crossroads.nodes[21].vp == 0
    groups = (_group(1, 0, 10, 10), _group(2, 21, 1, 1), _group(3, 7, 3, 3), _group(5, 3, 3, 3))

    def line(extra: tuple[GroupView, ...]) -> tuple[int, ...]:
        bot = SmartStrangler(crossroads, rules, seed=0, player=0)
        view = _settled(crossroads, rules, (*groups, *extra), seen=_threats())
        nodes = list(view.nodes)
        nodes[21] = dataclasses.replace(nodes[21], warehouse=3)
        bot.decide(dataclasses.replace(view, nodes=tuple(nodes)), TICK)
        return bot.defense.line.hold

    assert line(())[21] == 0  # nothing behind it: left
    # Fairgate (16) behind it, off the front, with 2 charged units: a counter-attack is ready.
    assert line((_group(4, 16, 2, 2),))[21] >= HOLD


def test_a_stack_that_outguns_the_force_in_sight_is_free_to_strike(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # Sentinel (20, a city) holds 3 charged units; Overhill (27) next to it shows 2: the stack
    # is not tied to its node, it may strike (the combined attacks of #1023). With 3 in sight it
    # holds.
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, _army(), seen={27: _seen(2)}), TICK)
    assert bot.defense.line.hold[20] == 0
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, _army(), seen={27: _seen(3)}), TICK)
    assert bot.defense.line.hold[20] >= HOLD
