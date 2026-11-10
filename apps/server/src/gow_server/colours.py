"""Player colours (DEC-49, #906): the set Engraved six, the allowed pairs and the clash rule.

The set and its values are DEC-49, item 1. The distances are CIEDE2000 between two colours of the
set as normal, protanope and deuteranope vision sees them (Machado 2009, full severity, on linear
RGB), in tenths, rounded to the nearest. They were computed once from the hex values, the same way
as the mockup ``docs/design/mockups/player-colours.html`` computes them; nothing is computed at run
time (DEC-49, item 3: the check is a table on the fixed set).

- A pair is **allowed** when both colours differ and the distance is at least ``ALLOWED_TENTHS``
  in each of the three visions (DEC-49, item 3; tritanopia does not block).
- A **clash** (the same colour, or a pair that is not allowed): the player who keeps their colour
  is the first one (the host of an invite or a public lobby match, the one who entered the queue
  earlier, the human of a bot match); the other gets the allowed colour **farthest** from it in
  normal vision (DEC-49, item 2). A bot has no wish of its own: it always gets the farthest.
"""

from typing import Final

from gow_protocol.messages import PlayerColour

DEFAULT_COLOUR: Final = PlayerColour.LAPIS
"""The colour of a player who never chose one: today's own colour (DEC-49, item 1)."""

HEX: Final[dict[PlayerColour, str]] = {
    PlayerColour.LAPIS: "#86a6ea",
    PlayerColour.MINIUM: "#e5785e",
    PlayerColour.GLACIER: "#a6e0e8",
    PlayerColour.SHELL: "#f4b4a4",
    PlayerColour.VIOLET: "#966fd6",
    PlayerColour.MADDER: "#c8587e",
}
"""DEC-49, item 1. The order of ``PlayerColour`` is the order of the set."""

ALLOWED_TENTHS: Final = 120
"""DEC-49, item 3: a pair is allowed at CIEDE2000 >= 12 in normal, protan and deutan vision."""

_C = PlayerColour
DISTANCES: Final[dict[tuple[PlayerColour, PlayerColour], tuple[int, int, int]]] = {
    # (a, b): CIEDE2000 in tenths under (normal, protanopia, deuteranopia); a before b in the set.
    (_C.LAPIS, _C.MINIUM): (400, 418, 459),
    (_C.LAPIS, _C.GLACIER): (232, 191, 178),
    (_C.LAPIS, _C.SHELL): (342, 331, 394),
    (_C.LAPIS, _C.VIOLET): (194, 136, 108),
    (_C.LAPIS, _C.MADDER): (366, 246, 298),
    (_C.MINIUM, _C.GLACIER): (444, 335, 347),
    (_C.MINIUM, _C.SHELL): (154, 168, 134),
    (_C.MINIUM, _C.VIOLET): (377, 446, 495),
    (_C.MINIUM, _C.MADDER): (214, 275, 178),
    (_C.GLACIER, _C.SHELL): (366, 192, 251),
    (_C.GLACIER, _C.VIOLET): (342, 310, 272),
    (_C.GLACIER, _C.MADDER): (498, 321, 270),
    (_C.SHELL, _C.VIOLET): (375, 404, 453),
    (_C.SHELL, _C.MADDER): (274, 309, 212),
    (_C.VIOLET, _C.MADDER): (234, 190, 303),
}
"""Every unordered pair of the set once. Lapis/Violet is the one closed pair (deutan 10.8)."""

_ORDER: Final = tuple(PlayerColour)


def colour_of(value: str | None) -> PlayerColour:
    """The ``PlayerColour`` of a stored value; ``DEFAULT_COLOUR`` for ``None`` or a value that is
    not in the set (a row edited by hand), so a bad row never breaks a match."""
    try:
        return PlayerColour(value)
    except ValueError:
        return DEFAULT_COLOUR


def _key(a: PlayerColour, b: PlayerColour) -> tuple[PlayerColour, PlayerColour]:
    return (a, b) if _ORDER.index(a) < _ORDER.index(b) else (b, a)


def distances(a: PlayerColour, b: PlayerColour) -> tuple[int, int, int]:
    """CIEDE2000 of two different colours in tenths: normal, protan, deutan."""
    if a == b:
        raise ValueError("a colour has no distance to itself")
    return DISTANCES[_key(a, b)]


def allowed(a: PlayerColour, b: PlayerColour) -> bool:
    """Two players may hold ``a`` and ``b`` in one match (DEC-49, item 3)."""
    return a != b and min(distances(a, b)) >= ALLOWED_TENTHS


def farthest(keeper: PlayerColour) -> PlayerColour:
    """The allowed colour farthest from ``keeper`` in normal vision (DEC-49, item 2); on equal
    distance the earlier colour of the set (no two distances of the set are equal today)."""
    candidates = [c for c in _ORDER if allowed(keeper, c)]
    return max(candidates, key=lambda c: (distances(keeper, c)[0], -_ORDER.index(c)))


def resolve(keeper: PlayerColour, other: PlayerColour | None) -> PlayerColour:
    """The colour the second player gets next to ``keeper``: their wish ``other`` when the pair
    is allowed, otherwise (a clash, or a bot: ``None``) the farthest allowed colour."""
    if other is not None and allowed(keeper, other):
        return other
    return farthest(keeper)


def resolve_sides(
    wishes: tuple[PlayerColour | None, PlayerColour | None], keeper: int
) -> tuple[PlayerColour, PlayerColour]:
    """The colours of a match by player id from the wishes by player id (``None``: a bot).

    ``keeper`` is the player id that keeps its wish; a bot never keeps (a bot keeper with a
    human opponent is moved to the human), and a side without a wish keeps ``DEFAULT_COLOUR``.
    """
    other = 1 - keeper
    if wishes[keeper] is None and wishes[other] is not None:
        keeper, other = other, keeper
    first = wishes[keeper] or DEFAULT_COLOUR
    second = resolve(first, wishes[other])
    return (first, second) if keeper == 0 else (second, first)


DEFAULT_PAIR: Final = resolve_sides((None, None), 0)
"""Lapis and Minium: the colours of a match without a database row (tests, tools)."""
