"""Commands on the wire: the ``cmd`` of a ``command`` message (AGENTS.md, section 4.3).

A command is an intent, never state. It names own groups by opaque id and map nodes and edges by
their public map ids. One wire command per simulation command of SIM-04 (#20):
``Move(group, dest, planned)``, ``Split(group, n)``, ``Merge(groups)``, ``SetMode(group, mode)``,
``SetStance(stance)``, ``UpgradeRoad(group, edge)``, ``Recruit(node)``, ``CancelOrder(group)``,
``Forfeit()``. The conversion to simulation commands is PRO-03 (#46).

The schema checks only the shape. Ownership, visibility, reachability and CP are checked by the
simulation's ``validate()``, which answers with one ``reject_code`` in ``ack`` and uses the same
``NOT_FOUND_OR_HIDDEN`` for "does not exist" and "not visible".
"""

from typing import Annotated, Final, Literal

from pydantic import Field, field_validator

from gow_protocol.base import EdgeId, NodeId, OpaqueId, PosInt, WireModel
from gow_sim.ruleset import Stance
from gow_sim.state import Mode

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


class UpgradeRoadCmd(WireModel):
    type: Literal["upgrade_road"] = "upgrade_road"
    group: OpaqueId
    edge: EdgeId


class RecruitCmd(WireModel):
    type: Literal["recruit"] = "recruit"
    node: NodeId


class CancelOrderCmd(WireModel):
    type: Literal["cancel_order"] = "cancel_order"
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
    | RecruitCmd
    | CancelOrderCmd
    | ForfeitCmd,
    Field(discriminator="type"),
]
