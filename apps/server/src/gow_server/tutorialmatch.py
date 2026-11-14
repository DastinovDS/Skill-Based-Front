"""Starting a tutorial chapter (#806, ``docs/design/tutorial.md``, section 7.6).

``POST /api/tutorial-matches {chapter}`` starts a chapter: player 0 is the account, player 1 the
``ScriptedBot`` of the chapter (``gow_bots.bots.scripted``), on the main ruleset with only
``cp.start`` replaced (``cp_start``), walked by a ``TutorialDirector`` (``gow_server.tutorial``).
It goes through ``MatchLifecycle`` like a bot match: one active match per account (409), the caps
on running matches and bot matches (503), the connect timeout. The row is ``matches.kind =
tutorial``: unrated, never in a profile, a record or a count; no replay is kept (a chapter is
scripted, the headless tests are its record). The first match after the tutorial is an ordinary
bot match (``POST /api/bot-matches``).

``GET /api/ruleset`` is the public part of the main ruleset, for the rules reference (no map
tempo: the reference says bigger maps are faster). Public and cacheable.

``GET`` and ``PUT /api/me/tutorial`` are the tutorial progress of the account
(``gow_server.tutorialprogress``, section 7.8): the chapters done are recorded by the server when
a chapter reaches its goal, the interface flags come from the client.
"""

import logging
from typing import Final

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict

from gow_bots.bots.scripted import ScriptedBot
from gow_protocol.ruleset import RulesetPublic
from gow_protocol.tutorial import Chapter, ChapterId
from gow_server.abuse import Limits, enforce, server_full
from gow_server.db import DbSession
from gow_server.identity import CurrentPlayer
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle, MatchState
from gow_server.maps import MapCatalog
from gow_server.matches import BOT_ACCOUNT, BotSeat, ManagerDrainingError, ServerFullError
from gow_server.tutorial import (
    OPPONENT,
    PLAYER,
    ChapterBook,
    TutorialDirector,
    chapter_rules,
    script_of,
)
from gow_server.tutorialprogress import TutorialFlags, TutorialProgress, read, write_flags
from gow_sim.maps import MapDef
from gow_sim.match import given
from gow_sim.ruleset import Ruleset

log = logging.getLogger("gow_server.tutorialmatch")

SCRIPT_BOT: Final = "tutorial"
"""``match_players.bot`` of the scripted side."""


def opponent_seat(chapter: Chapter, mapdef: MapDef) -> BotSeat:
    """The seat of the scripted opponent: called every tick (a ``Glancer``, cheap), so its
    steps apply at the ticks the document records (``gow_bots.bots.scripted``)."""
    bot = ScriptedBot(script_of(chapter, mapdef))
    return BotSeat(OPPONENT, given(bot), seed=0, decide_every=1)


router = APIRouter(prefix="/api/tutorial-matches", tags=["tutorial"])
ruleset_router = APIRouter(prefix="/api/ruleset", tags=["ruleset"])
progress_router = APIRouter(prefix="/api/me/tutorial", tags=["tutorial"])


class CreateTutorialMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter: ChapterId


class TutorialMatchOut(BaseModel):
    match_id: str
    """Connect to ``/ws/match/{match_id}``."""
    map_id: str
    chapter: ChapterId
    player: int
    """Your side (slot): always 0, the map's own side."""


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tutorial_match(
    body: CreateTutorialMatch, request: Request, response: Response, player: CurrentPlayer
) -> TutorialMatchOut:
    """Start a chapter (``docs/design/tutorial.md``, section 7.6)."""
    lifecycle: MatchLifecycle = request.app.state.lifecycle
    catalog: MapCatalog = request.app.state.maps
    book: ChapterBook = request.app.state.tutorial
    limits: Limits = request.app.state.limits
    enforce(limits.match_create, str(player.id), "too many matches created")
    chapter = book.get(body.chapter)
    entry = None if chapter is None else catalog.get(chapter.map)
    if chapter is None or entry is None:  # loaded and checked at start-up: never
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no such chapter")
    if lifecycle.active_of(player.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="you already have an active match")
    rules = chapter_rules(request.app.state.ruleset, chapter)
    record = lifecycle.open_record()
    try:
        runner = await lifecycle.start(
            record,
            entry.id,
            entry.definition,
            rules,
            (player.id, BOT_ACCOUNT),
            private=False,
            bot=opponent_seat(chapter, entry.definition),
            bot_name=SCRIPT_BOT,
            tutorial=TutorialDirector(chapter, entry.definition),
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
    log.info("tutorial started", extra={"match_id": runner.match_id, "chapter": chapter.id})
    return TutorialMatchOut(
        match_id=runner.match_id, map_id=entry.id, chapter=chapter.id, player=PLAYER
    )


@ruleset_router.get("")
async def get_ruleset(request: Request, response: Response) -> RulesetPublic:
    """The public numbers of the main ruleset, without map tempo (the rules reference, #806)."""
    rules: Ruleset = request.app.state.ruleset
    response.headers["Cache-Control"] = "public, max-age=300"
    return RulesetPublic.from_ruleset(rules)


@progress_router.get("")
def get_progress(response: Response, player: CurrentPlayer) -> TutorialProgress:
    """The tutorial progress of the account (a guest has its own)."""
    response.headers["Cache-Control"] = "no-store"
    return read(player)


@progress_router.put("")
def put_progress(
    body: TutorialFlags, response: Response, player: CurrentPlayer, session: DbSession
) -> TutorialProgress:
    """Replace the interface flags; the chapters done stay the server's."""
    response.headers["Cache-Control"] = "no-store"
    return write_flags(session, player, body)
