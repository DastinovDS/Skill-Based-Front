"""The tutorial progress of an account (#806, ``docs/design/tutorial.md``, section 7.8).

The progress belongs to the player, a guest included, and lives in ``players.tutorial`` (one JSON
document, ``NULL``: nothing done yet). Two writers, so a client cannot claim a chapter:

- ``mark_done``: the server, when a chapter match reaches its goal (``MatchLifecycle.on_end``);
- ``PUT /api/me/tutorial`` (``gow_server.tutorialmatch``): the flags of the interface only
  (``TutorialFlags``).

Plain functions over a session, no I/O of their own: callable from a thread.
"""

from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError
from sqlalchemy.orm import Session

from gow_protocol.tutorial import CHAPTER_IDS, ChapterId
from gow_server.models import Player

type HintId = Literal["H1", "H2", "H3", "H4", "H5"]
HINT_IDS: Final[tuple[HintId, ...]] = ("H1", "H2", "H3", "H4", "H5")
"""The hints of the first match (section 5)."""

MATCH_ID: Final = r"^[0-9]{1,18}$"
"""A match id on the wire: the decimal row id."""


class TutorialProgress(BaseModel):
    """The whole progress, as stored and as ``GET /api/me/tutorial`` answers."""

    model_config = ConfigDict(extra="forbid")

    done: list[ChapterId] = Field(default_factory=list[ChapterId])
    """The chapters whose goal was reached at least once, in the order of the chapter select."""
    offer_off: bool = False
    """"Don't show again" was ticked on the entry popup."""
    first_match: bool = False
    """The first match was played: the tutorial counts as finished."""
    first_match_id: str | None = None
    """The first match while it runs (a reload returns to it with its hints)."""
    hints: list[HintId] = Field(default_factory=list[HintId])
    """The hints of the first match already shown (``HINT_IDS``)."""
    hints_off: bool = False


class TutorialFlags(BaseModel):
    """What a client may write: the flags of the interface. Replaces them as a whole."""

    model_config = ConfigDict(extra="forbid")

    offer_off: StrictBool
    first_match: StrictBool
    first_match_id: str | None = Field(default=None, pattern=MATCH_ID)
    hints: list[HintId] = Field(max_length=len(HINT_IDS))
    hints_off: StrictBool


def _ordered(done: set[ChapterId]) -> list[ChapterId]:
    return [c for c in CHAPTER_IDS if c in done]


def _known_hints(hints: list[HintId]) -> list[HintId]:
    return [h for h in HINT_IDS if h in hints]


def read(player: Player) -> TutorialProgress:
    """The progress of ``player``; a missing or unreadable document is the empty progress."""
    if player.tutorial is None:
        return TutorialProgress()
    try:
        return TutorialProgress.model_validate(player.tutorial)
    except ValidationError:  # a chapter that no longer exists: never block the player
        return TutorialProgress()


def _store(player: Player, progress: TutorialProgress) -> None:
    player.tutorial = progress.model_dump(mode="json")


def write_flags(session: Session, player: Player, flags: TutorialFlags) -> TutorialProgress:
    """Replace the flags; the chapters done stay as they are. Commits."""
    current = read(player)
    progress = TutorialProgress(
        done=current.done,
        offer_off=flags.offer_off,
        first_match=flags.first_match,
        first_match_id=flags.first_match_id,
        hints=_known_hints(flags.hints),
        hints_off=flags.hints_off,
    )
    _store(player, progress)
    session.commit()
    return progress


def mark_done(session: Session, player_id: int, chapter: ChapterId) -> None:
    """The goal of ``chapter`` was reached by ``player_id``. Commits."""
    player = session.get(Player, player_id)
    if player is None:
        return
    current = read(player)
    if chapter in current.done:
        return
    current.done = _ordered({*current.done, chapter})
    _store(player, current)
    session.commit()
