"""Bot controllers (AGENTS.md, section 8). They see only ``PlayerView``, the map and the ruleset.

``BOTS`` maps a bot name to its factory ``(mapdef, rules, *, seed, player) -> Controller``.
``bot_factory`` also takes a smart bot with a difficulty level, ``<name>@<level>`` (``easy``,
``normal``, ``hard``; ``gow_bots.bots.tempo``), and parameter overrides (the search, #166).
"""

from collections.abc import Mapping
from typing import Final

from gow_bots.bots.base import Bot, BotFactory, Controller, ParamRange, choose_params
from gow_bots.bots.basic import IdleBot, RandomLegalBot
from gow_bots.bots.reactive import ReactiveBot
from gow_bots.bots.rusher import RusherBot
from gow_bots.bots.smart import (
    PERSONALITIES,
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
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset

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
]

BOTS: Final[dict[str, BotFactory]] = {
    IdleBot.name: IdleBot,
    RandomLegalBot.name: RandomLegalBot,
    RusherBot.name: RusherBot,
    StranglerBot.name: StranglerBot,
    ReactiveBot.name: ReactiveBot,
    ExpanderBot.name: ExpanderBot,
    TurtleBot.name: TurtleBot,
    **{cls.name: cls for cls in PERSONALITIES},
}

LEVEL_SEP: Final = "@"
"""Separates a smart bot's name from its difficulty level: ``smart_rusher@easy``."""


def bot_factory(name: str, params: Mapping[str, ParamRange] | None = None) -> BotFactory:
    """The factory of bot ``name`` (a ``BOTS`` name, a smart one with ``@<level>``), with the
    parameter ranges ``params`` in place of the class's ones (only keys it has).

    Raises ``ValueError`` for an unknown bot, level or parameter, or a level of a bot that is not
    a smart one.
    """
    base, sep, level = name.partition(LEVEL_SEP)
    cls = BOTS.get(base)
    if cls is None:
        raise ValueError(f"unknown bot {base!r}; known: {sorted(BOTS)}")
    if not sep and not params:
        return cls
    if not isinstance(cls, type) or not issubclass(cls, Bot):
        raise ValueError(f"bot {base!r} takes no level and no parameters")
    if sep and (not issubclass(cls, SmartBot) or level not in DIFFICULTIES):
        raise ValueError(f"bad level {name!r}: smart bots take {sorted(DIFFICULTIES)}")
    unknown = sorted(set(params or {}) - set(cls.PARAMS))
    if unknown:
        raise ValueError(f"bot {base!r} has no parameters {unknown}")
    bot_cls: type[Bot] = (
        type(cls.__name__, (cls,), {"PARAMS": {**cls.PARAMS, **params}}) if params else cls
    )
    difficulty = level or DEFAULT_DIFFICULTY

    def make(mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> Controller:
        if issubclass(bot_cls, SmartBot):
            return bot_cls(mapdef, rules, seed=seed, player=player, difficulty=difficulty)
        return bot_cls(mapdef, rules, seed=seed, player=player)

    return make
