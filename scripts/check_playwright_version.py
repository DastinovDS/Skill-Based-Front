"""Fail when the Playwright container tag of ci.yml differs from the lockfiles' Playwright version.

The job `visual` runs in `mcr.microsoft.com/playwright:v<version>-noble`; its browsers match only
the Playwright of the lockfiles (apps/client and e2e), so the three move together.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    tags = set(re.findall(r"mcr\.microsoft\.com/playwright:v([\d.]+)-", ci))
    versions: dict[str, set[str]] = {}
    for lock in ("apps/client/pnpm-lock.yaml", "e2e/pnpm-lock.yaml"):
        text = (ROOT / lock).read_text(encoding="utf-8")
        versions[lock] = set(re.findall(r"^  playwright@([\d.]+):", text, re.MULTILINE))
    errors = [f"{lock}: Playwright {sorted(v)}" for lock, v in versions.items() if len(v) != 1]
    all_versions: set[str] = set()
    for found in versions.values():
        all_versions |= found
    if not tags:
        errors.append("ci.yml: no mcr.microsoft.com/playwright image tag found")
    elif tags != all_versions or len(all_versions) != 1:
        errors.append(
            f"ci.yml image tags {sorted(tags)} differ from lockfile versions {sorted(all_versions)}"
        )
    if errors:
        print(
            "Playwright version mismatch (the image tag in ci.yml and the lockfiles move together):"
        )
        print("\n".join(f"  {e}" for e in errors))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
