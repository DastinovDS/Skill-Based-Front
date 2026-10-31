"""Commands on the wire: the ``cmd`` of a ``command`` message (AGENTS.md, section 4.3).

A command is an intent, never state. It names own groups by opaque id and map nodes and edges by
their public map ids. One wire command per simulation command of SIM-04 (#20):
``Move(group, dest, planned)``, ``Split(group, n)``, ``Merge(groups)``, ``SetMode(group, mode)``,
``SetStance(stance)``, ``UpgradeRoad(node, edge)``, ``Recruit(node)``, ``CancelOrder(group)``,
``Forfeit()``; DEC-18: ``Transfer(from, to, n)``; DEC-28: ``SetFront(marker, node)``,
``SetRearMin(n)``; DEC-25:
``CancelRecruit(node)``; DEC-26: ``BuildBarracks(node)``, ``UpgradeWarehouse(node)``; economy v2
(DEC-41, item 14): ``Move(group, dest, planned, bonus)``, ``BuildFactory(node)``,
``BuildBunker(node)``, ``DrawLine(path)``, ``RemoveLine(line)``, ``ReleasePlan(group)``;
``SetAutoLines(on)`` (#665). A command
of the other economy model (``ruleset_public.economy.model``) is rejected with
``FEATURE_DISABLED``. The conversion to simulation commands is PRO-03 (#46).

The schema checks only the shape. Ownership, visibility, reachability and CP are checked by the
simulation's ``validate()``, which answers with one ``reject_code`` in ``ack`` and uses the same
``NOT_FOUND_OR_HIDDEN`` for "does not exist" and "not visible".
"""

from typing import Annotated, Final, Literal

from pydantic import Field, field_validator

from gow_protocol.base import EdgeId, NodeId, NonNegInt, OpaqueId, PosInt, WireModel
from gow_sim.ruleset import Stance
from gow_sim.state import Mode

MAX_MERGE_GROUPS: Final = 16
"""Wire limit on ``merge.groups`` against oversized messages; not a game rule."""
MAX_LINE_NODES: Final = 128
"""Wire limit on ``draw_line.path`` against oversized messages; not a game rule (a line is a
simple path, so it has at most as many nodes as the map)."""


class MoveCmd(WireModel):
    type: Literal["move"] = "move"
    group: OpaqueId
    dest: NodeId
    planned: bool
    """Planned order (DEC-08): visible to everyone as an intent. Economy v1: costlier, starts
    after a delay. Economy v2 (DEC-41, item 10): the price of a move, the group waits and gathers
    ``bonus``."""
    bonus: NonNegInt = 0
    """Economy v2, a planned order only: the requested attack bonus, at least 1. An ordinary
    order and any order under v1 give 0; otherwise ``INVALID_ARGUMENT``."""


class SplitCmd(WireModel):
    type: Literal["split"] = "split"
    group: OpaqueId
    n: PosInt
    """Units that leave ``group`` as a new group."""


class MergeCmd(WireModel):
    type: Literal["merge"] = "merge"
    groups: Annotated[tuple[OpaqueId, ...], Field(min_length=2, max_length=MAX_MERGE_GROUPS)]

    @field_validator("groups")
    @classmethod
    def _distinct(cls, groups: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(groups)) != len(groups):
            raise ValueError("groups must be distinct")
        return groups


class SetModeCmd(WireModel):
    type: Literal["set_mode"] = "set_mode"
    group: OpaqueId
    mode: Mode


class SetStanceCmd(WireModel):
    type: Literal["set_stance"] = "set_stance"
    stance: Stance


class UpgradeRoadCmd(WireModel):
    """Raise the own internal road ``edge`` by one level for ``cost.build`` CP (DEC-28, item 7);
    no city pays or builds it."""

    type: Literal["upgrade_road"] = "upgrade_road"
    edge: EdgeId


class BuildBarracksCmd(WireModel):
    """The own city ``node`` builds the barracks (DEC-26, ``city_upgrades``): then it recruits."""

    type: Literal["build_barracks"] = "build_barracks"
    node: NodeId


class UpgradeWarehouseCmd(WireModel):
    """The own city ``node`` raises its warehouse by one level (DEC-26, item 3)."""

    type: Literal["upgrade_warehouse"] = "upgrade_warehouse"
    node: NodeId


class RecruitCmd(WireModel):
    """Put one unit into the recruit queue of the own city ``node`` (DEC-25)."""

    type: Literal["recruit"] = "recruit"
    node: NodeId


class CancelRecruitCmd(WireModel):
    """Take the last unit off the recruit queue of the own city ``node`` (DEC-25, item 11)."""

    type: Literal["cancel_recruit"] = "cancel_recruit"
    node: NodeId


class CancelOrderCmd(WireModel):
    type: Literal["cancel_order"] = "cancel_order"
    group: OpaqueId


class SetFrontCmd(WireModel):
    """Put the front marker ``marker`` (``0..supply.front_markers - 1`` of ``ruleset_public``,
    checked by the simulation) on the own city ``node``; ``node = null`` takes it off the map
    (DEC-28, item 2). Free (``cost.front``)."""

    type: Literal["set_front"] = "set_front"
    marker: NonNegInt
    node: NodeId | None


class SetRearMinCmd(WireModel):
    """The own rear minimum ``n``, ``0..supply.rear_min_max`` of ``ruleset_public`` (DEC-28,
    item 3); the range is checked by the simulation (``INVALID_ARGUMENT``)."""

    type: Literal["set_rear_min"] = "set_rear_min"
    n: NonNegInt


class TransferCmd(WireModel):
    """Ship ``n`` charges from the warehouse of the own city ``from_node`` to the own city
    ``to_node`` along own roads, once (DEC-18, item 6). The ``ack`` carries the path and the
    arrival tick; the client never computes them."""

    type: Literal["transfer"] = "transfer"
    from_node: NodeId
    to_node: NodeId
    n: PosInt


class BuildFactoryCmd(WireModel):
    """The own city ``node`` builds a factory (economy v2, DEC-41, item 2): ``factory.cost``
    charges by the progressive payment (item 7), no CP."""

    type: Literal["build_factory"] = "build_factory"
    node: NodeId


class BuildBunkerCmd(WireModel):
    """The own city or province ``node`` builds a bunker (economy v2, DEC-41, item 12):
    ``bunker.cost`` charges by the progressive payment (item 7), no CP."""

    type: Literal["build_bunker"] = "build_bunker"
    node: NodeId


class DrawLineCmd(WireModel):
    """Draw a supply line along ``path`` (economy v2, DEC-41, items 3 and 6): own nodes, each
    next one joined by a road, from the source (an own factory or the target of an own line) to
    the target (an own node with a warehouse). Free; the path is used as drawn while intact."""

    type: Literal["draw_line"] = "draw_line"
    path: Annotated[tuple[NodeId, ...], Field(min_length=2, max_length=MAX_LINE_NODES)]


class RemoveLineCmd(WireModel):
    """Remove the own line ``line`` (``View.lines[].id``; economy v2, DEC-41, item 3). Free."""

    type: Literal["remove_line"] = "remove_line"
    line: NonNegInt


class SetAutoLinesCmd(WireModel):
    """Turn the auto-extension of the own lines on or off (economy v2, DEC-41, owner decision
    2026-10-31, #665): with it on, a city the player captures gets a line from the nearest own
    source by itself. Free; ``NO_CHANGE`` when it is already so (``View.me.auto_lines``)."""

    type: Literal["set_auto_lines"] = "set_auto_lines"
    on: bool


class ReleasePlanCmd(WireModel):
    """The own group waiting on a gathering planned order departs now with the bonus gathered so
    far, free (economy v2, DEC-41, item 10)."""

    type: Literal["release_plan"] = "release_plan"
    group: OpaqueId


class ForfeitCmd(WireModel):
    type: Literal["forfeit"] = "forfeit"


type Command = Annotated[
    MoveCmd
    | SplitCmd
    | MergeCmd
    | SetModeCmd
    | SetStanceCmd
    | UpgradeRoadCmd
    | BuildBarracksCmd
    | UpgradeWarehouseCmd
    | RecruitCmd
    | CancelRecruitCmd
    | CancelOrderCmd
    | SetFrontCmd
    | SetRearMinCmd
    | TransferCmd
    | BuildFactoryCmd
    | BuildBunkerCmd
    | DrawLineCmd
    | RemoveLineCmd
    | SetAutoLinesCmd
    | ReleasePlanCmd
    | ForfeitCmd,
    Field(discriminator="type"),
]
