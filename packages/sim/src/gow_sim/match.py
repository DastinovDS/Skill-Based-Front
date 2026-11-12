"""The match engine (SIM-15): ``Match`` with the fixed system order and ``run_headless()``.

A tick (AGENTS.md, section 4.2): ``state.tick`` grows by one first, so every system of tick ``t``
sees ``state.tick == t`` (``t`` starts at 1; tick 0 is the initial state). Then, in this order::

    apply_commands -> economy -> movement -> combat -> capacity -> supply -> recruit -> build
    -> orders -> victory -> vision

``combat`` gets the bonuses of planned orders (``systems.orders.active_bonuses``); ``supply`` is
the automatic flow of DEC-43 (``systems.flow``).
The events of every system are appended to ``state.events`` as soon as the system returns, so a
later system reads the events of the tick that came before it (``combat`` the arrivals of
``movement``, ``orders`` the fights). The match ends with the ``match_ended`` event of ``victory``
(SIM-13): capital capture, ``Forfeit`` (a command, DEC-05), or the timer.

The system order is part of ``SIM_VERSION``: changing it means a new version (section 4.5).
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Protocol, runtime_checkable

from gow_sim.commands import Command, CommandResult, PlayerCommand, Reject, apply_commands
from gow_sim.maps import PLAYERS, MapDef
from gow_sim.ruleset import Ruleset, apply_map_tempo
from gow_sim.state import Event, GameState, initial_state, state_hash
from gow_sim.systems.build import build
from gow_sim.systems.capacity import capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.economy import economy
from gow_sim.systems.flow import supply_flow
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.systems.recruit import recruit
from gow_sim.systems.victory import EndReason, Outcome, victory
from gow_sim.systems.vision import Sight, observe, vision
from gow_sim.view import (
    PlayerView,
    Reach,
    check_match_key,
    enemy_figure_ids,
    project,
    reach,
    resolve,
)

__all__ = [
    "DECIDE_EVERY",
    "HEADLESS_MATCH_KEY",
    "SIM_VERSION",
    "SYSTEMS",
    "Controller",
    "ControllerFactory",
    "Decide",
    "Glancer",
    "Match",
    "MatchFinishedError",
    "MatchObserver",
    "MatchResult",
    "Seat",
    "given",
    "play",
    "run_headless",
]

SIM_VERSION: Final = 52
"""Version of the rules and the system order; replays and golden hashes are per version."""

DECIDE_EVERY: Final = 5
"""A controller decides every this many ticks (AGENTS.md, section 8), in ``run_headless``, a
tournament and the server's bot matches alike (``Seat``)."""

HEADLESS_MATCH_KEY: Final = b"gow_sim headless match key 0001"
"""Default ``match_key`` of ``run_headless``: a headless match has no players to hide ids from."""

type System = Callable[[GameState, Ruleset], list[Event]]


def _combat(state: GameState, rules: Ruleset) -> list[Event]:
    return combat(state, rules, active_bonuses(state))


SYSTEMS: Final[tuple[tuple[str, System], ...]] = (
    ("economy", economy),
    ("movement", movement),
    ("combat", _combat),
    ("capacity", capacity),
    ("supply", supply_flow),
    ("recruit", recruit),
    ("build", build),
    ("orders", orders),
    ("victory", victory),
    ("vision", vision),
)
"""The systems after ``apply_commands``, in the fixed order."""


class MatchFinishedError(RuntimeError):
    """``step()`` on a match that has already ended."""


class Match:
    """One match: the state, its ruleset and the secret ``match_key`` of the opaque ids.

    ``step()`` takes commands with internal ids; ``resolve()`` turns the opaque ids of a player's
    command into internal ones (the server and ``run_headless`` both do that before ``step``).
    """

    def __init__(self, mapdef: MapDef, rules: Ruleset, match_key: bytes) -> None:
        check_match_key(match_key)
        self.source_rules: Final = rules
        """The ruleset as given (its hash goes into a replay header)."""
        self.rules: Final = apply_map_tempo(rules, mapdef)
        """The rules this match plays: ``source_rules`` with ``[map_tempo]`` applied to the map
        (DEC-46, #803); ``source_rules`` itself without the section."""
        self.match_key: Final = match_key
        self.state: Final = initial_state(mapdef, self.rules)
        self.results: list[CommandResult] = []
        """Results of the commands of the last ``step()``, in ``(player, seq)`` order."""
        self.outcome: Outcome | None = None
        """Set by the ``match_ended`` event; ``None`` while the match goes on."""
        self._sight: dict[int, Sight] = {}
        """What the ``vision`` system of the last step computed, by player; ``view()`` reuses it
        while ``state.tick`` is still the tick of that step."""
        self._sight_tick = -1

    @property
    def tick(self) -> int:
        return self.state.tick

    @property
    def finished(self) -> bool:
        return self.outcome is not None

    def step(self, commands: Iterable[PlayerCommand] = ()) -> list[Event]:
        """Advance one tick: apply ``commands`` at its start, run the systems, return its events."""
        if self.finished:
            raise MatchFinishedError(f"the match ended at tick {self.state.tick}")
        state, rules = self.state, self.rules
        state.tick += 1
        state.events = []
        self.results, applied = apply_commands(state, rules, commands)
        state.events.extend(applied)
        self._sight_tick = -1
        for _, system in SYSTEMS:
            if system is vision:  # the same system, keeping what it saw for ``view()``
                self._sight = observe(state, rules)
                self._sight_tick = state.tick
            else:
                state.events.extend(system(state, rules))
        for e in state.events:
            if e.kind == "match_ended":
                winner, reason = e.get("winner"), e.get("reason")
                assert winner is None or isinstance(winner, int)
                assert isinstance(reason, str)
                self.outcome = Outcome(winner, EndReason(reason))
        return list(state.events)

    def view(self, player: int, *, reuse: bool = False) -> PlayerView:
        """``project()`` of the current state for ``player``. ``reuse``: the caller has not
        changed the state since the last ``step()``, so what the ``vision`` system of that step
        saw (``Sight``) is reused instead of computed again (``run_headless``)."""
        sight = self._fresh(player) if reuse else None
        return project(self.state, self.rules, player, self.match_key, sight)

    def figures(self, player: int, *, reuse: bool = False) -> tuple[int, ...]:
        """``enemy_figure_ids()`` of the current state for ``player``: the figure ids of
        ``view(player)`` alone; ``reuse`` as in ``view``."""
        sight = self._fresh(player) if reuse else None
        return enemy_figure_ids(self.state, self.rules, player, self.match_key, sight)

    def _fresh(self, player: int) -> Sight | None:
        """The sight of the last step, while ``state.tick`` is still its tick."""
        return self._sight.get(player) if self._sight_tick == self.state.tick else None

    def reach(self, player: int, group: int) -> Reach | None:
        """Where the own group with opaque id ``group`` can go (``gow_sim.view.reach``)."""
        return reach(self.state, self.rules, player, group, self.match_key)

    def resolve(self, player: int, cmd: Command) -> Command:
        """``resolve()`` of an opaque-id command of ``player`` on the current state."""
        return resolve(self.state, player, cmd, self.match_key)

    def state_hash(self) -> str:
        return state_hash(self.state)


# Headless run --------------------------------------------------------------------------------


class Controller(Protocol):
    """A player that sees only its ``PlayerView`` and answers with commands in opaque ids."""

    def decide(self, view: PlayerView, tick: int) -> list[Command]: ...


class ControllerFactory(Protocol):
    """How a controller is made: the public map, the rules the match plays, the match seed and
    the side (``gow_bots.bots.BotFactory`` has this shape). ``Seat.build`` passes ``Match.rules``,
    so a bot always sees the periods of ``[map_tempo]`` (DEC-46)."""

    def __call__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> Controller: ...


def given(controller: Controller) -> ControllerFactory:
    """The factory of a controller made already, for a scripted player that reads no rules."""

    def make(mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> Controller:
        del mapdef, rules, seed, player
        return controller

    return make


@runtime_checkable
class Glancer(Protocol):
    """A ``Controller`` that can say before its view is built whether a call will decide
    anything (a bot between two decisions of its tempo). ``Seat`` then calls ``glance`` with the
    enemy figure ids of the view alone (``Match.figures``) instead of ``decide``.

    The promise: when ``thinks(tick)`` is false, ``decide(view, tick)`` would return no commands
    and read nothing of ``view`` but those ids, so ``glance(tick, ids)`` leaves the controller as
    that call would. ``thinks`` may change the controller only the way that ``decide`` would."""

    def thinks(self, tick: int) -> bool: ...

    def glance(self, tick: int, figures: tuple[int, ...]) -> None: ...


type Decide = Callable[[Controller, PlayerView, int], list[Command]]
"""How a ``Seat`` calls ``decide``: the server times it and catches a broken bot."""


def _decide(controller: Controller, view: PlayerView, tick: int) -> list[Command]:
    return controller.decide(view, tick)


class Seat:
    """The driver of one controlled player of a match (ARP-06, #994): ``run_headless``, a
    tournament and the server's bot matches call a controller only through it.

    At every ``decide_every``-th tick (``due``) ``commands`` asks a ``Glancer`` whether it will
    think and gives it the figure ids alone when it will not; otherwise it builds the view of the
    player (``Match.view(reuse=True)``: call it right after ``Match.step``, before anything else
    changes the state), lets the controller decide through ``decide`` and turns the commands into
    ``PlayerCommand`` numbered from ``seq`` with the opaque ids resolved (``Match.resolve``), to be
    applied at the start of the next tick.
    """

    def __init__(
        self,
        match: Match,
        player: int,
        controller: Controller,
        *,
        decide_every: int = DECIDE_EVERY,
        decide: Decide = _decide,
        seq: int = 0,
    ) -> None:
        if decide_every < 1:
            raise ValueError("decide_every must be at least 1")
        self.match: Final = match
        self.player: Final = player
        self.controller: Final = controller
        self.decide_every: Final = decide_every
        self.decide: Final = decide
        self.seq = seq
        """The ``seq`` of the next command."""
        self._glancer = controller if isinstance(controller, Glancer) else None

    @classmethod
    def build(
        cls,
        match: Match,
        player: int,
        factory: ControllerFactory,
        *,
        seed: int,
        decide_every: int = DECIDE_EVERY,
        decide: Decide = _decide,
        seq: int = 0,
    ) -> "Seat":
        """The seat of a controller ``factory`` makes for ``match``: the map and ``Match.rules``,
        the rules the match plays (``[map_tempo]`` applied, DEC-46)."""
        controller = factory(match.state.map, match.rules, seed=seed, player=player)
        return cls(match, player, controller, decide_every=decide_every, decide=decide, seq=seq)

    def due(self) -> bool:
        """The controller is called at this tick."""
        return self.match.tick % self.decide_every == 0

    def commands(self) -> list[PlayerCommand]:
        """The commands of the controller for the tick after this one (class docstring); none
        when it is not ``due``."""
        match, player = self.match, self.player
        if not self.due():
            return []
        glancer = self._glancer
        if glancer is not None and not glancer.thinks(match.tick):
            glancer.glance(match.tick, match.figures(player, reuse=True))
            return []
        view = match.view(player, reuse=True)  # only ``step()`` changed the state
        out: list[PlayerCommand] = []
        for cmd in self.decide(self.controller, view, match.tick):
            out.append(PlayerCommand(player, self.seq, match.resolve(player, cmd)))
            self.seq += 1
        return out


class MatchObserver(Protocol):
    """Watches a match step by step; ``gow_sim.replay.ReplayWriter`` records it this way."""

    def begin(self, match: Match) -> None:
        """Called once with the match at tick 0, before the first ``step()``."""
        ...

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        """Called after every ``step(commands)``; ``match.tick`` is the tick just played."""
        ...


@dataclass(frozen=True, slots=True)
class MatchResult:
    outcome: Outcome | None
    """``None``: stopped by ``max_ticks`` before the match ended."""
    ticks: int
    """The last tick played."""
    vp: tuple[int, ...]
    """VP by player id at the end."""
    state_hash: str
    """``state_hash`` of the final state."""
    accepted: tuple[int, ...]
    """Accepted commands by player id."""
    rejected: tuple[int, ...]
    """Rejected commands by player id."""


def run_headless(
    mapdef: MapDef,
    rules: Ruleset,
    controllers: Sequence[Controller],
    max_ticks: int | None = None,
    decide_every: int = DECIDE_EVERY,
    match_key: bytes = HEADLESS_MATCH_KEY,
    observer: MatchObserver | None = None,
) -> MatchResult:
    """Play a match between ``controllers`` (by player id, made already) without a server.

    Every controller plays through a ``Seat``: it decides at tick 0 and then every
    ``decide_every`` ticks, on its view after the tick; its commands (``seq`` counts per player
    from 0) are resolved like the server does it and applied at the start of the next tick. A
    ``Glancer`` that will not think on a call gets only the figure ids of its view. Stops when
    the match ends or after ``max_ticks`` ticks (default: ``rules.match_ticks``, where the timer
    ends the match anyway). ``observer`` sees the match before the first tick and after every
    tick (a replay writer) and does not change it.

    A controller made here reads ``rules`` as given; a ``gow_bots`` bot takes the rules of its
    match itself (``[map_tempo]``), any other one is made by ``play`` from ``Match.rules``.
    """
    if len(controllers) != len(PLAYERS):
        raise ValueError(f"need {len(PLAYERS)} controllers, got {len(controllers)}")
    match = Match(mapdef, rules, match_key)
    seats = [Seat(match, p, controllers[p], decide_every=decide_every) for p in PLAYERS]
    return _run(match, seats, max_ticks, observer)


def play(
    mapdef: MapDef,
    rules: Ruleset,
    factories: Sequence[ControllerFactory],
    *,
    seed: int,
    max_ticks: int | None = None,
    match_key: bytes = HEADLESS_MATCH_KEY,
    observer: MatchObserver | None = None,
) -> MatchResult:
    """``run_headless`` with every controller made by its factory (by player id) for this match
    and ``seed`` (``Seat.build``: ``Match.rules``, the rules the match plays)."""
    if len(factories) != len(PLAYERS):
        raise ValueError(f"need {len(PLAYERS)} controllers, got {len(factories)}")
    match = Match(mapdef, rules, match_key)
    seats = [Seat.build(match, p, factories[p], seed=seed) for p in PLAYERS]
    return _run(match, seats, max_ticks, observer)


def _run(
    match: Match, seats: Sequence[Seat], max_ticks: int | None, observer: MatchObserver | None
) -> MatchResult:
    limit = match.rules.match_ticks if max_ticks is None else max_ticks
    accepted: dict[int, int] = dict.fromkeys(PLAYERS, 0)
    rejected: dict[int, int] = dict.fromkeys(PLAYERS, 0)
    if observer is not None:
        observer.begin(match)
    while not match.finished and match.tick < limit:
        pending = [cmd for seat in seats for cmd in seat.commands()]
        match.step(pending)
        if observer is not None:
            observer.record(match, pending)
        for r in match.results:
            counter = rejected if isinstance(r.outcome, Reject) else accepted
            counter[r.player] += 1
    state = match.state
    return MatchResult(
        outcome=match.outcome,
        ticks=state.tick,
        vp=tuple(state.players[p].vp for p in PLAYERS),
        state_hash=match.state_hash(),
        accepted=tuple(accepted[p] for p in PLAYERS),
        rejected=tuple(rejected[p] for p in PLAYERS),
    )
