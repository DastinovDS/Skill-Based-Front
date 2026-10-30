"""Bot controllers (AGENTS.md, section 8). They see only ``PlayerView``, the map and the ruleset.

``BOTS`` maps a bot name to its factory ``(mapdef, rules, *, seed, player) -> Controller``.
``bot_factory`` also takes a smart bot with a difficulty level, ``<name>@<level>`` (``easy``,
``normal``, ``hard``; ``gow_bots.bots.tempo``), and parameter overrides (the search, #166).
"""

from gow_bots.bots.base import Bot, BotFactory, Controller, ParamRange, choose_params
from gow_bots.bots.basic import IdleBot, RandomLegalBot
from gow_bots.bots.hoarder import SmartHoarder
from gow_bots.bots.reactive import ReactiveBot
from gow_bots.bots.registry import BOTS, LEVEL_SEP, bot_factory
from gow_bots.bots.rusher import RusherBot
from gow_bots.bots.smart import (
    SmartBot,
    SmartExpander,
    SmartReactive,
    SmartRusher,
    SmartStrangler,
    SmartTurtle,
)
from gow_bots.bots.strangler import StranglerBot
from gow_bots.bots.strategy import ExpanderBot, TurtleBot
from gow_bots.bots.tempo import DEFAULT_DIFFICULTY, DIFFICULTIES, Tempo
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take, takes

__all__ = [
    "BOTS",
    "DEFAULT_DIFFICULTY",
    "DIFFICULTIES",
    "LEVEL_SEP",
    "Bot",
    "BotFactory",
    "Controller",
    "ExpanderBot",
    "IdleBot",
    "ParamRange",
    "RandomLegalBot",
    "ReactiveBot",
    "RusherBot",
    "SmartBot",
    "SmartExpander",
    "SmartHoarder",
    "SmartReactive",
    "SmartRusher",
    "SmartStrangler",
    "SmartTurtle",
    "StranglerBot",
    "Tempo",
    "TurtleBot",
    "bot_factory",
    "choose_params",
    "defender_pool",
    "prefer_planned",
    "shots_to_take",
    "takes",
]
