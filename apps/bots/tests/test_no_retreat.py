"""The bots without retreat from a fight (DEC-40, variant N, #626; ``rulesets/mvp-6.toml``).

The server rejects a withdrawal from a fight with ``IN_FIGHT`` there, so the bots must not send
one: ``Bot.fight_commands`` reads ``combat.retreat`` of the ``Ruleset`` they get. Reinforcing a
fight stays.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, ReactiveBot
from gow_sim.commands import CancelOrder, PlayerCommand, Reject, RejectCode
from gow_sim.maps import MapDef, load_map, parse_map
from gow_sim.match import Match
from gow_sim.ruleset import Retreat, Ruleset, load_ruleset
from gow_sim.state import AtNode, Group, Mode, OnEdge, Order, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.view import PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MVP0 = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
"""Historical: ``combat.retreat = "round"``, the only kind of ruleset with a withdrawal."""
MVP6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
MVP7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


def _lost_attack(rules: Ruleset) -> tuple[PlayerView, ReactiveBot]:
    """Player 0's 2/2 arrives in node 1 of the line ``0 - 1 - 2`` and fights player 1's 2/2 with 2
    bonus shots left: every round costs the attack a unit, so under ``retreat = "round"`` it
    cancels (``test_bots.py``, DEC-32, item 8)."""
    nodes = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i != 1 else "city_large",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": 0 if i == 0 else 1,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(2)
    ]
    mirror = {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}}
    meta = {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20}
    mapdef = parse_map({"meta": meta, "nodes": nodes, "edges": edges, "mirror": mirror})
    state = initial_state(mapdef, rules)
    state.groups[0] = Group(0, 1, 2, 2, Mode.ATTACK, AtNode(1))
    way = leg(mapdef, rules, 0, 1)
    there = OnEdge(0, 0, way.progress(way.ticks - 1))
    state.groups[1] = Group(1, 0, 2, 2, Mode.ATTACK, there, order=Order((1,), False, 0))
    state.next_id = 2
    state.tick = 1
    state.events = movement(state, rules)
    state.events += combat(state, rules)
    (fight,) = state.fights.values()
    fight.virtual = (0, 2)
    return project(state, rules, 0, KEY), ReactiveBot(mapdef, rules, seed=1, player=0)


def test_a_lost_fight_is_not_left_without_retreat() -> None:
    view, bot = _lost_attack(MVP0)
    (fight,) = view.fights
    assert bot.fight_commands(view, view.tick, budget=10_000) == [CancelOrder(fight.groups[0])]
    none = dataclasses.replace(MVP0, combat=dataclasses.replace(MVP0.combat, retreat=Retreat.NONE))
    view, bot = _lost_attack(none)
    assert bot.fight_commands(view, view.tick, budget=10_000) == []


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


@pytest.mark.parametrize("name", ["rusher", "reactive", "smart_exploiter", "smart_rusher"])
@pytest.mark.parametrize("rules", [MVP6, MVP7], ids=["mvp-6", "mvp-7"])
def test_bots_send_no_withdrawal_without_retreat(
    crossroads: MapDef, name: str, rules: Ruleset
) -> None:
    """300 s of a match against ``smart_rusher``: fights happen, ``IN_FIGHT`` never comes back."""
    match = Match(crossroads, rules, KEY)
    bots = [
        BOTS[name](crossroads, match.rules, seed=3, player=0),
        BOTS["smart_rusher"](crossroads, match.rules, seed=3, player=1),
    ]
    assert rules.combat.retreat is Retreat.NONE
    seq = 0
    fights = 0
    rejected = 0
    while match.tick < 3000 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
        fights += sum(e.kind == "fight_started" for e in match.state.events)
        rejected += sum(r.outcome == Reject(RejectCode.IN_FIGHT) for r in match.results)
    assert fights > 0
    assert rejected == 0
