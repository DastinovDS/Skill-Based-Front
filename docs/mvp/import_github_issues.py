#!/usr/bin/env python3
"""Import the MVP plan (issues.json) into GitHub Issues using the GitHub CLI (`gh`).

Usage:
    python import_github_issues.py --repo DastinovDS/Skill-Based-Front            # dry run: shows what would happen
    python import_github_issues.py --repo DastinovDS/Skill-Based-Front --apply    # creates labels, milestones, issues

What it does (idempotent — safe to re-run):
  1. Creates or updates labels (area:*, type:*, P0/P1/P2, size:*).
  2. Creates missing milestones (M0 … M6).
  3. Creates missing issues in dependency order. An issue counts as existing if an issue
     whose title starts with "[ID]" already exists (open or closed).
  4. Rewrites issue bodies so that plan IDs ("SIM-03") also show the real number ("SIM-03 (#91)").
The mapping ID → issue number is saved to issue_map.json next to issues.json.

Requirements: Python 3.9+, GitHub CLI installed and authenticated (`gh auth login`).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8")
    if check and proc.returncode != 0:
        sys.exit(f"command failed: {' '.join(args)}\n{proc.stderr.strip()}")
    return proc


def gh_json(args: list[str]) -> object:
    out = run(["gh", *args]).stdout.strip()
    return json.loads(out) if out else []


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, help="OWNER/NAME, e.g. DastinovDS/Skill-Based-Front")
    ap.add_argument("--file", default=str(Path(__file__).with_name("issues.json")), help="path to issues.json")
    ap.add_argument("--apply", action="store_true", help="actually create things (default: dry run)")
    ap.add_argument("--only", nargs="*", help="limit to these plan IDs (e.g. INF-01 SIM-01)")
    ap.add_argument("--delay", type=float, default=0.7, help="seconds between write calls (rate limits)")
    ns = ap.parse_args()

    plan = json.loads(Path(ns.file).read_text(encoding="utf-8"))
    issues = plan["issues"]
    if ns.only:
        wanted = set(ns.only)
        issues = [i for i in issues if i["id"] in wanted]
    all_ids = [i["id"] for i in plan["issues"]]
    map_path = Path(ns.file).with_name("issue_map.json")

    print(f"Plan: {len(plan['labels'])} labels, {len(plan['milestones'])} milestones, {len(issues)} issues → {ns.repo}")
    if not ns.apply:
        print("DRY RUN — nothing will be changed. Add --apply to execute.\n")

    have_gh = shutil.which("gh") is not None
    if ns.apply and not have_gh:
        sys.exit("GitHub CLI `gh` not found. Install it: https://cli.github.com/")
    if have_gh:
        if run(["gh", "auth", "status"], check=False).returncode != 0:
            if ns.apply:
                sys.exit("`gh` is not authenticated. Run: gh auth login")
            print("note: `gh` is not authenticated; dry run continues without reading the repository.\n")
            have_gh = False

    # ── existing state ────────────────────────────────────────────
    existing_ms: set[str] = set()
    existing_issues: dict[str, int] = {}
    if have_gh:
        ms = gh_json(["api", f"repos/{ns.repo}/milestones?state=all&per_page=100"])
        existing_ms = {m["title"] for m in ms}  # type: ignore[index]
        lst = gh_json(["issue", "list", "--repo", ns.repo, "--state", "all", "--limit", "2000", "--json", "number,title"])
        for it in lst:  # type: ignore[union-attr]
            m = re.match(r"^\[([A-Z]+-\d+)\]", it["title"])
            if m:
                existing_issues[m.group(1)] = it["number"]
    saved: dict[str, int] = json.loads(map_path.read_text(encoding="utf-8")) if map_path.exists() else {}
    numbers: dict[str, int] = {**saved, **existing_issues}

    # ── 1. labels ─────────────────────────────────────────────────
    print("Labels:")
    for lab in plan["labels"]:
        print(f"  create/update {lab['name']}")
        if ns.apply:
            run(["gh", "label", "create", lab["name"], "--repo", ns.repo, "--color", lab["color"], "--force"])

    # ── 2. milestones ─────────────────────────────────────────────
    print("Milestones:")
    for m in plan["milestones"]:
        if m["title"] in existing_ms:
            print(f"  exists  {m['title']}")
            continue
        print(f"  create  {m['title']}")
        if ns.apply:
            run(["gh", "api", "-X", "POST", f"repos/{ns.repo}/milestones",
                 "-f", f"title={m['title']}", "-f", f"description={m['description']}"])
            time.sleep(ns.delay)

    # ── 3. issues ─────────────────────────────────────────────────
    print("Issues:")
    for it in issues:
        if it["id"] in existing_issues:
            print(f"  exists  #{existing_issues[it['id']]} {it['title']}")
            continue
        print(f"  create  {it['title']}")
        if not ns.apply:
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(it["body"])
            body_file = f.name
        args = ["gh", "issue", "create", "--repo", ns.repo, "--title", it["title"],
                "--body-file", body_file, "--milestone", it["milestone"]]
        for lab in it["labels"]:
            args += ["--label", lab]
        out = run(args).stdout.strip()
        Path(body_file).unlink(missing_ok=True)
        m = re.search(r"/issues/(\d+)", out)
        if not m:
            sys.exit(f"could not parse issue number from: {out}")
        numbers[it["id"]] = int(m.group(1))
        map_path.write_text(json.dumps(numbers, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"          → #{numbers[it['id']]}")
        time.sleep(ns.delay)

    # ── 4. cross-references ───────────────────────────────────────
    if ns.apply:
        print("Linking references:")
        id_re = re.compile(r"\b(" + "|".join(re.escape(x) for x in sorted(all_ids, key=len, reverse=True)) + r")\b(?! \(#)")
        for it in issues:
            num = numbers.get(it["id"])
            if num is None:
                continue
            body = id_re.sub(lambda mm: f"{mm.group(1)} (#{numbers[mm.group(1)]})" if mm.group(1) in numbers else mm.group(1), it["body"])
            if body == it["body"]:
                continue
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
                f.write(body)
                body_file = f.name
            run(["gh", "issue", "edit", str(num), "--repo", ns.repo, "--body-file", body_file])
            Path(body_file).unlink(missing_ok=True)
            print(f"  #{num} {it['id']}")
            time.sleep(ns.delay)
        print(f"\nDone. Mapping saved to {map_path}")
    else:
        print("\nDry run finished.")


if __name__ == "__main__":
    main()
