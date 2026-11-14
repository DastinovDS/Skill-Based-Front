"""The chapter files of the tutorial (#806, ``docs/design/tutorial.md``, section 7.3).

One file per chapter, ``tutorial/chapters/<id>.json``: the map, the starting CP, the HUD shown at
the start, the scripted opponent, the beats (each with its trigger, pause, allowed commands, HUD
pieces and marks) and the goal. These models are the only source of truth of the format
(AGENTS.md, section 6): the server reads the files (``gow_server.tutorial``), the client imports
them at build time and gets their TypeScript types from the protocol schema.

Places are named by their node names, not ids: a file reads the way the chapter is written, and
``check_chapter`` checks every name against the map. The texts are not here: the card of beat
``<beat>`` of chapter ``<id>`` is the key ``tutorial.<id>.<beat>`` of the client dictionaries.

Unlike the wire messages, a field with a default may be left out of a file, so the TypeScript
types mark such fields optional (``TutorialModel``).
"""

import json
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Annotated, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from gow_protocol.base import MapId, NonNegInt, PosInt
from gow_protocol.mapfile import NodeName
from gow_sim.maps import MapDef
from gow_sim.ruleset import Stance

CHAPTER_IDS: Final = (
    "units",
    "economy",
    "building",
    "attack",
    "defence",
    "group-orders",
    "rally-points",
    "supply-distribution",
)
"""The chapters in the order of the chapter select: the main road I to V, then Advanced I to III."""

type ChapterId = Literal[
    "units",
    "economy",
    "building",
    "attack",
    "defence",
    "group-orders",
    "rally-points",
    "supply-distribution",
]

BeatId = Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{1,8}$")]
"""``1`` .. ``9`` for the beats of a chapter, ``F`` for its failure (IV.F), ``<n>W`` for the focus
phase after beat ``<n>`` (review 4, P5)."""

type UiFlag = Literal[
    "terrainMode",
    "cp",
    "notices",
    "supply",
    "warehouse",
    "buildings",
    "factories",
    "recruit",
    "stance",
    "planned",
    "vp",
    "clock",
    "terrainMarks",
    "alerts",
    "fort",
    "groupSelect",
    "rally",
]
"""A HUD or map piece a beat shows (``docs/design/tutorial.md``, section 4.9)."""

type Side = Literal["you", "enemy"]
"""The player of the chapter (player 0) or the scripted opponent (player 1)."""

TUTORIAL_CONFIG: Final = ConfigDict(
    extra="forbid",
    strict=True,
    frozen=True,
    populate_by_name=True,
    use_attribute_docstrings=True,
)


class TutorialModel(BaseModel):
    """Base of the chapter file models: like ``WireModel`` (unknown fields are errors, no
    coercion), but a field with a default may be absent from a file."""

    model_config = TUTORIAL_CONFIG


def _one_of(model: BaseModel, fields: Iterable[str], what: str) -> None:
    given = [name for name in fields if getattr(model, name) is not None]
    if len(given) != 1:
        raise ValueError(f"{what}: exactly one of {sorted(fields)}, got {given or 'none'}")


# Command patterns -----------------------------------------------------------------------------


class MovePattern(TutorialModel):
    from_: NodeName | None = Field(default=None, alias="from")
    """The node the group stands in; ``None``: any."""
    to: NodeName | None = None
    planned: bool | None = None
    """``True`` a planned order only, ``False`` an ordinary one only, ``None`` either."""


class GroupPattern(TutorialModel):
    from_: NodeName | None = Field(default=None, alias="from")
    """The node the group stands in; ``None``: any own group."""


class NodePattern(TutorialModel):
    node: NodeName | None = None


class StancePattern(TutorialModel):
    stance: Stance | None = None


class RoadPattern(TutorialModel):
    node: NodeName | None = None
    toward: NodeName | None = None
    """The other end of the fortified road."""


class GroupMovePattern(TutorialModel):
    groups: tuple[NodeName, ...] | None = None
    """The nodes the groups stand in, one per group, in any order."""
    to: NodeName | None = None
    planned: bool | None = None


class RallyPattern(TutorialModel):
    node: NodeName | None = None
    to: NodeName | None = None
    """The rally point; ``None``: any."""


_COMMANDS: Final = (
    "move",
    "cancel_order",
    "build_factory",
    "build_barracks",
    "recruit",
    "set_stance",
    "fortify_road",
    "group_move",
    "set_rally_point",
)


class CommandPattern(TutorialModel):
    """One kind of command by its wire ``type`` and its places; an absent field matches any."""

    move: MovePattern | None = None
    cancel_order: GroupPattern | None = None
    build_factory: NodePattern | None = None
    build_barracks: NodePattern | None = None
    recruit: NodePattern | None = None
    set_stance: StancePattern | None = None
    fortify_road: RoadPattern | None = None
    group_move: GroupMovePattern | None = None
    set_rally_point: RallyPattern | None = None

    @model_validator(mode="after")
    def _one_command(self) -> Self:
        _one_of(self, _COMMANDS, "a command pattern")
        return self

    @property
    def command(self) -> str:
        """The wire ``type`` of the command."""
        return next(name for name in _COMMANDS if getattr(self, name) is not None)


class Allow(CommandPattern):
    """A command a beat allows; ``max`` bounds how often it is accepted while the beat (or a
    beat that keeps its ``allow``) lasts. Leaving (``forfeit``) is always allowed."""

    max: PosInt | None = None


# Triggers -------------------------------------------------------------------------------------


class ViewFact(TutorialModel):
    """A fact of the player's own view (``PlayerView``), compared, never computed."""

    own: NodeName | None = None
    """The node is the player's."""
    starving: NodeName | None = None
    """The own node has ``starve_in`` set (cut off from the capital, DEC-43 item H)."""
    warehouse_full: NodeName | None = None
    """The own node's ``warehouse`` equals its ``warehouse_cap``."""
    group_full: NodeName | None = None
    """The node is the player's and an own group stands in it with every unit charged (not
    one that only arrived to attack it)."""
    enemy_road: NodeName | None = None
    """An enemy group is seen on a road that touches the node."""
    enemy_plan: NodeName | None = None
    """An enemy planned intent targets the node."""

    @model_validator(mode="after")
    def _one_fact(self) -> Self:
        _one_of(
            self,
            ("own", "starving", "warehouse_full", "group_full", "enemy_road", "enemy_plan"),
            "a view fact",
        )
        return self


_TRIGGERS: Final = ("start", "event", "accepted", "view", "continued", "ui", "any")
_EVENT_FILTERS: Final = (
    "node",
    "to",
    "edge",
    "by",
    "winner",
    "where",
    "min",
    "group_of",
)


class Trigger(TutorialModel):
    """When a beat begins, or a condition of the goal (section 7.3, ``on``).

    Exactly one kind: ``start`` (the chapter start), ``event`` (an event the player receives,
    with filters), ``accepted`` (an own command the server accepted, by its pattern; the places
    are those at the moment it was sent), ``view`` (a fact of the own view), ``continued``
    (Continue on that beat), ``ui`` (client only: a selection) or ``any`` (the first of several
    that fires).

    ``after`` (a beat's trigger, not ``start``, ``ui``, an inner trigger of ``any`` or a goal
    condition): the beat begins that many ticks after its trigger fired, so the map has drawn
    what the card names (a capture's flood, the shots of a round) before the card shows (review
    4, P1).
    """

    start: Literal[True] | None = None
    event: str | None = None
    """An event kind of ``gow_protocol.convert.EVENT_FIELDS``."""
    node: NodeName | None = None
    """The event's ``node``."""
    to: NodeName | None = None
    """The event's ``to_node`` (``packet_sent``)."""
    edge: tuple[NodeName, NodeName] | None = None
    """The event's ``edge``, by its two ends in any order."""
    by: Side | None = None
    """The event's ``player`` (``owner`` for ``warehouse_lost``)."""
    winner: Side | None = None
    """The event's ``winner`` (``fight_ended``)."""
    where: dict[str, bool | int | str] | None = None
    """Other fields of the event, equal to these values."""
    min: dict[str, int] | None = None
    """Integer fields of the event, at least these values."""
    group_of: str | None = None
    """The event's ``group`` was the ``group`` of an earlier event of this kind (both own)."""
    accepted: CommandPattern | None = None
    view: ViewFact | None = None
    continued: BeatId | None = None
    after: NonNegInt = 0
    """Ticks from the trigger to the beginning of the beat (with ``continued``: after the
    Continue)."""
    ui: Literal["select"] | None = None
    group: NodeName | None = None
    """With ``ui``: the own group standing in this node; ``None``: any own group."""
    any: tuple["Trigger", ...] | None = None
    since: BeatId | None = None
    """A goal condition only: the event counts from this beat on."""
    count: PosInt = 1
    """A goal condition only: so many such events."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        from gow_protocol.convert import EVENT_FIELDS

        _one_of(self, _TRIGGERS, "a trigger")
        if self.event is None:
            used = [name for name in _EVENT_FILTERS if getattr(self, name) is not None]
            if used:
                raise ValueError(f"event filters without an event: {used}")
        elif self.event not in EVENT_FIELDS:
            raise ValueError(f"unknown event kind {self.event!r}")
        if self.after and (self.start is not None or self.ui is not None):
            raise ValueError("after goes with a trigger the server fires")
        for inner in self.any or ():
            if inner.after:
                raise ValueError("after goes on the outer trigger of any")
        if self.group is not None and self.ui is None:
            raise ValueError("group goes with ui")
        if self.any is not None and not self.any:
            raise ValueError("any lists at least one trigger")
        return self


# Marks and beats ------------------------------------------------------------------------------

type HudPiece = Literal["cp", "stance", "vp", "clock", "alerts", "factories"]
type MenuItem = Literal["factory", "barracks", "recruit", "fortify", "rally"]


_MARKS: Final = (
    "node",
    "group",
    "road",
    "hud",
    "menu",
    "vp_badge",
    "capacity",
    "warehouse",
    "count",
)


class Mark(TutorialModel):
    """The goal mark (Compass) of a beat: a place, an own group, a road, a HUD piece, a menu item
    of a node or the VP badge of a city; or the element of a place the card names, lit itself
    (review 4, P3): its capacity ring, its warehouse row, the count under its group."""

    node: NodeName | None = None
    ring: bool = False
    """With ``node``: the wide ring around the place (capacity, a fight)."""
    group: NodeName | None = None
    """The own group standing in this node."""
    road: tuple[NodeName, NodeName] | None = None
    hud: HudPiece | None = None
    menu: MenuItem | None = None
    at: NodeName | None = None
    """With ``menu``: the node whose menu holds the item."""
    vp_badge: NodeName | None = None
    capacity: NodeName | None = None
    """The segments of the place's capacity ring."""
    warehouse: NodeName | None = None
    """The row of lozenges under the place (its warehouse)."""
    count: NodeName | None = None
    """The number or range under the group in the place (an enemy's ``1-2``)."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        _one_of(self, _MARKS, "a mark")
        if (self.menu is None) != (self.at is None):
            raise ValueError("menu and at go together")
        if self.ring and self.node is None:
            raise ValueError("ring goes with node")
        return self


class Turn(TutorialModel):
    """One group of places the marks in turn ring (I.7), with the word of the card it lights."""

    word: Annotated[str, StringConstraints(pattern=r"^[a-z]{1,24}$")]
    nodes: Annotated[tuple[NodeName, ...], Field(min_length=1)]


type Pause = Literal["continue", "action"]


class Beat(TutorialModel):
    """One hint card (section 4.0): it shows when its trigger fires (``on.after`` ticks later)
    and stays until the next, or until the player did what it asks (review 4, P2). A ``focus``
    beat has no card: for that many ticks the game runs with no text and its marks light the
    places to watch (P5)."""

    id: BeatId
    on: Trigger
    pause: Pause | None = None
    """``continue``: the simulation waits for Continue; ``action``: for the first accepted
    command of ``allow``; ``None``: it runs."""
    allow: tuple[Allow, ...] | None = None
    """The commands the beat allows; ``None``: the ``allow`` of the beat before it (its counts
    too); ``()``: none."""
    ui: tuple[UiFlag, ...] = ()
    """HUD pieces the beat shows from now on."""
    hide: tuple[UiFlag, ...] = ()
    """HUD pieces the beat hides again (IV.9 hides the clock IV.8 showed)."""
    mark: tuple[Mark, ...] = ()
    turns: tuple[Turn, ...] = ()
    """Client only: the marks in turn (I.7)."""
    slides: Annotated[int, Field(ge=1, le=3)] = 1
    """Client only: the slides of the card (IV.2: 3), keys ``tutorial.<id>.<beat>.<n>``."""
    with_goal: bool = False
    """The beat fires with the goal (A1.5): the client keeps its card, with Continue, before the
    result."""
    optional: bool = False
    """The beat after it may begin first, and this one is then passed over (IV.5: the enemy plan
    is seen only on the planned path; on the failure path it is over before the plan)."""
    focus: PosInt | None = None
    """A focus phase (review 4, P5): no card and no text for this many ticks, the game runs and
    the marks light what makes or carries charges; the beat after it begins when its trigger has
    fired and the focus is over."""
    acts: PosInt = 1
    """Client only: the commands of ``allow`` the card asks for; once that many stand (a cancel
    takes one back), the card goes until the next beat (review 4, P2; A2.2: two recruits)."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.on.ui is not None and (self.pause is not None or self.allow is not None):
            raise ValueError(f"beat {self.id}: a UI beat neither pauses nor sets allow")
        if self.focus is not None:
            card = (
                self.pause is not None
                or self.allow is not None
                or self.on.ui is not None
                or self.turns
                or self.slides != 1
                or self.with_goal
                or self.optional
                or self.acts != 1
            )
            if card:
                raise ValueError(f"beat {self.id}: a focus beat is no card (no pause, allow, ...)")
        if self.on.since is not None or self.on.count != 1:
            raise ValueError(f"beat {self.id}: since and count are for the goal")
        return self

    @property
    def client_only(self) -> bool:
        """A beat the server never sees fire (a selection)."""
        return self.on.ui is not None

    @property
    def card(self) -> bool:
        """The beat shows a card (a focus beat does not): it has a text and a step lozenge."""
        return self.focus is None


# Opponent and goal ----------------------------------------------------------------------------


class OpponentWhen(TutorialModel):
    owns: NodeName
    """The opponent owns this node."""


class OpponentMove(TutorialModel):
    from_: NodeName = Field(alias="from")
    """The node the opponent's group stands in."""
    to: NodeName
    planned: bool = False
    bonus: NonNegInt = 0


class OpponentStep(TutorialModel):
    """One command of the scripted opponent (section 7.4), given once: at a tick (``at``: it
    applies at that tick) or when a fact of its own view holds (``when``). A step whose group is
    gone is skipped."""

    at: PosInt | None = None
    when: OpponentWhen | None = None
    move: OpponentMove

    @model_validator(mode="after")
    def _check(self) -> Self:
        _one_of(self, ("at", "when"), "an opponent step")
        if self.move.planned != (self.move.bonus > 0):
            raise ValueError("a planned move asks for a bonus, an ordinary one does not")
        return self


class Goal(TutorialModel):
    """The chapter is done when all conditions hold at once: an event condition holds once its
    event came (``since`` a beat, ``count`` times), a view condition while it is true."""

    all: Annotated[tuple[Trigger, ...], Field(min_length=1)]

    @model_validator(mode="after")
    def _check(self) -> Self:
        for cond in self.all:
            if cond.event is None and cond.view is None:
                raise ValueError("a goal condition is an event or a view fact")
            if cond.after:
                raise ValueError("a goal condition has no after")
        return self


class Chapter(TutorialModel):
    """A chapter file (``tutorial/chapters/<id>.json``)."""

    id: ChapterId
    road: Literal["main", "advanced"]
    number: Annotated[int, Field(ge=1, le=5)]
    """I to V on the main road, I to III on the Advanced one."""
    map: MapId
    """A map of ``maps/tutorial/``."""
    cp_start: Literal["cap"] | NonNegInt | None = None
    """The starting CP of the chapter: ``cap`` or hundredths up to ``cp.cap``; ``None``: the
    ruleset's ``cp.start``. The only ruleset value a chapter replaces (section 7.3)."""
    ui: tuple[UiFlag, ...] = ()
    """The pieces shown at the start: those of the chapters before it (``check_chapters``)."""
    opponent: tuple[OpponentStep, ...] = ()
    beats: Annotated[tuple[Beat, ...], Field(min_length=1)]
    fails: tuple[Beat, ...] = ()
    """Failure beats (IV.F): checked at every step, each fires once; the beats go on after it."""
    goal: Goal

    @model_validator(mode="after")
    def _check(self) -> Self:
        ids = [b.id for b in (*self.beats, *self.fails)]
        if len(set(ids)) != len(ids):
            raise ValueError(f"beat ids repeat: {ids}")
        if self.beats[0].allow is None and not self.beats[0].client_only:
            raise ValueError("the first beat sets allow")
        if self.beats[0].client_only or not self.beats[0].card:
            raise ValueError("the first beat is a card, not a UI or focus beat")
        for beat in self.fails:
            if beat.allow is None or beat.client_only or not beat.card:
                raise ValueError(f"failure beat {beat.id}: sets allow, not a UI or focus beat")
        known = set(ids)
        for trigger in _triggers(self):
            if trigger.continued is not None and trigger.continued not in known:
                raise ValueError(f"continued names no beat: {trigger.continued}")
            if trigger.since is not None and trigger.since not in known:
                raise ValueError(f"since names no beat: {trigger.since}")
        return self

    def ui_after(self) -> tuple[UiFlag, ...]:
        """The pieces shown at the end of the chapter: the next chapter starts with them."""
        shown: list[UiFlag] = list(self.ui)
        for beat in self.beats:
            shown.extend(flag for flag in beat.ui if flag not in shown)
            shown = [flag for flag in shown if flag not in beat.hide]
        return tuple(shown)


def _triggers(chapter: Chapter) -> list[Trigger]:
    out: list[Trigger] = []

    def walk(trigger: Trigger) -> None:
        out.append(trigger)
        for inner in trigger.any or ():
            walk(inner)

    for beat in (*chapter.beats, *chapter.fails):
        walk(beat.on)
    for cond in chapter.goal.all:
        walk(cond)
    return out


# Loading and checks ---------------------------------------------------------------------------


class ChapterError(ValueError):
    """A chapter file that does not fit its map or the chapters before it."""


def load_chapter(path: str | Path) -> Chapter:
    """Read and validate one chapter file (a ``ValidationError`` names the offending field)."""
    return Chapter.model_validate_json(Path(path).read_bytes())


def _names(chapter: Chapter) -> list[str]:
    names: list[str] = []

    def pattern(p: CommandPattern) -> None:
        for model in (
            p.move,
            p.cancel_order,
            p.build_factory,
            p.build_barracks,
            p.recruit,
            p.fortify_road,
            p.group_move,
            p.set_rally_point,
        ):
            if model is None:
                continue
            for value in model.model_dump().values():
                if isinstance(value, str) and not isinstance(value, Stance):
                    names.append(value)
                elif isinstance(value, tuple | list):
                    items: list[object] = list(value)  # pyright: ignore[reportUnknownArgumentType]
                    names.extend(v for v in items if isinstance(v, str))

    for trigger in _triggers(chapter):
        names += [n for n in (trigger.node, trigger.to, trigger.group) if n is not None]
        names += list(trigger.edge or ())
        if trigger.view is not None:
            names += [v for v in trigger.view.model_dump().values() if v is not None]
        if trigger.accepted is not None:
            pattern(trigger.accepted)
    for beat in (*chapter.beats, *chapter.fails):
        for allow in beat.allow or ():
            pattern(allow)
        for mark in beat.mark:
            names += [
                n
                for n in (
                    mark.node,
                    mark.group,
                    mark.at,
                    mark.vp_badge,
                    mark.capacity,
                    mark.warehouse,
                    mark.count,
                )
                if n is not None
            ]
            names += list(mark.road or ())
        for turn in beat.turns:
            names += list(turn.nodes)
    for step in chapter.opponent:
        names += [step.move.from_, step.move.to]
        if step.when is not None:
            names.append(step.when.owns)
    return names


def check_chapter(chapter: Chapter, mapdef: MapDef, cp_cap: int) -> None:
    """Every place name of ``chapter`` is a node of ``mapdef`` (its map), every road a road of
    it, and ``cp_start`` is at most ``cp_cap``. Raises ``ChapterError``."""
    if mapdef.meta.name != chapter.map:
        raise ChapterError(f"{chapter.id}: map {mapdef.meta.name}, the file names {chapter.map}")
    known = {node.name for node in mapdef.nodes}
    unknown = sorted({name for name in _names(chapter) if name not in known})
    if unknown:
        raise ChapterError(f"{chapter.id}: no such places on {chapter.map}: {unknown}")
    ids = {node.name: node.id for node in mapdef.nodes}
    roads = {frozenset((e.a, e.b)) for e in mapdef.edges}
    pairs = (
        [pair for trigger in _triggers(chapter) if (pair := trigger.edge) is not None]
        + [
            mark.road
            for beat in (*chapter.beats, *chapter.fails)
            for mark in beat.mark
            if mark.road is not None
        ]
        + [
            (a.fortify_road.node, a.fortify_road.toward)
            for beat in (*chapter.beats, *chapter.fails)
            for a in beat.allow or ()
            if a.fortify_road is not None
            and a.fortify_road.node is not None
            and a.fortify_road.toward is not None
        ]
    )
    for a, b in pairs:
        if frozenset((ids[a], ids[b])) not in roads:
            raise ChapterError(f"{chapter.id}: no road {a} - {b} on {chapter.map}")
    if isinstance(chapter.cp_start, int) and chapter.cp_start > cp_cap:
        raise ChapterError(f"{chapter.id}: cp_start {chapter.cp_start} is over the cap {cp_cap}")


def check_chapters(chapters: Sequence[Chapter]) -> None:
    """The set of chapters is whole and in order, and each starts with the HUD the chapters before
    it leave (section 7.3): a main chapter with that of the main chapters before it, an Advanced
    one with that of the whole main road. Raises ``ChapterError``."""
    if tuple(c.id for c in chapters) != CHAPTER_IDS:
        raise ChapterError(f"chapters {[c.id for c in chapters]}, expected {list(CHAPTER_IDS)}")
    shown: tuple[UiFlag, ...] = ()
    main_end: tuple[UiFlag, ...] = ()
    for chapter in chapters:
        expected = shown if chapter.road == "main" else main_end
        if set(chapter.ui) != set(expected) or len(chapter.ui) != len(set(chapter.ui)):
            raise ChapterError(f"{chapter.id}: ui {list(chapter.ui)}, expected {list(expected)}")
        if chapter.road == "main":
            shown = chapter.ui_after()
            main_end = shown


def chapter_paths(directory: Path) -> list[Path]:
    """The chapter files of ``directory`` in the order of ``CHAPTER_IDS``."""
    return [directory / f"{chapter_id}.json" for chapter_id in CHAPTER_IDS]


def dump_chapter(chapter: Chapter) -> str:
    """The file form of a chapter (defaults left out), for tools and tests."""
    data = chapter.model_dump(mode="json", by_alias=True, exclude_defaults=True)
    return json.dumps(data, indent=2) + "\n"
