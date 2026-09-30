"""Shared building blocks of the wire schema: the base model and the constrained scalar types.

Every message model derives from ``WireModel``:

- ``extra="forbid"``: an unknown field is an error, not silently dropped;
- ``hide_input_in_errors=True``: the text of a ``ValidationError`` never contains the input, so a
  token from ``hello`` cannot reach an error message or a log (AGENTS.md, section 5.4). The
  adapters in ``gow_protocol.codec`` set the same flag, because a union-level error (bad JSON,
  unknown ``type``) is rendered with the adapter's config, not the model's;
- ``strict=True``: no coercion. ``1.0``, ``"1"`` and ``true`` are not integers, so game quantities
  on the wire are integers only, as in the simulation (AGENTS.md, section 4.1, rule 3);
- ``frozen=True``: messages are values;
- ``json_schema_serialization_defaults_required=True``: in the serialization schema (what the
  server sends) fields with a default are required, so the generated TypeScript types (PRO-02,
  #45) do not mark ``type`` as optional and the unions narrow by ``type``;
- ``use_attribute_docstrings=True``: the docstring under a field becomes its description in the
  JSON Schema and a doc comment in the generated TypeScript.

Integers are bounded by ``MAX_INT`` (int32): a JavaScript ``number`` holds them exactly, and a
huge integer from a client is a validation error, not a bignum inside the server.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from gow_sim.maps import MAX_WIDTH, PLAYERS
from gow_sim.state import PROGRESS_SCALE

MAX_INT: Final = 2**31 - 1
"""Largest integer on the wire."""

WIRE_CONFIG: Final = ConfigDict(
    extra="forbid",
    hide_input_in_errors=True,
    strict=True,
    frozen=True,
    json_schema_serialization_defaults_required=True,
    use_attribute_docstrings=True,
)


class WireModel(BaseModel):
    model_config = WIRE_CONFIG


NonNegInt = Annotated[int, Field(ge=0, le=MAX_INT)]
PosInt = Annotated[int, Field(ge=1, le=MAX_INT)]
SignedInt = Annotated[int, Field(ge=-MAX_INT, le=MAX_INT)]

Tick = NonNegInt
NodeId = NonNegInt
"""Map node id. The map is public (DEC-04), so node ids are the map's own ids, not opaque."""
EdgeId = NonNegInt
"""Map edge id, public like node ids."""
type PlayerId = Annotated[int, Field(ge=0, le=1, json_schema_extra={"enum": list(PLAYERS)})]
"""``gow_sim.maps.PLAYERS``. Not ``Literal[0, 1]``: pydantic accepts ``true`` and ``1.0`` there.

A ``type`` alias and the ``enum`` make it a named ``PlayerId = 0 | 1`` in the JSON Schema and in
TypeScript, instead of ``number``."""
Width = Annotated[int, Field(ge=1, le=MAX_WIDTH)]
Progress = Annotated[int, Field(ge=0, le=PROGRESS_SCALE)]
"""Position on an edge in thousandths, as ``gow_sim.state.OnEdge.progress``."""
Centi = NonNegInt
"""Hundredths: CP (100 = 1 CP) and capacity gains, as in the ruleset."""

OpaqueId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
"""Per-player opaque id of an own group, own packet or intent (AGENTS.md, section 4.4).

The simulation's sequential ids never reach the wire; SIM-14 (#30) derives these ids with keyed
blake2b and ``resolve()`` maps them back. The schema only fixes the alphabet and the length.
"""

Code = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]{0,63}$")]
"""Machine-readable code in UPPER_SNAKE_CASE, e.g. ``NOT_FOUND_OR_HIDDEN``."""

MapId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
"""``meta.name`` of the map (docs/design/map-format.md)."""
