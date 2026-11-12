"""Match against a bot (SRV-06, #53).

``POST /api/bot-matches`` starts a match: no invite. The answer carries the ``match_id`` for the
WebSocket ``/ws/match/{match_id}``; the player connects like in any match. Without a map choice the
match gets a map made for it (#884, ``gow_server.mapgen``): the answer comes when the map is made,
a few seconds (at most ``GOW_MAPGEN_WAIT_S``, then a pool map); the player is claimed meanwhile.
The match is ``private`` (unrated, one pause per player, DEC-05).

Difficulty levels are smart bots with a tempo level (``bot_factory``, ``smart_reactive@easy``),
ordered by strength in the tournaments of #574 and #663 (``docs/balance/log.md``); the
parameters of a bot vary with the match seed (``choose_params``).
The player's side is random, like in an invite.
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

from gow_bots.bots import bot_factory
from gow_server.abuse import Limits, enforce, server_full
from gow_server.identity import CurrentPlayer
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle, MatchState
from gow_server.mapgen import MapMaker
from gow_server.maps import MapCatalog, MapSource, choose_map
from gow_server.matches import BOT_ACCOUNT, BotSeat, ManagerDrainingError, ServerFullError
from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset

Level = Literal["easy", "normal", "hard", "expert"]

LEVEL_BOTS: Final[dict[Level, str]] = {
    "easy": "smart_turtle@easy",
    "normal": "smart_reactive@normal",
    "hard": "smart_strangler@hard",
    "expert": "smart_expander@hard",
}
"""Bot name of every difficulty level with its tempo level (``bot_factory``; ``bot_name``).

The bot screen of the client describes them in ``apps/client/src/app/botStyles.ts``;
``tests/test_bot_styles.py`` keeps the two in step.
"""

SEED_BITS: Final = 32

router = APIRouter(prefix="/api/bot-matches", tags=["bot match"])


class CreateBotMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: Level = "normal"
    map_id: str | None = None
    """A map of the pool or a stored generated one; excludes ``map_source``."""
    map_source: MapSource | None = None
    """With no ``map_id``: ``new`` (the default: a map made for this match, #884), ``pool``
    (a random pool map) or ``generated`` (a random stored generated map)."""
    random_generated: bool = False
    """The older spelling of ``map_source: "generated"`` (#771)."""


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
    maker: MapMaker | None = getattr(request.app.state, "mapmaker", None)
    entry = choose_map(
        catalog,
        body.map_id,
        random_generated=body.random_generated,
        source=body.map_source,
        default="new",
    )
    if lifecycle.active_of(player.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="you already have an active match")
    record = lifecycle.open_record()
    pending = None
    try:
        if entry is None:  # a new map (#884): the answer waits for it
            # Claimed meanwhile (a second request is 409) and checked: no map for a full server.
            lifecycle.claim(record, (player.id,))
            if lifecycle.manager.draining:
                raise ManagerDrainingError("the server is draining for a deploy")
            lifecycle.manager.check_capacity(True)
            pending = maker.request() if maker is not None else None
            if pending is not None and maker is not None:
                entry = await maker.settle(pending)
            if entry is None:  # off, full, failed or too slow: a pool map
                entry = choose_map(catalog, None)
            assert entry is not None
        slot = secrets.randbelow(len(PLAYERS))
        bot_slot = 1 - slot
        # the runner makes the bot from ``Match.rules``: the periods the match plays (#803, #994)
        seat = BotSeat(bot_slot, bot_factory(LEVEL_BOTS[body.level]), secrets.randbits(SEED_BITS))
        accounts = [BOT_ACCOUNT, BOT_ACCOUNT]
        accounts[slot] = player.id
        runner = await lifecycle.start(
            record,
            entry.id,
            entry.definition,
            rules,
            (accounts[0], accounts[1]),
            private=True,
            bot=seat,
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
            if pending is not None and maker is not None:
                maker.discard(pending)
    response.headers["Cache-Control"] = "no-store"
    return BotMatchOut(match_id=runner.match_id, map_id=entry.id, level=body.level, player=slot)
