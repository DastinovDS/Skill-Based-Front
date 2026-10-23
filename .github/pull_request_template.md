Closes #

<!-- Branch: feature/<number>-<slug> (fixes: fix/<number>-<slug>) from develop.
     Commits: <type>(<scope>): <message> (#<number>). Details: AGENTS.md, section 11. -->

### What was done
- 

### Acceptance criteria
<!-- Copy the criteria from the issue and tick them. An unmet criterion: no tick, with a reason. -->
- [ ] 

### Deviations, questions, new dependencies
<!-- Deviations from the issue; questions filed as issues (# TODO(#N) in the code);
     the justification of every new Python or npm dependency. If none: "none". -->

### Definition of Done
- [ ] All acceptance criteria of the issue are met and ticked in the PR.
- [ ] CI is green: ruff, pyright strict, lint-imports, pytest, lint and check of the client, Vitest, protocol drift.
- [ ] New rules are covered by tests with expected values from mechanics.md.
- [ ] When rules or the protocol change, versions are raised and artifacts are regenerated (section 10).
- [ ] mechanics.md, AGENTS.md or the README are updated if behavior or commands changed.
- [ ] There is no `TODO` without an issue number in the code.

<!-- After the merge: in this repository `Closes #N` does not close the issue automatically.
     Close it by hand: gh issue close <N> --comment "Done in #<PR>". -->
