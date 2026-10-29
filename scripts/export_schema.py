"""Write the JSON Schema of the wire format to ``packages/protocol/protocol.schema.json``.

Also writes ``packages/protocol/vectors/event_fields.json``, the event fields the client tests read
(ARC-02, #457).

Then ``pnpm -C apps/client gen:protocol`` turns it into ``apps/client/src/protocol.gen.ts``:

    uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol

Both files are committed; CI regenerates them and fails on a diff (AGENTS.md, section 6).
"""

import json

from gow_protocol.schema import (
    EVENT_FIELDS_PATH,
    SCHEMA_PATH,
    event_fields_vector,
    protocol_json_schema,
)


def main() -> None:
    text = json.dumps(protocol_json_schema(), indent=2, ensure_ascii=False) + "\n"
    SCHEMA_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {SCHEMA_PATH}")
    fields = json.dumps(event_fields_vector(), indent=2, ensure_ascii=False) + "\n"
    EVENT_FIELDS_PATH.write_text(fields, encoding="utf-8")
    print(f"wrote {EVENT_FIELDS_PATH}")


if __name__ == "__main__":
    main()
