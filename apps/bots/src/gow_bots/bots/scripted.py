"""The scripted opponent of a tutorial chapter (#806, ``docs/design/tutorial.md``, section 7.4).

A ``ScriptedBot`` gives a fixed list of moves, each once: at a tick (``at``) or when it owns a
node (``owns``), so the lesson of a chapter is always the same. It sees only its ``PlayerView``
like any bot (AGENTS.md, section 8): it finds "the own group standing in node X" there and
answers a ``Move`` with that group's opaque id. A step whose group is gone (or marching) is
skipped. Deterministic, no seed.

``at = T`` means the move applies at tick ``T``: the bot gives it on its view after tick ``T - 1``.
The server calls a scripted seat every tick (``BotSeat.decide_every``), so the chapters play at
the ticks the design document records; called less often, a step goes at the first call at or
after its tick. It is a ``Glancer``: between its steps it does not need its view, so a call
builds none.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from gow_sim.commands import Command, Move
from gow_sim.view import AtNode, PlayerView


@dataclass(frozen=True, slots=True)
class ScriptStep:
    """Move the own group standing in node ``origin`` to ``dest``; at tick ``at`` or once the bot
    owns node ``owns`` (exactly one of the two)."""

    origin: int
    dest: int
    at: int | None = None
    owns: int | None = None
    planned: bool = False
    bonus: int = 0

    def __post_init__(self) -> None:
        if (self.at is None) == (self.owns is None):
            raise ValueError("a script step has exactly one of at and owns")


class ScriptedBot:
    """A ``Controller`` (and ``Glancer``) that plays ``steps`` (module docstring)."""

    def __init__(self, steps: Sequence[ScriptStep]) -> None:
        self.steps = tuple(steps)
        self._pending = list(range(len(self.steps)))
        """Indices of the steps not given yet, in order."""

    def _due(self, step: ScriptStep, tick: int) -> bool:
        return step.at is not None and tick + 1 >= step.at

    def thinks(self, tick: int) -> bool:
        """A call needs the view: a step is due by its tick, or a step waits for a node."""
        return any(
            self.steps[i].owns is not None or self._due(self.steps[i], tick) for i in self._pending
        )

    def glance(self, tick: int, figures: tuple[int, ...]) -> None:
        del tick, figures  # nothing to remember between steps

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        out: list[Command] = []
        for i in list(self._pending):
            step = self.steps[i]
            owned = step.owns is not None and view.nodes[step.owns].owner == view.player
            if not (owned or self._due(step, tick)):
                continue
            self._pending.remove(i)
            group = self._group_in(view, step.origin)
            if group is not None:
                out.append(Move(group, step.dest, step.planned, step.bonus))
        return out

    @staticmethod
    def _group_in(view: PlayerView, node: int) -> int | None:
        """The opaque id of the own group standing in ``node`` without an order."""
        for group in view.groups:
            loc = group.location
            if isinstance(loc, AtNode) and loc.node == node and group.order is None:
                return group.id
        return None
