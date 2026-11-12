"""#899: the two divergences of a true mirror found on ``mvp-7``, and a pool-map smoke.

A true mirror: both sides of one bot get the parameters of side 0 (``choose_params`` forced to
side 0), on a ``rot180`` pool map, so nothing but the opaque ids differs between them. A bot that
is mirror-invariant (AGENTS.md, section 4.1, item 6) ends in a draw on VP with the same number of
accepted commands. Of 96 such matches on ``mvp-7`` (6 bots at ``hard``, the 4 pool maps, 4 seeds)
two were not exact:

* ``smart_strangler@hard`` on ``ridge``, seed 3 (VP 483 : 581), from tick 3541: the held plan of
  a chosen scheduled attack (``Hold``) named a group by its opaque id; two idle 1/1 groups of one
  node merged at tick 3536 into the group of the lowest internal id, which is the first of the
  node for one side and not for the other, so on one side the hold was dropped and its CP went to
  an ordinary move instead of the plan. Fixed: a ``Hold`` also names the node, any idle group
  there keeps it.
* ``smart_exploiter`` on ``narrows``, seed 3, from tick 4661: two interchangeable idle groups of
  the capital (same node, units and charges) are sent with scheduled orders to two targets. Which
  group gets which target follows the opaque id, which differs between the sides; the simulation
  then serves the gathering plans in the order of the internal group id and the first one departs
  first, so the targets leave in the other order on one side (``gather_plans``, SIM). A bot cannot
  see the internal order and the rule is the simulation's, so this stays open (xfail, strict).
"""

from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

import gow_bots.bots.base as base
from gow_bots.bots import BOTS, ParamRange, SmartBot, bot_factory
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.smart import Hold
from gow_sim.commands import Ok, PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match, play
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode, initial_state
from gow_sim.systems.flow import update_flow
from gow_sim.view import project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture
def side_zero_params(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every bot draws its parameters as player 0 does."""
    draw = base.choose_params

    def same(name: str, seed: int, player: int, ranges: Mapping[str, ParamRange]) -> dict[str, int]:
        return draw(name, seed, 0, ranges)

    monkeypatch.setattr(base, "choose_params", same)
    yield


def _mirror_match(map_name: str, bot: str, seed: int) -> None:
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    factory = bot_factory(bot)
    result = play(mapdef, RULES, [factory, factory], seed=seed)
    assert result.vp[0] == result.vp[1]
    assert result.accepted[0] == result.accepted[1]
    assert result.outcome is not None and result.outcome.winner is None


@pytest.mark.slow  # one full match
@pytest.mark.usefixtures("side_zero_params")
def test_mirror_strangler_on_ridge_seed_3() -> None:
    _mirror_match("ridge", "smart_strangler@hard", 3)


@pytest.mark.slow  # one full match
@pytest.mark.xfail(
    strict=True,
    reason="#899: interchangeable groups get their plan targets by opaque id, the simulation "
    "serves plans by internal id (gather_plans); a bot cannot see that order",
)
@pytest.mark.usefixtures("side_zero_params")
def test_mirror_exploiter_on_narrows_seed_3() -> None:
    _mirror_match("narrows", "smart_exploiter", 3)


# The held plan survives a merge (the fast form of the first case) ------------------------------


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ["smart_strangler", "smart_rusher"])
def test_a_hold_stays_while_an_idle_group_stands_in_its_node(name: str, player: int) -> None:
    """The group a ``Hold`` named merged into another idle group of its node (a new opaque id):
    the plan still has a group there, the hold and its CP stay. With no idle group in the node
    any more, the hold ends."""
    mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
    home = mapdef.capital(player)
    state = initial_state(mapdef, RULES)
    state.groups.clear()
    state.tick = 1000
    gid = state.new_id()
    state.groups[gid] = Group(gid, player, 2, 2, Mode.ATTACK, AtNode(home))
    update_flow(state, RULES)
    view = project(state, RULES, player, KEY)
    bot = bot_factory(name)(mapdef, RULES, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    dest = next(n.id for n in view.nodes if n.owner != player)
    gone = 123456789  # the opaque id the group had before the merge
    bot.hold = Hold(dest, gone, home, 100, 1500)
    ctx = Ctx(view, 1000, view.me.cp, standing=bot.standing(view))
    assert bot.held_cp(ctx) == 100
    assert bot.hold is not None
    state.groups.clear()
    update_flow(state, RULES)
    empty = project(state, RULES, player, KEY)
    ctx = Ctx(empty, 1000, empty.me.cp, standing=bot.standing(empty))
    assert bot.held_cp(ctx) == 0
    assert bot.hold is None


# A pool-map smoke per personality --------------------------------------------------------------

PERSONALITIES = tuple(
    sorted(n for n in BOTS if n.startswith("smart_") and "@" not in n and n != "smart_hoarder")
)
POOL = ("crossroads", "highway", "narrows", "ridge")


@pytest.mark.slow  # 6 personalities x 4 maps, 2000 ticks each
@pytest.mark.parametrize("map_name", POOL)
@pytest.mark.parametrize("name", PERSONALITIES)
def test_every_personality_plays_a_pool_map_on_mvp_7(name: str, map_name: str) -> None:
    """The first 200 s of a match against the exploiter on a pool map: no crash, both sides send
    commands and the simulation accepts them."""
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    match = Match(mapdef, RULES, KEY)
    bots = [
        bot_factory(name)(mapdef, match.rules, seed=1, player=0),
        bot_factory("smart_exploiter")(mapdef, match.rules, seed=1, player=1),
    ]
    sent = [0, 0]
    accepted = [0, 0]
    seq = 0
    while match.tick < 2000 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    sent[p] += 1
                    seq += 1
        match.step(cmds)
        for r in match.results:
            if isinstance(r.outcome, Ok):
                accepted[r.player] += 1
    assert sent[0] > 0 and sent[1] > 0
    assert accepted[0] > 0 and accepted[1] > 0
