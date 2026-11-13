"""The bot of every difficulty level and the playtest override ``GOW_LEVEL_BOTS`` (#1037)."""

from typing import Final, Literal, cast, get_args

from gow_bots.bots import bot_factory

Level = Literal["easy", "normal", "hard", "expert"]

LEVEL_BOTS: Final[dict[Level, str]] = {
    "easy": "smart_turtle@easy",
    "normal": "smart_reactive@normal",
    "hard": "smart_strangler@hard",
    "expert": "smart_expander@hard",
}
"""Bot name of every difficulty level with its tempo level (``bot_factory``; ``bot_name``).

The bot screen of the client describes them in ``apps/client/src/app/botStyles.ts``;
``tests/test_bot_styles.py`` keeps the two in step. ``GOW_LEVEL_BOTS`` replaces some of them
on one server (``level_bots``); this table stays the default.
"""


def level_bots(override: str) -> dict[Level, str]:
    """``LEVEL_BOTS`` with the levels of ``override`` replaced.

    ``override`` is comma-separated ``level=bot`` pairs (``expert=owner_style``); empty: none.
    Raises ``ValueError`` with a readable message for a malformed pair, an unknown level or an
    unknown bot (checked through ``bot_factory``, so ``smart_rusher@hard`` works too).
    """
    result = dict(LEVEL_BOTS)
    levels: tuple[str, ...] = get_args(Level)
    for pair in filter(None, (part.strip() for part in override.split(","))):
        level, sep, bot = (piece.strip() for piece in pair.partition("="))
        if not sep or not bot:
            raise ValueError(f"GOW_LEVEL_BOTS: {pair!r} is not level=bot")
        if level not in levels:
            raise ValueError(f"GOW_LEVEL_BOTS: unknown level {level!r}; known: {list(levels)}")
        try:
            bot_factory(bot)
        except ValueError as error:
            raise ValueError(f"GOW_LEVEL_BOTS: {error}") from None
        result[cast(Level, level)] = bot
    return result
