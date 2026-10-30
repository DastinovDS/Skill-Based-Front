"""#473: the level lines of the client's bot screen describe the bot the server starts per level.

``apps/client/src/app/botStyles.ts`` names the bot of each level (Bunker, Counter, Strangler and
Expander are client copy about them); this test fails when ``LEVEL_BOTS`` maps a level
to another bot.
"""

import re
from pathlib import Path
from typing import Final

from gow_server.botmatch import LEVEL_BOTS

STYLES: Final = Path(__file__).parents[2] / "client" / "src" / "app" / "botStyles.ts"


def test_client_names_the_bot_of_every_level() -> None:
    source = STYLES.read_text(encoding="utf-8")
    shown = dict(re.findall(r"^\s+(\w+): \{\s+bot: '([\w@]+)'", source, flags=re.MULTILINE))
    assert shown == dict(LEVEL_BOTS)
