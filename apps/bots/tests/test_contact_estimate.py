"""The attack estimate before contact under ``combat.retreat = "none"`` (#881; DEC-40, DEC-24).

Expected values come from the rules. The line ``0 - 1 - 2 - 3 - 4 - 5 - 6``: player 0's capital 0
and city 1, where its group of 4 charged units stands; the enemy's 2 to 5 and capital 6; all forest
(no terrain modifier, ``terrain.defense_mod.forest = 0``). The target 2 holds 1 unit with 1
charge: the pool is 1, so an attack takes it with 1 shot to cancel and 1 to kill (DEC-07, rules 2
to 4), and pays the capture with 1 more real charge (``capture.charge_cost = 1``, DEC-38): a group
of 4 charged units takes it (4 >= 2 + 1, plus the margin of at most 1 of ``smart_strangler``).

The fight lasts a round per shot at one shot a round, the first one ``combat.round_ticks`` after
the contact (DEC-24, items B2, B4): 2 rounds, 40 ticks. An enemy group of 3/3 seen in node 3 next
to the target whose road into it takes fewer ticks joins the fight (D1) and has to be cancelled and
killed too: 2 + 6 = 8 shots, more than 4 brings; under ``"none"`` the group could not leave
(DEC-40), so the attack is not sent. On a road of more ticks than the fight the 3/3 arrives after
the last round and the attack goes. Under ``"round"`` the estimate is the one before #881 (the
attack goes either way). An enemy figure of 3/3 on the road 1 - 2 heading out of 2 meets the attack
on the edge and cancels 3 charges first (DEC-24, C2): 4 - 3 = 1 is short of 2 + 1. Every case is
also played by player 1 on the mirrored line.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_bots.bots import bot_factory
from gow_bots.bots.assess import edge_ticks
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import Retreat, Ruleset, load_ruleset
from gow_sim.state import AtNode, Group, Mode, Sighting, initial_state
from gow_sim.view import Detail, EnemyGroupView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MVP6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
ROUND = dataclasses.replace(MVP6, combat=dataclasses.replace(MVP6.combat, retreat=Retreat.ROUND))
TICK = 1000
BOT = "smart_strangler"
"""A personality that counts all of a reinforcement (``contact_pct`` 100) and ranks the target."""


def _line(road: int) -> MapDef:
    """The line; ``road``: the travel ticks of the roads 2 - 3 and 3 - 4 (the reinforcement's)."""
    nodes = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i in (0, 6) else "city_large",
            "capital_of": {0: 0, 6: 1}.get(i),
            "start_owner": 0 if i < 3 else 1 if i > 3 else None,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(7)
    ]
    edges = [
        {
            "id": i,
            "a": i,
            "b": i + 1,
            "max_level": 3,
            "travel_ticks": road if i in (2, 3) else 30,
            "border_permille": 500,
        }
        for i in range(6)
    ]
    mirror = {
        "nodes": {str(i): 6 - i for i in range(7)},
        "edges": {str(i): 5 - i for i in range(6)},
    }
    meta = {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20}
    return parse_map({"meta": meta, "nodes": nodes, "edges": edges, "mirror": mirror})


def _view(
    mapdef: MapDef, rules: Ruleset, player: int, *, helper: bool = True, figure: bool = False
) -> tuple[PlayerView, int]:
    """The view of ``player`` and its target; ``helper``: the 3/3 seen in node 3 this tick;
    ``figure``: a 3/3 figure on the road from the own city to the target heading out of it."""
    own = (mapdef.node_key(player, 0), mapdef.node_key(player, 1))
    target = mapdef.node_key(player, 2)
    state = initial_state(mapdef, rules)
    state.groups.clear()
    state.tick = TICK
    for n in range(7):
        state.nodes[n].owner = player if n in own else 1 - player
    state.groups[1] = Group(1, player, 4, 4, Mode.ATTACK, AtNode(own[1]))
    state.groups[2] = Group(2, 1 - player, 1, 1, Mode.ATTACK, AtNode(target))
    state.groups[3] = Group(3, 1 - player, 3, 3, Mode.ATTACK, AtNode(3))
    state.next_id = 4
    view = project(state, rules, player, KEY)
    seen = list(view.nodes)
    exact = Detail.EXACT
    seen[target] = dataclasses.replace(
        seen[target], seen=Sighting(TICK, exact, (Mode.ATTACK,), 1, 1)
    )
    seen[3] = dataclasses.replace(
        seen[3], seen=Sighting(TICK, exact, (Mode.ATTACK,), 3, 3) if helper else None
    )
    edges = list(view.edges)
    if figure:
        road = 1 if player == 0 else mapdef.mirror_edges[1]
        out_to_b = mapdef.edges[road].b != target  # heading to the own city
        fig = EnemyGroupView(9, 600, out_to_b, exact, Mode.ATTACK, 3, 3, None)
        edges[road] = dataclasses.replace(edges[road], enemy_groups=(fig,))
    return dataclasses.replace(view, nodes=tuple(seen), edges=tuple(edges)), target


def _targets(rules: Ruleset, mapdef: MapDef, view: PlayerView, player: int) -> list[int]:
    bot = bot_factory(BOT)(mapdef, rules, seed=0, player=player)
    assert isinstance(bot, CampaignBot)
    ctx = Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))
    return [o.dest for o in bot.options(ctx, bot.free_groups(ctx))]


def test_the_reinforcement_road_is_shorter_than_the_fight() -> None:
    """The premise of the cases: 2 rounds of 20 ticks; a road of 30 ticks in forest is inside them,
    one of 80 is not."""
    assert MVP6.combat.round_ticks == 20 and MVP6.combat.shots_per_round == 1
    assert MVP6.terrain.defense_mod.forest == 0 and MVP6.capture.charge_cost == 1
    assert edge_ticks(_line(30), MVP6, 2, 2) < 40 <= edge_ticks(_line(80), MVP6, 2, 2)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize(
    ("rules", "road", "helper", "attacks"),
    [
        (MVP6, 30, True, False),  # the 3/3 joins within the fight: 8 shots, 4 brought
        (MVP6, 80, True, True),  # it arrives after the last round
        (MVP6, 30, False, True),  # nothing seen next to the target
        (ROUND, 30, True, True),  # "round": the estimate before #881
        (ROUND, 80, True, True),
    ],
)
def test_a_reinforced_target_is_not_attacked_without_retreat(
    player: int, rules: Ruleset, road: int, helper: bool, attacks: bool
) -> None:
    mapdef = _line(road)
    view, target = _view(mapdef, rules, player, helper=helper)
    assert (target in _targets(rules, mapdef, view, player)) is attacks


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize(("rules", "attacks"), [(MVP6, False), (ROUND, True)])
def test_a_figure_met_on_the_road_in(player: int, rules: Ruleset, attacks: bool) -> None:
    mapdef = _line(80)  # no reinforcement in time: only the figure counts
    view, target = _view(mapdef, rules, player, figure=True)
    assert (target in _targets(rules, mapdef, view, player)) is attacks
