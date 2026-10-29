"""Match against a bot (SRV-06, #53).

``POST /api/bot-matches`` starts a match at once: no invite, no waiting. The answer carries the
``match_id`` for the WebSocket ``/ws/match/{match_id}``; the player connects like in any match.
The match is ``private`` (unrated, one pause per player, DEC-05).

Difficulty levels are different bots of ``gow_bots.bots.BOTS``, ordered by the win rates of
``docs/balance/latest.md`` (``rusher`` beats the rest, ``turtle`` loses to all); the parameters of
a bot vary with the match seed (``choose_params``). The player's side is random, like in an invite.
An account has at most one active match of any kind (409, SRV-09): a bot match costs server CPU.
At most ``GOW_MAX_BOT_MATCHES`` bot matches run at once and ``GOW_MAX_MATCHES`` matches in all:
past that the answer is 503 (#412). A bot match nobody connects to within
``GOW_BOT_CONNECT_TIMEOUT_S`` is dropped as never started.
The match goes through the lifecycle (``gow_server.lifecycle``): a ``matches`` row is written first.
"""

import secrets
from typing import Final, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict

from gow_bots.bots import BOTS
from gow_server.abuse import Limits, enforce, server_full
from gow_server.identity import CurrentPlayer
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle, MatchState
from gow_server.maps import MapCatalog
from gow_server.matches import BOT_ACCOUNT, BotSeat, ManagerDrainingError, ServerFullError
from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset

Level = Literal["easy", "normal", "hard", "expert"]

LEVEL_BOTS: Final[dict[Level, str]] = {
    "easy": "turtle",
    "normal": "reactive",
    "hard": "expander",
    "expert": "rusher",
}
"""Bot name of every difficulty level.

The bot screen of the client describes them in ``apps/client/src/app/botStyles.ts``;
``tests/test_bot_styles.py`` keeps the two in step.
"""

SEED_BITS: Final = 32

router = APIRouter(prefix="/api/bot-matches", tags=["bot match"])


class CreateBotMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: Level = "normal"
    map_id: str | None = None
    """A map of the pool; a random one if omitted."""


class BotMatchOut(BaseModel):
    match_id: str
    """Connect to ``/ws/match/{match_id}``."""
    map_id: str
    level: Level
    player: int
    """Your side (slot) in the match."""


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_bot_match(
    body: CreateBotMatch, request: Request, response: Response, player: CurrentPlayer
) -> BotMatchOut:
    lifecycle: MatchLifecycle = request.app.state.lifecycle
    catalog: MapCatalog = request.app.state.maps
    rules: Ruleset = request.app.state.ruleset
    limits: Limits = request.app.state.limits
    enforce(limits.match_create, str(player.id), "too many matches created")
    if body.map_id is None:
        pool = catalog.all()
        if not pool:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
        entry = secrets.choice(pool)
    else:
        found = catalog.get(body.map_id)
        if found is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown map")
        entry = found
    if lifecycle.active_of(player.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="you already have an active match")
    slot = secrets.randbelow(len(PLAYERS))
    bot_slot = 1 - slot
    controller = BOTS[LEVEL_BOTS[body.level]](
        entry.definition, rules, seed=secrets.randbits(SEED_BITS), player=bot_slot
    )
    accounts = [BOT_ACCOUNT, BOT_ACCOUNT]
    accounts[slot] = player.id
    record = lifecycle.open_record()
    try:
        runner = await lifecycle.start(
            record,
            entry.id,
            entry.definition,
            rules,
            (accounts[0], accounts[1]),
            private=True,
            bot=BotSeat(bot_slot, controller),
            bot_name=LEVEL_BOTS[body.level],
        )
    except AlreadyActiveError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="you already have an active match"
        ) from None
    except ManagerDrainingError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="server is restarting"
        ) from None
    except ServerFullError:
        raise server_full() from None
    finally:
        if record.state is MatchState.CREATED:
            lifecycle.abort(record, "start_failed")
    response.headers["Cache-Control"] = "no-store"
    return BotMatchOut(match_id=runner.match_id, map_id=entry.id, level=body.level, player=slot)
