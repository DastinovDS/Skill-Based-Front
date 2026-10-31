"""The phase of the match and the enemy strength by front sector (#663), from public data only.

The smart bots differ in the opening; once the territory is split their characters need to know
where the match stands and where the enemy is weak. Everything here reads the ``PlayerView``, the
map and the ruleset (AGENTS.md, section 2: a bot sees no hidden state; the enemy recruit queue and
CP are hidden, DEC-25, DEC-02):

- **Phase** (``phase``): the *opening* while more than ``OPEN_NEUTRAL_PCT`` percent of the nodes
  are neutral (public ownership), the *midgame* after it, the *late game* in the last
  ``late_awards`` VP awards (DEC-03, ``awards_left``).
- **Enemy force** (``EnemyForce``): the start forces of the map are public and symmetric
  (``NodeDef.start_owner``, ``start_units``), the CP income is flat and the same for both players
  (DEC-02), so the enemy is assumed to have recruited as many units as the own side did (own
  recruits: the own units now plus the own losses seen in fights, minus the own start units). The
  units the enemy lost in fights are public (``FightView.losses``, DEC-24, item I1), the largest
  count of every fight is kept. ``total = enemy start + own recruits - enemy losses``.
- **Strength by node** (``strengths``): the enemy shots in each enemy node. A fresh sighting
  (``FRESH_TICKS``) gives its numbers (the exact charges, the top of a range, ``guess`` for
  presence only); the rest of the estimated force that the view does not show (``hidden``) is
  spread over the enemy nodes not seen fresh, ``W_CAPITAL`` parts to the capital, ``W_FRONT`` to a
  node next to an own node, one to every other (rounded down).
- **Sectors** (``Sector``, ``sectors``): every enemy node next to an own node with its strength
  and the support of its enemy neighbours (half of their strength, rounded down): the weak spots
  are the sectors with the least ``pressure``. ``threats``: by own node next to the enemy, the
  strength of its enemy neighbours, the strongest one in full and half of the others.

Deterministic and integer, a few loops over the nodes and edges (well under the 1 ms of AGENTS.md,
section 12); ties go through ``node_key`` in the callers.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Final

from gow_bots.bots.assess import FRESH_TICKS, awards_left
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import Detail, PlayerView

__all__ = [
    "OPEN_NEUTRAL_PCT",
    "W_CAPITAL",
    "W_FRONT",
    "EnemyForce",
    "Phase",
    "Sector",
    "phase",
    "sectors",
    "strengths",
    "threats",
]

OPEN_NEUTRAL_PCT: Final = 10
"""The opening lasts while more than this percent of the nodes are neutral."""
W_CAPITAL: Final = 3
"""Parts of the hidden enemy force assumed in the enemy capital (its guard)."""
W_FRONT: Final = 2
"""Parts of the hidden enemy force assumed in an enemy node next to an own node."""


class Phase(Enum):
    OPENING = "opening"
    MIDGAME = "midgame"
    LATE = "late"


def phase(view: PlayerView, rules: Ruleset, late_awards: int) -> Phase:
    """The phase of the match at ``view`` (module docstring)."""
    if awards_left(rules, view.tick) <= late_awards:
        return Phase.LATE
    neutral = sum(n.owner is None for n in view.nodes)
    if 100 * neutral > OPEN_NEUTRAL_PCT * len(view.nodes):
        return Phase.OPENING
    return Phase.MIDGAME


class EnemyForce:
    """The estimate of the enemy units (module docstring), kept between decisions."""

    def __init__(self, mapdef: MapDef, player: int) -> None:
        self.player = player
        start = [0, 0]
        for n in mapdef.nodes:
            if n.start_owner is not None:
                start[n.start_owner] += n.start_units
        self.own_start = start[player]
        self.enemy_start = start[1 - player]
        self.fights: dict[int, tuple[int, int]] = {}
        """Opaque fight id to the largest own and enemy losses seen in it."""
        self.own_lost = 0
        self.enemy_lost = 0
        """Losses of the fights that ended."""
        self.recruited = 0
        """Own recruits so far (never decreases)."""
        self.total = self.enemy_start
        """The estimated enemy units."""

    def update(self, view: PlayerView) -> int:
        """Advance the estimate to ``view`` and return ``total``."""
        me, enemy = self.player, 1 - self.player
        live: dict[int, tuple[int, int]] = {}
        for f in view.fights:
            own, foe = self.fights.get(f.id, (0, 0))
            live[f.id] = (max(own, f.losses[me]), max(foe, f.losses[enemy]))
        for fid in sorted(self.fights):
            if fid not in live:
                own, foe = self.fights[fid]
                self.own_lost += own
                self.enemy_lost += foe
        self.fights = live
        own_lost = self.own_lost + sum(v[0] for v in live.values())
        enemy_lost = self.enemy_lost + sum(v[1] for v in live.values())
        units = sum(g.units for g in view.groups)
        self.recruited = max(self.recruited, units + own_lost - self.own_start)
        self.total = max(0, self.enemy_start + self.recruited - enemy_lost)
        return self.total


def _seen(view: PlayerView, node: int, guess: int) -> tuple[int, int] | None:
    """The enemy ``(units, shots)`` of a fresh sighting of ``node``; ``None``: not seen fresh."""
    seen = view.nodes[node].seen
    if seen is None or view.tick - seen.tick > FRESH_TICKS:
        return None
    if not seen.enemy_modes:
        return (0, 0)
    if seen.enemy_units is not None and seen.enemy_charged is not None:
        return (seen.enemy_units, seen.enemy_charged)
    if seen.enemy_range is not None:
        low, high = seen.enemy_range
        top = low if high is None else high
        return (top, top)
    return (guess, guess)


def strengths(
    view: PlayerView, mapdef: MapDef, neighbors: tuple[tuple[int, ...], ...], total: int, guess: int
) -> list[int]:
    """The enemy shots by node (module docstring); 0 for the nodes that are not the enemy's.
    ``total``: the estimated enemy units (``EnemyForce``); ``guess``: shots of a force seen
    without numbers."""
    me, enemy = view.player, 1 - view.player
    count = len(view.nodes)
    shots = [0] * count
    shown = 0
    for f in view.fights:
        shown += f.enemy_units
    for e in view.edges:
        for g in e.enemy_groups:
            if g.detail is Detail.EXACT and g.units is not None:
                shown += g.units
            elif g.units_range is not None:
                shown += g.units_range[0]
            else:
                shown += 1
    weights: list[tuple[int, int]] = []
    for n in view.nodes:
        if n.owner != enemy:
            continue
        seen = _seen(view, n.id, guess)
        if seen is not None:
            shown += seen[0]
            shots[n.id] = seen[1]
            continue
        if mapdef.nodes[n.id].capital_of is not None:
            w = W_CAPITAL
        elif any(view.nodes[m].owner == me for m in neighbors[n.id]):
            w = W_FRONT
        else:
            w = 1
        weights.append((n.id, w))
    hidden = max(0, total - shown)
    parts = sum(w for _, w in weights)
    for node, w in weights:
        shots[node] = hidden * w // parts
    return shots


@dataclass(frozen=True, slots=True)
class Sector:
    """An enemy node next to the own territory (module docstring)."""

    node: int
    shots: int
    """The enemy shots estimated in the node."""
    support: int
    """Half of the shots of its enemy neighbours (they can join a fight there)."""

    @property
    def pressure(self) -> int:
        return self.shots + self.support


def sectors(
    view: PlayerView, neighbors: tuple[tuple[int, ...], ...], shots: list[int]
) -> list[Sector]:
    """Every enemy node next to an own node with its ``Sector`` numbers, in node id order."""
    me, enemy = view.player, 1 - view.player
    found: list[Sector] = []
    for n in view.nodes:
        if n.owner != enemy or not any(view.nodes[m].owner == me for m in neighbors[n.id]):
            continue
        support = sum(shots[m] for m in neighbors[n.id] if view.nodes[m].owner == enemy)
        found.append(Sector(n.id, shots[n.id], support // 2))
    return found


def threats(
    view: PlayerView, neighbors: tuple[tuple[int, ...], ...], shots: list[int]
) -> list[int]:
    """By node: for an own node next to the enemy the enemy shots that can reach it from the
    neighbours (the strongest in full, half of the others, rounded down); 0 elsewhere."""
    me, enemy = view.player, 1 - view.player
    out = [0] * len(view.nodes)
    for n in view.nodes:
        if n.owner != me:
            continue
        near = sorted(
            (shots[m] for m in neighbors[n.id] if view.nodes[m].owner == enemy), reverse=True
        )
        if near:
            out[n.id] = near[0] + sum(near[1:]) // 2
    return out
