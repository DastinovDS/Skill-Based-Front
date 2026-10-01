"""Bot controllers (AGENTS.md, section 8). They see only ``PlayerView``, the map and the ruleset.

``BOTS`` maps a bot name to its factory ``(mapdef, rules, *, seed, player) -> Controller``.
"""

from typing import Final

from gow_bots.bots.base import Bot, BotFactory, Controller, ParamRange, choose_params
from gow_bots.bots.basic import IdleBot, RandomLegalBot
from gow_bots.bots.reactive import ReactiveBot
from gow_bots.bots.rusher import RusherBot
from gow_bots.bots.strangler import StranglerBot
from gow_bots.bots.strategy import ExpanderBot, TurtleBot
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take

__all__ = [
    "BOTS",
    "Bot",
    "BotFactory",
    "Controller",
    "ExpanderBot",
    "IdleBot",
    "ParamRange",
    "RandomLegalBot",
    "ReactiveBot",
    "RusherBot",
    "StranglerBot",
    "TurtleBot",
    "choose_params",
    "defender_pool",
    "prefer_planned",
    "shots_to_take",
]

BOTS: Final[dict[str, BotFactory]] = {
    IdleBot.name: IdleBot,
    RandomLegalBot.name: RandomLegalBot,
    RusherBot.name: RusherBot,
    StranglerBot.name: StranglerBot,
    ReactiveBot.name: ReactiveBot,
    ExpanderBot.name: ExpanderBot,
    TurtleBot.name: TurtleBot,
}
