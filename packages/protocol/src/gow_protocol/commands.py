"""Commands on the wire: the ``cmd`` of a ``command`` message (AGENTS.md, section 4.3).

A command is an intent, never state. It names own groups by opaque id and map nodes and edges by
their public map ids. One wire command per simulation command of SIM-04 (#20):
``Move(group, dest, planned, bonus)``, ``Split(group, n)``, ``Merge(groups)``,
``SetStance(stance)``, ``Recruit(node)``, ``CancelOrder(group)``, ``Forfeit()``; DEC-25:
``CancelRecruit(node)``; DEC-26: ``BuildBarracks(node)``; DEC-41: ``BuildFactory(node)``,
``ReleasePlan(group)``; the supply flow (DEC-43): ``SetLeafShift(shift)``; road fortifications
(DEC-43, item D): ``FortifyRoad(node, edge)``; the group order and the recruit rally point
(DEC-48): ``GroupMove(groups, dest, planned, bonus)``, ``SetRallyPoint(node, target)``. The
conversion to simulation commands is PRO-03 (#46).

The schema checks only the shape. Ownership, visibility, reachability and CP are checked by the
simulation's ``validate()``, which answers with one ``reject_code`` in ``ack`` and uses the same
``NOT_FOUND_OR_HIDDEN`` for "does not exist" and "not visible".
"""

from typing import Annotated, Final, Literal

from pydantic import Field, field_validator

from gow_protocol.base import EdgeId, NodeId, NonNegInt, OpaqueId, PosInt, WireModel
from gow_sim.ruleset import MAX_GROUP_ORDER, Stance

MAX_MERGE_GROUPS: Final = 16
"""Wire limit on ``merge.groups`` against oversized messages; not a game rule."""


class MoveCmd(WireModel):
    type: Literal["move"] = "move"
    group: OpaqueId
    dest: NodeId
    planned: bool
    """Planned order (DEC-08): visible to everyone as an intent; the group waits and gathers
    ``bonus`` (DEC-41, item 10)."""
    bonus: NonNegInt = 0
    """A planned order only: the requested attack bonus, at least 1. An ordinary order gives 0;
    otherwise ``INVALID_ARGUMENT``."""


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


class SetStanceCmd(WireModel):
    type: Literal["set_stance"] = "set_stance"
    stance: Stance


class BuildBarracksCmd(WireModel):
    """The own city ``node`` builds the barracks (DEC-26): then it recruits."""

    type: Literal["build_barracks"] = "build_barracks"
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


class BuildFactoryCmd(WireModel):
    """The own city ``node`` builds a factory (DEC-41, item 2): ``factory.cost``
    charges by the progressive payment (item 7), no CP."""

    type: Literal["build_factory"] = "build_factory"
    node: NodeId


class FortifyRoadCmd(WireModel):
    """The own city or province ``node`` fortifies the road ``edge`` leaving it (DEC-43, item D):
    ``ruleset_public.fort.cost`` CP. ``NOT_ADJACENT`` when the road does not leave the node,
    ``ALREADY_BUILT`` for a second one of the node on that road."""

    type: Literal["fortify_road"] = "fortify_road"
    node: NodeId
    edge: EdgeId


class SetLeafShiftCmd(WireModel):
    """The own leaf shift (DEC-43, item B2): the level of the supply flow moves ``shift`` roads
    back from the front, ``0..View.me.leaf_shift_max``; the range is checked by the simulation
    (``INVALID_ARGUMENT``), the same value gives ``NO_CHANGE``. Free, not public. Without
    ``ruleset_public.supply_leaf_shift`` (DEC-50) always ``INVALID_ARGUMENT``: the shift stays 0."""

    type: Literal["set_leaf_shift"] = "set_leaf_shift"
    shift: NonNegInt


class ReleasePlanCmd(WireModel):
    """The own group waiting on a gathering planned order departs now with the bonus gathered so
    far, free (DEC-41, item 10)."""

    type: Literal["release_plan"] = "release_plan"
    group: OpaqueId


class GroupMoveCmd(WireModel):
    """DEC-48: one order for several own groups to ``dest``. An own ``dest`` is a rally (every
    group departs at once and merges there, ``ruleset_public.group_order.rally_pct`` of a move per
    group, rounded up to a whole CP), any other an attack whose groups arrive in one tick. Each
    group is checked like a ``move`` of it (partial acceptance: ``ack.members``). The order of
    ``groups`` decides the split of a planned bonus (the first ones take the remainder).
    ``INVALID_ARGUMENT`` without ``ruleset_public.group_order``, for more groups than its
    ``max_groups`` and for a planned rally."""

    type: Literal["group_move"] = "group_move"
    groups: Annotated[tuple[OpaqueId, ...], Field(min_length=1, max_length=MAX_GROUP_ORDER)]
    dest: NodeId
    planned: bool
    """A planned attack: each group gathers its part of ``bonus`` in its node (DEC-48, item F)."""
    bonus: NonNegInt = 0
    """A planned order only: the requested total bonus, at least 1; 0 otherwise."""

    @field_validator("groups")
    @classmethod
    def _distinct(cls, groups: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(groups)) != len(groups):
            raise ValueError("groups must be distinct")
        return groups


class SetRallyPointCmd(WireModel):
    """DEC-48, item H: the new units of the own city ``node`` walk to the own node ``target``
    (each pays ``ruleset_public.recruit.rally_cost`` when it leaves); ``null`` clears the point.
    Setting and clearing are free. ``INVALID_ARGUMENT`` without
    ``ruleset_public.recruit.rally_point``."""

    type: Literal["set_rally_point"] = "set_rally_point"
    node: NodeId
    target: NodeId | None


class ForfeitCmd(WireModel):
    type: Literal["forfeit"] = "forfeit"


type Command = Annotated[
    MoveCmd
    | SplitCmd
    | MergeCmd
    | SetStanceCmd
    | BuildBarracksCmd
    | RecruitCmd
    | CancelRecruitCmd
    | CancelOrderCmd
    | BuildFactoryCmd
    | FortifyRoadCmd
    | SetLeafShiftCmd
    | ReleasePlanCmd
    | GroupMoveCmd
    | SetRallyPointCmd
    | ForfeitCmd,
    Field(discriminator="type"),
]
