# Toolkit for working with the MVP plan

- `issues.json` + `import_github_issues.py`: import of issues, labels and milestones into GitHub:
  `python import_github_issues.py --repo DastinovDS/Skill-Based-Front` (dry run), then with `--apply`.
  The issues already exist; the mapping of ID to issue number: `issue_map.json`.
  An authorized GitHub CLI is required (`gh auth login`).
- `issues.yaml`: the only source of the plan. After edits:
  `pip install pyyaml && python build_plan.py` checks the dependency graph (cycles, priorities,
  milestone order), recomputes the estimate and the schedule and rewrites `out/MVP_PLAN.md`, `out/MVP_ISSUES.md`, `out/issues.json`.
  `out/` is not committed (gitignored); the committed `MVP_PLAN.md`, `MVP_ISSUES.md` and `issues.json` in this directory are copies of the generated files.
