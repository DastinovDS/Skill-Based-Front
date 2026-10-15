"""Commands on the wire: the ``cmd`` of a ``command`` message (AGENTS.md, section 4.3).

A command is an intent, never state. It names own groups by opaque id and map nodes and edges by
their public map ids. One wire command per simulation command of SIM-04 (#20):
``Move(group, dest, planned)``, ``Split(group, n)``, ``Merge(groups)``, ``SetMode(group, mode)``,
``SetStance(stance)``, ``UpgradeRoad(node, edge)``, ``Recruit(node)``, ``CancelOrder(group)``,
``Forfeit()``; DEC-18: ``SetPriority(node, level)``, ``Transfer(from, to, n)``; DEC-25:
``CancelRecruit(node)``; DEC-26: ``BuildBarracks(node)``, ``UpgradeWarehouse(node)``. The conversion
to simulation commands is PRO-03 (#46).

The schema checks only the shape. Ownership, visibility, reachability and CP are checked by the
simulation's ``validate()``, which answers with one ``reject_code`` in ``ack`` and uses the same
``NOT_FOUND_OR_HIDDEN`` for "does not exist" and "not visible".
"""

from typing import Annotated, Final, Literal

from pydantic import Field, field_validator

from gow_protocol.base import EdgeId, NodeId, OpaqueId, PosInt, WireModel
from gow_sim.ruleset import Stance
from gow_sim.state import Mode, Priority

MAX_MERGE_GROUPS: Final = 16
"""Wire limit on ``merge.groups`` against oversized messages; not a game rule."""


class MoveCmd(WireModel):
    type: Literal["move"] = "move"
    group: OpaqueId
    dest: NodeId
    planned: bool
    """Planned order (DEC-08): costlier, visible to everyone as an intent, starts after a delay."""


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


LegacyRoadType = Literal["fast", "freight"]
"""A road type of the clients from before DEC-26: accepted on the wire, rejected by the simulation
with ``INVALID_ARGUMENT`` (DEC-26, item 7: roads have no type)."""


class UpgradeRoadCmd(WireModel):
    """The own city ``node`` raises the internal road ``edge`` by one level (DEC-16, DEC-22).

    Roads have no type (DEC-26, item 7): ``kind`` is omitted; a given one gives
    ``INVALID_ARGUMENT``.
    """

    type: Literal["upgrade_road"] = "upgrade_road"
    node: NodeId
    edge: EdgeId
    kind: LegacyRoadType | None = None


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


class SetPriorityCmd(WireModel):
    """Supply priority ``level`` of the own city ``node`` (DEC-18, item 1)."""

    type: Literal["set_priority"] = "set_priority"
    node: NodeId
    level: Priority


class TransferCmd(WireModel):
    """Ship ``n`` charges from the warehouse of the own city ``from_node`` to the own city
    ``to_node`` along own roads, once (DEC-18, item 6). The ``ack`` carries the path and the
    arrival tick; the client never computes them."""

    type: Literal["transfer"] = "transfer"
    from_node: NodeId
    to_node: NodeId
    n: PosInt


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
    | SetPriorityCmd
    | TransferCmd
    | ForfeitCmd,
    Field(discriminator="type"),
]
