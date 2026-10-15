"""The bots with the city development of DEC-26 (#265, item 11): ``rulesets/mvp-1.toml``.

- ``Recruit`` only in an own city with the barracks (``NodeView.has_barracks``): never a
  ``NO_BARRACKS``;
- the barracks are built where they shorten the way of the recruits to the front, and the bots
  use them; without ``city_upgrades`` (``mvp-0``) no barracks and no warehouse commands at all.
"""

import pytest

from gow_bots.bots import BOTS
from gow_sim.commands import BuildBarracks, Command, Recruit, Reject, RejectCode, UpgradeWarehouse
from gow_sim.maps import MapDef
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.view import PlayerView

STRATEGIC = ("rusher", "strangler", "reactive", "expander", "turtle")
EXPANDING = ("expander",)
"""The bot that takes the map slowly: its front leaves the capital behind and CP pile up, so it
builds barracks there. The campaign bots spend every CP on orders and end a match early (the
barracks then come only when CP pile up), the turtle holds a region around its capital."""
TICKS = 3000


class _Watcher:
    """Passes the decisions of a bot through, checks every ``Recruit`` against the view."""

    def __init__(self, bot: Controller) -> None:
        self.bot = bot
        self.cmds: list[Command] = []

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.bot.decide(view, tick)
        for cmd in cmds:
            if isinstance(cmd, Recruit):
                assert view.nodes[cmd.node].has_barracks, (tick, cmd)
        self.cmds.extend(cmds)
        return cmds


@pytest.mark.parametrize("bot", STRATEGIC)
def test_recruits_only_with_barracks_and_builds_them(
    bot: str, maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["arteriya"]
    watched = [
        _Watcher(BOTS[bot](mapdef, mvp1_rules, seed=s, player=p)) for p, s in ((0, 3), (1, 4))
    ]
    results: list[Reject] = []

    class _Rejects:
        def begin(self, match: Match) -> None:
            del match

        def record(self, match: Match, commands: object) -> None:
            del commands
            results.extend(r.outcome for r in match.results if isinstance(r.outcome, Reject))

    run_headless(mapdef, mvp1_rules, watched, max_ticks=TICKS, observer=_Rejects())
    assert RejectCode.NO_BARRACKS not in {r.code for r in results}
    if bot in EXPANDING:
        built = [c for w in watched for c in w.cmds if isinstance(c, BuildBarracks)]
        assert built, "a front city got the barracks"
        assert any(
            c.node != mapdef.capital(p)
            for p, w in enumerate(watched)
            for c in w.cmds
            if isinstance(c, Recruit)
        ), "the new barracks recruit"


@pytest.mark.parametrize("bot", STRATEGIC)
def test_no_city_development_without_the_flag(
    bot: str, maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pautina"]
    watched = [_Watcher(BOTS[bot](mapdef, mvp_rules, seed=1, player=p)) for p in (0, 1)]
    run_headless(mapdef, mvp_rules, watched, max_ticks=1500)
    assert not [
        c for w in watched for c in w.cmds if isinstance(c, BuildBarracks | UpgradeWarehouse)
    ]
