"""The bots read the burn of a plains defender (DEC-45, #778).

Expected values come from the DEC-45 table (mechanics.md, section 4): the real shots of a defender
about to be attacked are ``charged - 1``, so a fresh target needs those shots; in a fight past its
first round the charges the view shows all shoot, and the charge is gone after the fight.
"""

from dataclasses import replace
from pathlib import Path
from typing import cast

from gow_bots.bots.utility import defender_pool, first_burn, shots_to_take, terrain_burned
from gow_sim.maps import Terrain
from gow_sim.ruleset import load_ruleset
from gow_sim.view import FightView, PlayerView

ROOT = Path(__file__).resolve().parents[3]
BURN = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
NODE = 7


def _fight(node: int | None, mute: tuple[int, int]) -> FightView:
    return FightView(
        id=1,
        node=node,
        edge=None,
        point=None,
        attacker=0,
        start_tick=1,
        next_round_tick=41,
        groups=(),
        enemy_units=2,
        enemy_charged=2,
        shots=(0, 0),
        losses=(0, 0),
        virtual_left=(0, 0),
        mute=mute,
        last_round=None,
    )


class _View:
    def __init__(self, *fights: FightView) -> None:
        self.fights = fights


def _view(*fights: FightView) -> PlayerView:
    return cast(PlayerView, _View(*fights))


def test_a_fresh_target_needs_the_shots_of_its_real_charges() -> None:
    """Row 8: 2/2 on plains fires 1 real shot, so the node falls to 1 + 2 = 3 shots."""
    assert BURN.terrain.defense_mod.plains == -1
    assert shots_to_take(BURN, Terrain.PLAINS, 2, 2) == 3


def test_past_the_first_round_every_charge_the_view_shows_shoots() -> None:
    """2 units, 1 charged left after the burn: 1 shot, the node falls to 1 + 2 = 3 shots; a fight
    with the burn still to come takes the charge off as before."""
    assert defender_pool(BURN, Terrain.PLAINS, 1) == 0
    assert defender_pool(BURN, Terrain.PLAINS, 1, burned=True) == 1
    assert shots_to_take(BURN, Terrain.PLAINS, 2, 1, burned=True) == 3
    assert defender_pool(BURN, Terrain.MOUNTAINS, 1, burned=True) == 2  # a bonus is not a burn


def test_terrain_burned_reads_the_view() -> None:
    assert not terrain_burned(BURN, _view(), NODE)
    assert not terrain_burned(BURN, _view(_fight(NODE, (0, 1))), NODE)  # still to burn
    assert terrain_burned(BURN, _view(_fight(NODE, (0, 0))), NODE)
    assert not terrain_burned(BURN, _view(_fight(NODE + 1, (0, 0))), NODE)
    assert not terrain_burned(BURN, _view(_fight(None, (0, 0))), NODE)


def test_the_burned_charge_is_gone_after_the_fight() -> None:
    assert first_burn(BURN, Terrain.PLAINS, 2) == 1
    assert first_burn(BURN, Terrain.PLAINS, 0) == 0
    assert first_burn(BURN, Terrain.FOREST, 2) == 0
    assert first_burn(BURN, Terrain.MOUNTAINS, 2) == 0
    deep = replace(BURN.terrain.defense_mod, plains=-3)
    rules = replace(BURN, terrain=replace(BURN.terrain, defense_mod=deep))
    assert first_burn(rules, Terrain.PLAINS, 2) == 2
