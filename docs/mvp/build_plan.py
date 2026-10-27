"""Validate issues.yaml and render MVP_PLAN.md, MVP_ISSUES.md, issues.json."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

data = yaml.safe_load((HERE / "issues.yaml").read_text(encoding="utf-8"))
meta = data["meta"]
milestones = {m["id"]: m for m in data["milestones"]}
ms_order = [m["id"] for m in data["milestones"]]
issues = data["issues"]
by_id = {i["id"]: i for i in issues}
SIZE_DAYS = meta["size_days"]
BASE = datetime(2026, 1, 1)
PRIO_RANK = {"P0": 0, "P1": 1, "P2": 2}

errors: list[str] = []
warnings: list[str] = []


def prio(i: dict) -> str:
    return next(l for l in i["labels"] if l in PRIO_RANK)


# ── structural validation ──────────────────────────────────────────
seen: set[str] = set()
for i in issues:
    iid = i["id"]
    if iid in seen:
        errors.append(f"duplicate id {iid}")
    seen.add(iid)
    for field in ("title", "milestone", "labels", "size", "track", "depends", "acceptance"):
        if field not in i:
            errors.append(f"{iid}: missing {field}")
    if i.get("milestone") not in milestones:
        errors.append(f"{iid}: unknown milestone {i.get('milestone')}")
    if i.get("size") not in SIZE_DAYS:
        errors.append(f"{iid}: bad size {i.get('size')}")
    if i.get("track") not in meta["tracks"]:
        errors.append(f"{iid}: bad track {i.get('track')}")
    prios = [l for l in i.get("labels", []) if l in PRIO_RANK]
    if len(prios) != 1:
        errors.append(f"{iid}: needs exactly one priority label")
    if not any(l.startswith("area:") for l in i.get("labels", [])):
        errors.append(f"{iid}: needs area label")
    if not any(l.startswith("type:") for l in i.get("labels", [])):
        errors.append(f"{iid}: needs type label")
    if "type:decision" in i.get("labels", []) and i["id"].startswith("DEC") and "default" not in i:
        errors.append(f"{iid}: decision without default")
    if not i.get("acceptance"):
        errors.append(f"{iid}: empty acceptance")
    if "type:decision" not in i.get("labels", []) and not i.get("tasks"):
        errors.append(f"{iid}: no tasks")
    for ref in i.get("depends", []) + i.get("related", []):
        if ref not in by_id:
            errors.append(f"{iid}: unknown ref {ref}")
        if ref == iid:
            errors.append(f"{iid}: self reference")

# ── cycle check + topo order ──────────────────────────────────────
order: list[str] = []
state: dict[str, int] = {}


def visit(n: str, stack: list[str]) -> None:
    if state.get(n) == 2:
        return
    if state.get(n) == 1:
        errors.append("cycle: " + " -> ".join(stack + [n]))
        return
    state[n] = 1
    for d in by_id[n]["depends"]:
        if d in by_id:
            visit(d, stack + [n])
    state[n] = 2
    order.append(n)


for i in issues:
    visit(i["id"], [])

# ── semantic warnings ──────────────────────────────────────────────
for i in issues:
    for d in i["depends"]:
        if d not in by_id:
            continue
        dep = by_id[d]
        if ms_order.index(dep["milestone"]) > ms_order.index(i["milestone"]):
            errors.append(f"{i['id']} ({i['milestone']}) depends on later {d} ({dep['milestone']})")
        if PRIO_RANK[prio(dep)] > PRIO_RANK[prio(i)]:
            errors.append(f"{i['id']} ({prio(i)}) depends on lower-priority {d} ({prio(dep)})")
    if i["size"] == "L":
        warnings.append(f"{i['id']}: size L — consider splitting")

if errors:
    print("ERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

# ── scheduling (ideal person-days, 2 devs: A and B; 'any' goes to whoever is free) ──
dur = {i["id"]: SIZE_DAYS[i["size"]] for i in issues}
# critical path (longest path by duration) ignoring resources
ef: dict[str, float] = {}
pred: dict[str, str | None] = {}
for n in order:
    deps = by_id[n]["depends"]
    if deps:
        best = max(deps, key=lambda d: ef[d])
        ef[n] = ef[best] + dur[n]
        pred[n] = best
    else:
        ef[n] = dur[n]
        pred[n] = None
end = max(ef, key=lambda n: ef[n])
crit: list[str] = []
cur: str | None = end
while cur:
    crit.append(cur)
    cur = pred[cur]
crit.reverse()

# resource-constrained list scheduling
free = {"A": 0.0, "B": 0.0}
finish: dict[str, float] = {}
start: dict[str, float] = {}
assigned: dict[str, str] = {}
remaining = set(by_id)
# priority: milestone order, then P-rank, then topo order
topo_index = {n: k for k, n in enumerate(order)}
succ: dict[str, list[str]] = defaultdict(list)
for i in issues:
    for d in i["depends"]:
        succ[d].append(i["id"])
tail: dict[str, float] = {}
for n in reversed(order):
    tail[n] = dur[n] + max([tail[x] for x in succ[n]] + [0.0])
while remaining:
    ready = [n for n in remaining if all(d in finish for d in by_id[n]["depends"])]
    best = None
    for n in ready:
        earliest = max([finish[d] for d in by_id[n]["depends"]] + [0.0])
        tr = by_id[n]["track"]
        for dev in (["A", "B"] if tr == "any" else [tr]):
            s0 = max(free[dev], earliest)
            key = (s0, -tail[n], ms_order.index(by_id[n]["milestone"]), topo_index[n], dev)
            if best is None or key < best[0]:
                best = (key, n, dev, s0)
    _, n, dev, s0 = best
    start[n] = s0
    finish[n] = s0 + dur[n]
    free[dev] = finish[n]
    assigned[n] = dev
    remaining.remove(n)

total_days = sum(dur.values())
makespan = max(finish.values())
p0_days = sum(dur[i["id"]] for i in issues if prio(i) == "P0")

# ── helpers for rendering ─────────────────────────────────────────
PRIO_TEXT = {"P0": "P0: required for the MVP", "P1": "P1: desirable in the MVP", "P2": "P2: can be postponed"}


def md_list(items: list[str], checkbox: bool = False) -> str:
    pre = "- [ ] " if checkbox else "- "
    return "\n".join(pre + x for x in items)


def issue_body(i: dict, numbers: dict[str, int] | None = None) -> str:
    def ref(x: str) -> str:
        if numbers and x in numbers:
            return f"{x} (#{numbers[x]})"
        return x

    m = milestones[i["milestone"]]
    lines = [
        f"**Milestone:** {m['title']} · **Priority:** {prio(i)} · **Size:** {i['size']} ({meta['sizes'][i['size']]}) · **Track:** {i['track']}",
    ]
    if i["depends"]:
        lines.append("**Depends on:** " + ", ".join(ref(d) for d in i["depends"]))
    if i.get("related"):
        lines.append("**Related:** " + ", ".join(ref(d) for d in i["related"]))
    lines.append("")
    if i.get("context"):
        lines += ["### Context", i["context"].strip(), ""]
    if i.get("default"):
        lines += ["### Default decision", i["default"].strip(), ""]
    if i.get("alternatives"):
        lines += ["### Alternatives", md_list(i["alternatives"]), ""]
    if i.get("tasks"):
        lines += ["### Tasks", md_list(i["tasks"], checkbox=True), ""]
    if i.get("notes"):
        lines += ["### Values and notes", i["notes"].strip(), ""]
    lines += ["### Acceptance criteria", md_list(i["acceptance"], checkbox=True), ""]
    if i.get("out_of_scope"):
        lines += ["### Out of scope", md_list(i["out_of_scope"]), ""]
    if "type:decision" in i["labels"] and i["id"].startswith("DEC"):
        lines += [
            "### How to close",
            "A default value already exists, so the decision takes a couple of hours at most: confirm it "
            "or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. "
            "It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.",
            "",
        ]
    lines += ["---", "Definition of Done: see `AGENTS.md`, section \"Definition of Done\"."]
    return "\n".join(lines)


def title(i: dict) -> str:
    return f"[{i['id']}] {i['title']}"


# ── MVP_ISSUES.md ─────────────────────────────────────────────────
parts = [f"# {meta['title']}: issues", "",
         "> Generated from `issues.yaml`. Each block is a ready GitHub issue body; "
         "the issue title is the `### [ID] ...` line.", ""]
for mid in ms_order:
    m = milestones[mid]
    parts += [f"## {m['title']}", "", f"*{m['goal']}*", ""]
    for i in [x for x in issues if x["milestone"] == mid]:
        labels = " ".join(f"`{l}`" for l in i["labels"] + [f"size:{i['size']}"])
        parts += [f"### {title(i)}", "", f"Labels: {labels}", "", issue_body(i), ""]
(OUT / "MVP_ISSUES.md").write_text("\n".join(parts), encoding="utf-8")

# ── MVP_PLAN.md ───────────────────────────────────────────────────
ms_stats = defaultdict(lambda: {"n": 0, "days": 0.0, "p0": 0})
for i in issues:
    s = ms_stats[i["milestone"]]
    s["n"] += 1
    s["days"] += dur[i["id"]]
    s["p0"] += prio(i) == "P0"

track_days = defaultdict(float)
for n, dev in assigned.items():
    track_days[dev] += dur[n]

plan: list[str] = []
plan += [f"# {meta['title']}", ""]
plan += ["## What the MVP is", "", meta["mvp_definition"], ""]
plan += [
    "## What is not in the MVP",
    "",
    md_list([
        "Players building new edges (mechanics.md section 8): after the MVP.",
        "The delivery modes \"packets / pump-up\", trophies from warehouses, vision based on group size.",
        "Fallback rule models (concave economy, VP threshold, a bonus for the final hold): implemented only if BAL-02 requires them.",
        "Procedural map generation (hand-made maps and a mirroring script only), Ukrainian localization.",
        "FFA and team modes; 1v1 only.",
        "Full accounts and OAuth: only a guest identity with an \"upgrade\" option later.",
        "Steam, mobile devices, chat, live spectators, tournaments, monetization.",
        "A map editor with an interface: CLI tools only.",
    ]),
    "",
]
plan += [
    "## Main principles of the plan",
    "",
    md_list([
        "**Mechanics first, then pixels and the meta game.** The balance gate BAL-02 checks the depth of the mechanics with bots, the internal playtest PT-01 checks it with humans. Client polish (CLI-12, CLI-13) depends on BAL-02, the whole meta game (M5) depends on PT-01.",
        "**The rules are specified down to the level of tests.** Combat is defined by a table of worked examples (DEC-07); the SIM-09 tests are exactly this table.",
        "**Open questions are closed early and fast.** Every DEC issue already has a default value; confirming it takes a couple of hours and is needed before SIM-01. After that the numbers change only by editing the ruleset.",
        "**Numbers are data.** All rule parameters live in `rulesets/*.toml`; balancing is editing a file and rerunning the tournament.",
        "**Two parallel tracks.** Track A (Python) carries the simulation, the bots and the server; track B (TypeScript and tools) carries the maps, the client and the infrastructure. The client starts on map data before the protocol is ready (CLI-03).",
        "**Every issue is at most 5 days and has verifiable acceptance criteria.**",
    ]),
    "",
]
plan += ["## Milestones", "", "| Milestone | Goal | Issues | P0 | Estimate, person-days |", "|---|---|---|---|---|"]
for mid in ms_order:
    m = milestones[mid]
    s = ms_stats[mid]
    plan.append(f"| **{m['title']}** | {m['goal']} | {s['n']} | {s['p0']} | {s['days']:g} |")
plan.append(f"| **Total** | | {len(issues)} | {sum(1 for i in issues if prio(i)=='P0')} | {total_days:g} |")
plan.append("")
plan += ["### Milestone exit criteria", ""]
for mid in ms_order:
    m = milestones[mid]
    plan += [f"**{m['title']}**", "", md_list(m["exit"]), ""]

plan += [
    "## Schedule estimate",
    "",
    f"- Total: **{total_days:g} ideal person-days** ({len(issues)} issues), of which P0 is {p0_days:g}.",
    f"- With two developers working in parallel on the tracks, the estimated duration is **about {makespan:.0f} working days** "
    f"(track A: {track_days['A']:g} days, track B: {track_days['B']:g} days).",
    "- These are \"ideal\" full-time days. For work in evenings and weekends multiply by 2-3; leave a reserve for balance iterations (BAL-02) and the playtest (PT-01).",
    f"- The closed playtest (REL-01) ends on **about day {finish['REL-01']:.0f}**; after it only P1/P2 tasks remain in the estimate, and the release does not depend on them.",
    f"- The critical path through the dependencies, not counting people, is {ef[end]:g} days:",
    "",
    "  " + " → ".join(crit),
    "",
]

# mermaid gantt from schedule
plan += ["## Estimated schedule", "", "The layout over the two tracks (day 0 is the start). "
         "Developer A is the Python track, B is TypeScript and tools; issues with the track `any` go to whoever is free earlier.", "",
         "```mermaid", "gantt", "  title MVP plan (ideal days from the start)", "  dateFormat YYYY-MM-DD HH:mm", "  axisFormat %j"]
for dev in ("A", "B"):
    plan.append(f"  section Developer {dev}")
    for n in sorted([n for n in assigned if assigned[n] == dev], key=lambda n: start[n]):
        t0 = BASE + timedelta(hours=start[n] * 24)
        plan.append(f"  {n} : {n.lower().replace('-', '')}, {t0:%Y-%m-%d %H:%M}, {int(dur[n] * 24)}h")
plan += ["```", "", "*The axis is the number of the ideal working day (001 is the first day). The calendar dates are nominal.*", ""]

plan += [
    "## Risks and how we reduce them",
    "",
    "| Risk | Sign | What we do |",
    "|---|---|---|",
    "| The mechanics turn out flat | BAL-02 does not pass within the timebox, or PT-01 gives \"no-go\" | Stop M5; discuss the postponed mechanics (new edges, vision based on size, fallback rule models) |",
    "| The code favors one side | A side advantage in the BOT-05 report | Two-phase movement, symmetric fights (DEC-07), the mirror test in SIM-05 |",
    "| Python is too slow for the tournament or the server | SIM-14 does not fit the step budget | Profiling; simplifying supply routing; a capacity cache; as a last resort, hot functions in Cython/mypyc |",
    "| The TypeScript learning curve of developer B | CLI issues take twice as long | Do CLI-03 (the map from JSON) in parallel with the network layer; keep the client \"dumb\"; pair review |",
    "| Too few players for matchmaking | The queue is empty | A bot opponent (SRV-06), invites and the lobby as the main path; the queue is secondary |",
    "| Scope growth from the open questions | New mechanics ask to get into the MVP | Everything new goes behind a ruleset flag and only after BAL-02 |",
    "| Fog of war leaks | QA-04 or players find hidden data in the WebSocket | A single `project()` function, the property tests of SIM-14 and SIM-17, the QA-04 audit |",
    "",
]

plan += ["## List of issues", ""]
for mid in ms_order:
    m = milestones[mid]
    plan += [f"### {m['title']}", "", "| ID | Task | Priority | Size | Track | Depends on |", "|---|---|---|---|---|---|"]
    for i in [x for x in issues if x["milestone"] == mid]:
        deps = ", ".join(i["depends"]) or "-"
        plan.append(f"| {i['id']} | {i['title']} | {prio(i)} | {i['size']} | {i['track']} | {deps} |")
    plan.append("")

plan += [
    "## How to create the issues on GitHub",
    "",
    "The issues already exist in `DastinovDS/Skill-Based-Front`; the mapping of ID to issue number is in `docs/mvp/issue_map.json`. A rerun is needed only after the plan is edited.",
    "",
    "1. Install and authorize the GitHub CLI: `gh auth login`.",
    "2. Check the plan without changes: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front` (dry run by default).",
    "3. Create the labels, milestones and issues: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front --apply`.",
    "4. The script is idempotent: issues that already exist (by the `[ID]` prefix in the title) are skipped; in the second pass the references like `SIM-03` in the bodies are completed with the real numbers `#NN`. The mapping is saved in `docs/mvp/issue_map.json`.",
    "5. Branches are `feature/<number>-<slug>`, commits are `<type>(<scope>): <message> (#<number>)` (see AGENTS.md).",
    "",
]
(OUT / "MVP_PLAN.md").write_text("\n".join(plan), encoding="utf-8")

# ── issues.json (for importer) ────────────────────────────────────
LABEL_COLORS = {
    "area:": "1d76db", "type:": "5319e7", "P0": "b60205", "P1": "fbca04", "P2": "c5def5", "size:": "0e8a16",
}


def color(label: str) -> str:
    for k, v in LABEL_COLORS.items():
        if label.startswith(k):
            return v
    return "ededed"


all_labels = sorted({l for i in issues for l in i["labels"]} | {f"size:{s}" for s in SIZE_DAYS})
export = {
    "milestones": [{"id": m["id"], "title": m["title"], "description": m["goal"]} for m in data["milestones"]],
    "labels": [{"name": l, "color": color(l)} for l in all_labels],
    "issues": [
        {
            "id": i["id"],
            "title": title(i),
            "milestone": milestones[i["milestone"]]["title"],
            "labels": i["labels"] + [f"size:{i['size']}"],
            "depends": i["depends"],
            "related": i.get("related", []),
            "raw": i,
        }
        for i in (by_id[n] for n in order)  # topological order
    ],
}
(OUT / "issues.json").write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")

# body template needs the renderer; store pre-rendered bodies without numbers too
for e in export["issues"]:
    e["body"] = issue_body(e["raw"])
    del e["raw"]
(OUT / "issues.json").write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"OK: {len(issues)} issues, {total_days:g} person-days, makespan ≈ {makespan:.1f} days")
print(f"tracks: A={track_days['A']:g}, B={track_days['B']:g}")
for dev in ("A","B"):
    seq=sorted([n for n in assigned if assigned[n]==dev], key=lambda n:start[n])
    t=0.0; gaps=[]
    for n in seq:
        if start[n]>t+1e-9: gaps.append((round(t,2),round(start[n],2),n))
        t=finish[n]
    print(dev, "idle gaps:", gaps)
print("critical path:", " -> ".join(crit), f"({ef[end]:g} d)")
for w in warnings:
    print("WARN", w)
