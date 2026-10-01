"""Write the OpenAPI document of the HTTP API to ``apps/server/openapi.json``.

Then ``pnpm -C apps/client gen:api`` turns it into ``apps/client/src/api.gen.ts``:

    uv run python scripts/export_openapi.py && pnpm -C apps/client gen:api

Both files are committed; CI regenerates them and fails on a diff (AGENTS.md, section 6).
The app is built, not started: no database, no maps, no sockets.
"""

import json
from pathlib import Path

from gow_server.app import create_app
from gow_server.settings import Settings

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "apps" / "server" / "openapi.json"


def main() -> None:
    document = create_app(Settings()).openapi()
    OPENAPI_PATH.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"wrote {OPENAPI_PATH}")


if __name__ == "__main__":
    main()
