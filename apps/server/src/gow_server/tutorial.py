"""Tutorial chapters on the server (#806, ``docs/design/tutorial.md``, sections 7.4 and 7.5).

``ChapterBook`` loads the chapter files (``tutorial/chapters/<id>.json``, ``gow_protocol.tutorial``)
at start-up and checks them against their maps (``maps/tutorial/``) and the ruleset: a broken
chapter stops the server, like a broken map.

``TutorialDirector`` walks the beats of one chapter match. Plain Python without I/O, fed by the
runner (``gow_server.matches.MatchRunner``) with what the player receives anyway: the events of
``events_msgs`` (fog applied), the results of the player's own commands and the player's
``PlayerView``. It compares fields with the file and never works out a rule (AGENTS.md, 7.1):

- **Triggers.** After a step the next beat whose trigger fires begins; the beats after the
  current one are tried in file order, a UI beat (a selection, the client's) is passed over, and
  an ``optional`` beat may be passed over by the beat after it (IV.5: the enemy plan that only
  the planned path sees). A beat that does not pause lets the next one fire in the same tick; a
  Continue tries the next beats on the same tick again (two lessons of one tick, IV.7 and IV.8
  on the failure path). A failure beat (``fails``) fires once, from any beat, and the beats go
  on after it.
- **Locks.** ``admit`` matches a command of the player against the ``allow`` of the current
  beat on the state when it is sent (the node a group stands in): a command no entry allows, or
  one past its ``max``, is refused (the runner answers ``INVALID_ARGUMENT`` and the simulation
  never sees it). ``Forfeit`` (leaving) is always allowed; the scripted side is never locked.
- **Pauses.** A beat with ``pause`` stops the simulation at the end of the tick it began:
  ``continue`` until ``continue_`` (the client's ``resume``), ``action`` until a command its
  ``allow`` admits (applied at the next tick; refused by the simulation, the pause comes back).
- **Goal.** When every condition holds the director is ``done``: the runner queues the
  ``Forfeit`` of the scripted side and the match ends with ``match_end`` (the player wins,
  ``reason = forfeit``; chapter IV ends by itself, ``reason = capital``).

The endpoint that starts a chapter is ``gow_server.tutorialmatch``.
"""

import dataclasses
import logging
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from gow_bots.bots.scripted import ScriptStep
from gow_protocol.messages import EventMsg, TutorialMsg
from gow_protocol.tutorial import (
    Allow,
    Beat,
    Chapter,
    ChapterError,
    CommandPattern,
    Side,
    Trigger,
    ViewFact,
    chapter_paths,
    check_chapter,
    check_chapters,
    load_chapter,
)
from gow_server.maps import MapCatalog
from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    CancelOrder,
    Command,
    FortifyRoad,
    GroupMove,
    Move,
    Recruit,
    SetRallyPoint,
    SetStance,
)
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import AtNode, GameState, IntentKind
from gow_sim.view import PlayerView

log = logging.getLogger("gow_server.tutorial")

PLAYER: Final = 0
"""The player of a chapter (the map's ``capital_of`` 0); the scripted opponent is player 1."""

OPPONENT: Final = 1

# Chapters -------------------------------------------------------------------------------------


class ChapterBook:
    """The chapters of the tutorial by id, checked against their maps and the ruleset."""

    def __init__(self, chapters: Sequence[Chapter]) -> None:
        self._chapters: dict[str, Chapter] = {c.id: c for c in chapters}

    @classmethod
    def load(cls, directory: Path, catalog: MapCatalog, rules: Ruleset) -> "ChapterBook":
        """Load ``directory/<id>.json`` of every chapter; raise ``ChapterError`` (or a pydantic
        ``ValidationError``) for a broken one. A server without the tutorial maps (a test's map
        folder) has no chapters: ``POST /api/tutorial-matches`` answers 503."""
        if not any(entry.tutorial for entry in catalog.all()):
            log.warning("no tutorial maps: the tutorial is off")
            return cls(())
        chapters = [load_chapter(path) for path in chapter_paths(directory)]
        check_chapters(chapters)
        for chapter in chapters:
            entry = catalog.get(chapter.map)
            if entry is None or not entry.tutorial:
                raise ChapterError(f"{chapter.id}: no tutorial map {chapter.map}")
            check_chapter(chapter, entry.definition, rules.cp.cap)
        return cls(chapters)

    def get(self, chapter_id: str) -> Chapter | None:
        return self._chapters.get(chapter_id)

    def __iter__(self) -> Iterator[Chapter]:
        return iter(self._chapters.values())


def chapter_rules(rules: Ruleset, chapter: Chapter) -> Ruleset:
    """The main ruleset with the chapter's ``cp_start`` (the only value a chapter replaces)."""
    if chapter.cp_start is None:
        return rules
    start = rules.cp.cap if chapter.cp_start == "cap" else chapter.cp_start
    return dataclasses.replace(rules, cp=dataclasses.replace(rules.cp, start=start))


def script_of(chapter: Chapter, mapdef: MapDef) -> list[ScriptStep]:
    """The opponent steps of the chapter with node ids."""
    ids = {node.name: node.id for node in mapdef.nodes}
    return [
        ScriptStep(
            origin=ids[step.move.from_],
            dest=ids[step.move.to],
            at=step.at,
            owns=None if step.when is None else ids[step.when.owns],
            planned=step.move.planned,
            bonus=step.move.bonus,
        )
        for step in chapter.opponent
    ]


# Commands -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CommandFacts:
    """What the patterns of a chapter compare in a command, on the state when it was sent."""

    command: str
    """The wire ``type``."""
    origin: int | None = None
    """The node the own group stands in (``move``, ``cancel_order``); ``None``: none."""
    dest: int | None = None
    """``move`` and ``group_move``: the target; ``set_rally_point``: the rally point."""
    planned: bool = False
    node: int | None = None
    toward: int | None = None
    """``fortify_road``: the other end of the road."""
    groups: tuple[int, ...] = ()
    """``group_move``: the nodes of its groups, sorted; empty if one does not stand in a node."""
    stance: Stance | None = None


def _standing(state: GameState, player: int, gid: int) -> int | None:
    group = state.groups.get(gid)
    if group is None or group.owner != player or not isinstance(group.location, AtNode):
        return None
    return group.location.node


def facts_of(state: GameState, player: int, cmd: Command) -> CommandFacts | None:
    """The facts of a resolved command; ``None``: a command no chapter allows (split, merge,
    release a plan, cancel a recruit, the leaf shift)."""
    match cmd:
        case Move(group=gid, dest=dest, planned=planned):
            return CommandFacts(
                "move", origin=_standing(state, player, gid), dest=dest, planned=planned
            )
        case CancelOrder(group=gid):
            return CommandFacts("cancel_order", origin=_standing(state, player, gid))
        case BuildFactory(node=node):
            return CommandFacts("build_factory", node=node)
        case BuildBarracks(node=node):
            return CommandFacts("build_barracks", node=node)
        case Recruit(node=node):
            return CommandFacts("recruit", node=node)
        case SetStance(stance=stance):
            return CommandFacts("set_stance", stance=stance)
        case FortifyRoad(node=node, edge=edge):
            edges = state.map.edges
            toward = None
            if 0 <= edge < len(edges) and node in (edges[edge].a, edges[edge].b):
                toward = edges[edge].other(node)
            return CommandFacts("fortify_road", node=node, toward=toward)
        case GroupMove(groups=gids, dest=dest, planned=planned):
            nodes = [_standing(state, player, gid) for gid in gids]
            standing = tuple(sorted(n for n in nodes if n is not None))
            return CommandFacts(
                "group_move",
                dest=dest,
                planned=planned,
                groups=standing if len(standing) == len(nodes) else (),
            )
        case SetRallyPoint(node=node, target=target):
            return CommandFacts("set_rally_point", node=node, dest=target)
        case _:
            return None


def pattern_matches(pattern: CommandPattern, facts: CommandFacts, ids: dict[str, int]) -> bool:
    """``facts`` is a command of ``pattern``: its type, and every place the pattern names."""
    if pattern.command != facts.command:
        return False

    def same(name: str | None, value: int | None) -> bool:
        return name is None or ids[name] == value

    def kind(want: bool | None) -> bool:
        return want is None or want == facts.planned

    if (p := pattern.move) is not None:
        return same(p.from_, facts.origin) and same(p.to, facts.dest) and kind(p.planned)
    if (p := pattern.cancel_order) is not None:
        return same(p.from_, facts.origin)
    if (p := pattern.build_factory or pattern.build_barracks or pattern.recruit) is not None:
        return same(p.node, facts.node)
    if (p := pattern.set_stance) is not None:
        return p.stance is None or p.stance == facts.stance
    if (p := pattern.fortify_road) is not None:
        return same(p.node, facts.node) and same(p.toward, facts.toward)
    if (p := pattern.group_move) is not None:
        groups = p.groups is None or tuple(sorted(ids[n] for n in p.groups)) == facts.groups
        return groups and same(p.to, facts.dest) and kind(p.planned)
    if (p := pattern.set_rally_point) is not None:
        return same(p.node, facts.node) and same(p.to, facts.dest)
    return False


# The director ---------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Admission:
    """An admitted command: the ``allow`` entry it used, in the ``allow`` it was admitted by."""

    entry: int
    generation: int


@dataclass(slots=True)
class _Tick:
    """What a step gave the player: the facts the triggers read."""

    events: tuple[EventMsg, ...] = ()
    view: PlayerView | None = None
    accepted: list[CommandFacts] = field(default_factory=list[CommandFacts])


class TutorialDirector:
    """The beats of one chapter match (module docstring)."""

    def __init__(self, chapter: Chapter, mapdef: MapDef, player: int = PLAYER) -> None:
        self.chapter: Final = chapter
        self.player: Final = player
        self._ids: Final = {node.name: node.id for node in mapdef.nodes}
        self._edges: Final = {frozenset((e.a, e.b)): e.id for e in mapdef.edges}
        self._incident: Final = mapdef.incident
        self.tick = 0
        self._index: int | None = None
        """The current beat of ``chapter.beats``; ``None`` before the first one."""
        self._fail: Beat | None = None
        """The failure beat shown now, over the main beat (``_index`` stays)."""
        self._fired_fails: set[str] = set()
        self._entered: set[str] = set()
        self._continued: dict[str, int] = {}
        """Beat id -> the tick of its Continue."""
        self._allow: tuple[Allow, ...] = ()
        self._generation = 0
        """Bumped whenever ``_allow`` is replaced: an admission of an older one counts nowhere."""
        self._used: list[int] = []
        self._pending: list[int] = []
        self.paused = False
        self._pause_kind: str | None = None
        self._acted = False
        """The action beat got an accepted command of its ``allow``."""
        self._groups_by_kind: dict[str, set[str]] = {}
        """Event kind -> the own groups (wire ids) named by such events (``group_of``)."""
        self._goal_counts = [0] * len(chapter.goal.all)
        self.done = False
        self._now = _Tick()
        """The facts of the last step; a Continue tries the next beats on them again."""
        self._accepted: list[CommandFacts] = []
        """Own commands the coming step accepted (``settle``), for ``accepted`` triggers."""
        self._starting = True
        self._advance()
        self._starting = False

    # State -------------------------------------------------------------------------------

    @property
    def beat(self) -> Beat | None:
        if self._fail is not None:
            return self._fail
        return None if self._index is None else self.chapter.beats[self._index]

    def message(self) -> TutorialMsg:
        beat = self.beat
        return TutorialMsg(
            chapter=self.chapter.id,
            beat=None if beat is None else beat.id,
            paused=self.paused,
            used=tuple(self._used),
            done=self.done,
        )

    # Locks -------------------------------------------------------------------------------

    def admit(self, facts: CommandFacts) -> Admission | None:
        """The ``allow`` entry of the current beat ``facts`` uses, counted as pending; ``None``:
        refused. The first admitted command of an ``action`` beat ends its pause."""
        for i, entry in enumerate(self._allow):
            if not pattern_matches(entry, facts, self._ids):
                continue
            if entry.max is not None and self._used[i] + self._pending[i] >= entry.max:
                continue
            self._pending[i] += 1
            if self.paused and self._pause_kind == "action":
                self.paused = False
            return Admission(i, self._generation)
        return None

    def settle(self, admission: Admission, facts: CommandFacts, *, accepted: bool) -> None:
        """The simulation applied (``accepted``) or rejected an admitted command."""
        if accepted:
            self._accepted.append(facts)
        if admission.generation != self._generation:
            return
        self._pending[admission.entry] -= 1
        if accepted:
            self._used[admission.entry] += 1
            self._acted = True
        elif self._pause_kind == "action" and not self._acted and not any(self._pending):
            self.paused = True  # the asked command failed: wait for another

    # Steps -------------------------------------------------------------------------------

    def observe(self, tick: int, events: Sequence[EventMsg], view: PlayerView) -> None:
        """After the step of ``tick``: the triggers, the failures and the goal."""
        now = self._now = _Tick(tuple(events), view, self._accepted)
        self._accepted = []
        self.tick = tick
        for e in now.events:
            group = e.data.get("group")
            if isinstance(group, str) and e.data.get("player") == self.player:
                self._groups_by_kind.setdefault(e.kind, set()).add(group)
        for beat in self.chapter.fails:
            if beat.id not in self._fired_fails and self._fires(beat.on, now):
                self._fired_fails.add(beat.id)
                self._enter(beat, fail=True)
        if not self.paused:
            self._advance()
        self._count_goal_events(now)
        if not self.done and self._goal_holds(now):
            self.done = True

    def continue_(self) -> bool:
        """Continue on the card (the client's ``resume``); ``False``: the beat does not wait
        for it."""
        beat = self.beat
        if beat is None or not self.paused or self._pause_kind != "continue":
            return False
        self.paused = False
        self._continued[beat.id] = self.tick
        self._advance()
        return True

    def _advance(self) -> None:
        """Begin the next beats whose triggers fire now, until one pauses."""
        beats = self.chapter.beats
        while not self.paused:
            start = 0 if self._index is None else self._index + 1
            fired = None
            for j in range(start, len(beats)):
                beat = beats[j]
                if beat.client_only:
                    continue
                if self._fires(beat.on, self._now):
                    fired = j
                    break
                if not beat.optional:
                    break
            if fired is None:
                return
            self._index = fired
            self._fail = None
            self._enter(beats[fired], fail=False)

    def _enter(self, beat: Beat, *, fail: bool) -> None:
        if fail:
            self._fail = beat
        self._entered.add(beat.id)
        if beat.allow is not None:
            self._allow = beat.allow
            self._generation += 1
            self._used = [0] * len(beat.allow)
            self._pending = [0] * len(beat.allow)
        self._pause_kind = beat.pause
        self._acted = False
        self.paused = beat.pause is not None

    # Triggers ----------------------------------------------------------------------------

    def _fires(self, trigger: Trigger, now: _Tick) -> bool:
        if trigger.start is not None:
            return self._starting
        if trigger.any is not None:
            return any(self._fires(inner, now) for inner in trigger.any)
        if trigger.event is not None:
            return any(self._event_matches(trigger, e) for e in now.events)
        if trigger.accepted is not None:
            pattern = trigger.accepted
            return any(pattern_matches(pattern, f, self._ids) for f in now.accepted)
        if trigger.view is not None:
            return now.view is not None and self._view_holds(trigger.view, now.view)
        if trigger.continued is not None:
            at = self._continued.get(trigger.continued)
            return at is not None and self.tick >= at + trigger.after
        return False  # ``ui``: the client's

    def _side(self, side: Side) -> int:
        return self.player if side == "you" else 1 - self.player

    def _event_matches(self, trigger: Trigger, e: EventMsg) -> bool:
        if e.kind != trigger.event:
            return False
        data = e.data
        ids = self._ids
        if trigger.node is not None and data.get("node") != ids[trigger.node]:
            return False
        if trigger.to is not None and data.get("to_node") != ids[trigger.to]:
            return False
        if trigger.edge is not None:
            a, b = trigger.edge
            if data.get("edge") != self._edges.get(frozenset((ids[a], ids[b]))):
                return False
        if trigger.by is not None:
            who = data.get("player", data.get("owner"))
            if who != self._side(trigger.by):
                return False
        if trigger.winner is not None and data.get("winner") != self._side(trigger.winner):
            return False
        for key, want in (trigger.where or {}).items():
            got = data.get(key)
            if type(got) is not type(want) or got != want:
                return False
        for key, low in (trigger.min or {}).items():
            got = data.get(key)
            if not isinstance(got, int) or isinstance(got, bool) or got < low:
                return False
        if trigger.group_of is not None:
            group = data.get("group")
            if not isinstance(group, str):
                return False
            if group not in self._groups_by_kind.get(trigger.group_of, set()):
                return False
        return True

    def _view_holds(self, fact: ViewFact, view: PlayerView) -> bool:
        ids, me = self._ids, self.player
        if fact.own is not None:
            return view.nodes[ids[fact.own]].owner == me
        if fact.starving is not None:
            node = view.nodes[ids[fact.starving]]
            return node.owner == me and node.starve_in is not None
        if fact.warehouse_full is not None:
            node = view.nodes[ids[fact.warehouse_full]]
            return (
                node.owner == me
                and node.warehouse is not None
                and node.warehouse == node.warehouse_cap
            )
        if fact.group_full is not None:
            at = ids[fact.group_full]
            return view.nodes[at].owner == me and any(
                isinstance(g.location, AtNode)
                and g.location.node == at
                and g.units > 0
                and g.charged == g.units
                for g in view.groups
            )
        if fact.enemy_road is not None:
            near = self._incident[ids[fact.enemy_road]]
            return any(view.edges[edge].enemy_groups for edge in near)
        if fact.enemy_plan is not None:
            target = ids[fact.enemy_plan]
            return any(
                i.owner != me and i.kind is IntentKind.PLANNED_MOVE and i.target == target
                for i in view.intents
            )
        return False

    # Goal --------------------------------------------------------------------------------

    def _count_goal_events(self, now: _Tick) -> None:
        for i, cond in enumerate(self.chapter.goal.all):
            if cond.event is None or (cond.since is not None and cond.since not in self._entered):
                continue
            self._goal_counts[i] += sum(1 for e in now.events if self._event_matches(cond, e))

    def _goal_holds(self, now: _Tick) -> bool:
        for i, cond in enumerate(self.chapter.goal.all):
            if cond.event is not None:
                if self._goal_counts[i] < cond.count:
                    return False
            elif cond.view is None or now.view is None or not self._view_holds(cond.view, now.view):
                return False
        return True
