"""Command line: ``uv run gow-maps validate <files>``."""

import argparse
import glob
import sys
from collections.abc import Sequence
from pathlib import Path

from gow_maps.validate import load_config, validate_file

_GLOB_CHARS = frozenset("*?[")


def _expand(patterns: Sequence[str]) -> list[str]:
    """Expand glob patterns the shell left as is (bash passes an unmatched ``maps/*.json``)."""
    files: list[str] = []
    for pattern in patterns:
        if Path(pattern).exists() or not _GLOB_CHARS & set(pattern):
            files.append(pattern)
            continue
        matches = sorted(glob.glob(pattern))
        if not matches:
            print(f"warning: no files match {pattern}", file=sys.stderr)
        files += matches
    return files


def _validate(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    failed = 0
    for path in _expand(args.files):
        issues = validate_file(path, config)
        if issues:
            failed += 1
            print(f"FAIL {path}")
            for issue in issues:
                print(f"  {issue}")
        else:
            print(f"OK   {path}")
    return 1 if failed else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gow-maps", description="Offline map tools.")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="check map files, exit 1 on any problem")
    validate.add_argument("files", nargs="+", help="map JSON files (glob patterns allowed)")
    validate.add_argument("--config", help="validator thresholds (default: built-in validate.toml)")
    validate.set_defaults(handler=_validate)
    args = parser.parse_args(argv)
    handler = args.handler
    return int(handler(args))


if __name__ == "__main__":
    sys.exit(main())
