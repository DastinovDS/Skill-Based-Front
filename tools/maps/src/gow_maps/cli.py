"""Command line: `gow-maps validate`, `mirror`, `preview`, `bake`, `generate`, `score`.

`bake` of a map with an authored geography (DEC-36, `maps/src/<id>.geo.json`) also writes the
vector file `maps/geo/<id>.json`. `generate` writes the map of a seed and its geography (#771).
"""

import argparse
import glob
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from gow_maps import fairness
from gow_maps.bake import background_path, bake_background
from gow_maps.generate import generate, water_share_pct
from gow_maps.geo import bake_geography, find_spec, spec_path, vector_path
from gow_maps.mirror import HalfFormatError, dump_map, mirror_file
from gow_maps.preview import preview_path, render_preview
from gow_maps.validate import Issue, load_config, validate, validate_file
from gow_sim.maps import MapFormatError, load_map, parse_map
from gow_sim.ruleset import load_ruleset

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


def _report(path: str, issues: list[Issue]) -> bool:
    if not issues:
        print(f"OK   {path}")
        return True
    print(f"FAIL {path}")
    for issue in issues:
        print(f"  {issue}")
    return False


def _validate(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    rules = None if args.ruleset is None else load_ruleset(args.ruleset)
    results = [_report(path, validate_file(path, config, rules)) for path in _expand(args.files)]
    return 0 if all(results) else 1


def _mirror(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    try:
        mirror_file(args.half, args.output, config)
    except HalfFormatError as exc:
        print(f"FAIL {args.half}\n  [half] {exc}")
        return 1
    # The written map is validated right away; an invalid one stays on disk for inspection.
    return 0 if _report(args.output, validate_file(args.output, config)) else 1


def _preview(args: argparse.Namespace) -> int:
    ok = True
    for path in _expand(args.files):
        try:
            mapdef = load_map(path)
        except MapFormatError as exc:
            print(f"FAIL {exc}")
            ok = False
            continue
        out = preview_path(path)
        render_preview(mapdef, out)
        print(f"wrote {out}")
    return 0 if ok else 1


def _bake(args: argparse.Namespace) -> int:
    ok = True
    for path in _expand(args.files):
        try:
            mapdef = load_map(path)
            out = background_path(path)
            spec = find_spec(path)
            if spec is None:  # a land-only map (DEC-27, item 3)
                bake_background(mapdef, out, args.seed)
            else:  # a map with a geography (DEC-36): water, and the vector file for the client
                bake_geography(mapdef, spec, out, vector_path(path), args.seed)
                print(f"wrote {vector_path(path)}")
        except (MapFormatError, ValueError) as exc:
            print(f"FAIL {path}\n  {exc}")
            ok = False
            continue
        print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0 if ok else 1


def _generate(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    rules = None if args.ruleset is None else load_ruleset(args.ruleset)
    try:
        made = generate(args.seed, config)
    except ValueError as exc:
        print(f"FAIL seed {args.seed}\n  {exc}")
        return 1
    mapdef = parse_map(made.data)
    path = Path(args.output) / f"{mapdef.meta.name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_map(made.data), encoding="utf-8")
    spec = spec_path(path)
    spec.parent.mkdir(parents=True, exist_ok=True)
    spec.write_text(dump_geography(made.geo), encoding="utf-8")
    size = (mapdef.meta.width, mapdef.meta.height)
    points = [(n.x, n.y) for n in mapdef.nodes]
    print(
        f"wrote {path} and {spec}: {made.archetype}, {len(mapdef.nodes)} nodes,"
        f" {len(mapdef.edges)} roads, {size[0]} x {size[1]}, about"
        f" {water_share_pct(size, made.geo['water'], points)}% water,"
        f" attempt {made.attempts}"
    )
    print(fairness.describe(made.scores))
    if not args.bake:  # the geography needs the bake: the rest of the checks can run now
        return 0 if _report(str(path), validate(mapdef, config, rules)) else 1
    ok = _bake(argparse.Namespace(files=[str(path)], seed=None)) == 0
    render_preview(mapdef, preview_path(path))
    return 0 if _report(str(path), validate_file(path, config, rules)) and ok else 1


def dump_geography(data: dict[str, Any]) -> str:
    """The authored-style geography, one water cell or river per line, like the hand-made ones."""

    def rows(items: list[Any]) -> str:
        return ",\n".join(f"    {json.dumps(item)}" for item in items)

    return (
        f'{{\n  "map": {json.dumps(data["map"])},\n'
        f'  "water": [\n{rows(data["water"])}\n  ],\n'
        f'  "rivers": [\n{rows(data["rivers"])}\n  ]\n}}\n'
    )


def _score(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    for path in _expand(args.files):
        scores = fairness.score(load_map(path), config)
        print(path)
        print(fairness.describe(scores))
        for message in fairness.check(scores, config):
            print(f"  over a threshold: {message}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gow-maps", description="Offline map tools.")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="check map files, exit 1 on any problem")
    validate.add_argument("files", nargs="+", help="map JSON files (glob patterns allowed)")
    validate.add_argument("--config", help="validator thresholds (default: built-in validate.toml)")
    validate.add_argument(
        "--ruleset", help="also check the start stocks against its warehouses (DEC-26, item 5)"
    )
    validate.set_defaults(handler=_validate)
    mirror = commands.add_parser("mirror", help="build a rot180 map from a half and validate it")
    mirror.add_argument("half", help="half map, maps/src/<name>.half.json")
    mirror.add_argument("-o", "--output", required=True, help="full map to write, maps/<name>.json")
    mirror.add_argument("--config", help="validator thresholds (default: built-in validate.toml)")
    mirror.set_defaults(handler=_mirror)
    preview = commands.add_parser("preview", help="draw maps/<id>.preview.png next to each map")
    preview.add_argument("files", nargs="+", help="map JSON files (glob patterns allowed)")
    preview.set_defaults(handler=_preview)
    bake = commands.add_parser("bake", help="draw the background maps/<id>.bg.webp of each map")
    bake.add_argument("files", nargs="+", help="map JSON files (glob patterns allowed)")
    bake.add_argument(
        "--seed", type=int, help="noise seed (default: derived from the map name and version)"
    )
    bake.set_defaults(handler=_bake)
    gen = commands.add_parser("generate", help="make the map of a seed, outside the pool (#771)")
    gen.add_argument("--seed", type=int, required=True, help="the map id is gen<version>-<seed>")
    gen.add_argument("-o", "--output", default="maps/gen", help="folder (default: maps/gen)")
    gen.add_argument("--bake", action="store_true", help="also bake, preview and check geography")
    gen.add_argument("--config", help="validator thresholds (default: built-in validate.toml)")
    gen.add_argument("--ruleset", help="also check the start stocks against its warehouses")
    gen.set_defaults(handler=_generate)
    scores = commands.add_parser("score", help="print the fairness scores of maps (#771)")
    scores.add_argument("files", nargs="+", help="map JSON files (glob patterns allowed)")
    scores.add_argument("--config", help="validator thresholds (default: built-in validate.toml)")
    scores.set_defaults(handler=_score)
    args = parser.parse_args(argv)
    handler = args.handler
    return int(handler(args))


if __name__ == "__main__":
    sys.exit(main())
