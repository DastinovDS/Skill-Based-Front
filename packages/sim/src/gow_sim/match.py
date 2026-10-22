"""The match engine (SIM-15): ``Match`` with the fixed system order and ``run_headless()``.

A tick (AGENTS.md, section 4.2): ``state.tick`` grows by one first, so every system of tick ``t``
sees ``state.tick == t`` (``t`` starts at 1; tick 0 is the initial state). Then, in this order::

    apply_commands -> economy -> movement -> combat -> capacity -> supply -> recruit -> build
    -> orders -> victory -> vision

``combat`` gets the bonuses of planned orders and «Защита» (``systems.orders.active_bonuses``).
The events of every system are appended to ``state.events`` as soon as the system returns, so a
later system reads the events of the tick that came before it (``combat`` the arrivals of
``movement``, ``orders`` the fights). The match ends with the ``match_ended`` event of ``victory``
(SIM-13): capital capture, ``Forfeit`` (a command, DEC-05), or the timer.

The system order is part of ``SIM_VERSION``: changing it means a new version (section 4.5).
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

from gow_sim.commands import Command, CommandResult, PlayerCommand, Reject, apply_commands
from gow_sim.maps import PLAYERS, MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import Event, GameState, initial_state, state_hash
from gow_sim.systems.build import build
from gow_sim.systems.capacity import capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.economy import economy
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.systems.recruit import recruit
from gow_sim.systems.supply import supply
from gow_sim.systems.victory import EndReason, Outcome, victory
from gow_sim.systems.vision import vision
from gow_sim.view import PlayerView, Reach, check_match_key, project, reach, resolve

__all__ = [
    "HEADLESS_MATCH_KEY",
    "SIM_VERSION",
    "SYSTEMS",
    "Controller",
    "Match",
    "MatchFinishedError",
    "MatchObserver",
    "MatchResult",
    "run_headless",
]

SIM_VERSION: Final = 20
"""Version of the rules and the system order; replays and golden hashes are per version."""

HEADLESS_MATCH_KEY: Final = b"gow_sim headless match key 0001"
"""Default ``match_key`` of ``run_headless``: a headless match has no players to hide ids from."""

type System = Callable[[GameState, Ruleset], list[Event]]


def _combat(state: GameState, rules: Ruleset) -> list[Event]:
    return combat(state, rules, active_bonuses(state, rules))


SYSTEMS: Final[tuple[tuple[str, System], ...]] = (
    ("economy", economy),
    ("movement", movement),
    ("combat", _combat),
    ("capacity", capacity),
    ("supply", supply),
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
        self.rules: Final = rules
        self.match_key: Final = match_key
        self.state: Final = initial_state(mapdef, rules)
        self.results: list[CommandResult] = []
        """Results of the commands of the last ``step()``, in ``(player, seq)`` order."""
        self.outcome: Outcome | None = None
        """Set by the ``match_ended`` event; ``None`` while the match goes on."""

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
        for _, system in SYSTEMS:
            state.events.extend(system(state, rules))
        for e in state.events:
            if e.kind == "match_ended":
                winner, reason = e.get("winner"), e.get("reason")
                assert winner is None or isinstance(winner, int)
                assert isinstance(reason, str)
                self.outcome = Outcome(winner, EndReason(reason))
        return list(state.events)

    def view(self, player: int) -> PlayerView:
        """``project()`` of the current state for ``player``."""
        return project(self.state, self.rules, player, self.match_key)

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
    decide_every: int = 5,
    match_key: bytes = HEADLESS_MATCH_KEY,
    observer: MatchObserver | None = None,
) -> MatchResult:
    """Play a match between ``controllers`` (by player id) without a server.

    A controller decides at tick 0 and then every ``decide_every`` ticks, on its view after the
    tick; its commands (``seq`` counts per player from 0) are resolved like the server does it
    and applied at the start of the next tick. Stops when the match ends or after ``max_ticks``
    ticks (default: ``rules.match_ticks``, where the timer ends the match anyway).
    ``observer`` sees the match before the first tick and after every tick (a replay writer).
    """
    if len(controllers) != len(PLAYERS):
        raise ValueError(f"need {len(PLAYERS)} controllers, got {len(controllers)}")
    if decide_every < 1:
        raise ValueError("decide_every must be at least 1")
    limit = rules.match_ticks if max_ticks is None else max_ticks
    match = Match(mapdef, rules, match_key)
    seqs: dict[int, int] = dict.fromkeys(PLAYERS, 0)
    accepted: dict[int, int] = dict.fromkeys(PLAYERS, 0)
    rejected: dict[int, int] = dict.fromkeys(PLAYERS, 0)
    pending: list[PlayerCommand] = []
    if observer is not None:
        observer.begin(match)
    while not match.finished and match.tick < limit:
        if match.tick % decide_every == 0:
            for player in PLAYERS:
                for cmd in controllers[player].decide(match.view(player), match.tick):
                    pending.append(PlayerCommand(player, seqs[player], match.resolve(player, cmd)))
                    seqs[player] += 1
        match.step(pending)
        if observer is not None:
            observer.record(match, pending)
        pending = []
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
