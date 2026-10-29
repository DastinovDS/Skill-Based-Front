# Orchestration: rules for orchestrator sessions

A document for an AI session that **plans the work and launches executor agents**, while the executors do all the work with the repository.
The repository rules (`AGENTS.md`) are mandatory for both the orchestrator and the agents; this document covers only how the work is organized.
An executor needs only the brief and `AGENTS.md`; it does not need to read this document.

---

## 1. Roles

| Who | Decides and does | Does not do |
|---|---|---|
| Owner | the scope of work, design and game rules, priorities, manual checks (the game, hardware, legal questions) | does not choose the model or the number of agents |
| Orchestrator | the plan and the task queue, the model and parallelism, briefs, checking results against external state (`git`, `gh`, CI), answers to the owner | does not change the repository or GitHub (code, documents, issues, PRs, merging, rebuilding the stack) |
| Executor agent | all work with the repository and GitHub: code, documents, issues, comments, PRs, merging, closing issues | does not decide design questions: it turns an ambiguity into a question (`AGENTS.md`, section 0, item 3) |

- **Language.** The repository and GitHub are English only: code, identifiers, comments, commits, documents, issues, PRs and review comments. Briefs to agents are written in English. The orchestrator talks to the owner in the owner's language (outside the repository); everything the orchestrator asks an agent to write down goes into the repository in English.
- The orchestrator reads code to answer the owner (analyzing a bug, what a function does) but does not write it.
- Do not launch an agent for every trifle: put small repository edits into the brief of the nearest agent. Give truly simple things to Haiku.
- Check the state of work from outside: `git log`, `git worktree list`, `gh pr list`, `gh pr checks`. Not from agents' retellings or their transcripts.
- If the owner said "for now we are only discussing", do not launch agents: end the answer with a list of open questions and a recommendation for each.
- Cost decisions that exceed the remaining limit and questions of scope and design go to the owner. The rest (model, parallelism) the orchestrator decides itself: it announces what it launches and why, and does not ask.

---

## 2. Choosing a model

| Model | For what |
|---|---|
| Opus | simulation, rules, protocol, bots, DEC documents where design is still needed (open questions, new rule models) |
| Sonnet | the client (interface, PixiJS, Svelte), documents with decisions already accepted, recording accepted DECs, a small server task, merging, cleanup, fixing tests |
| Haiku | trivial edits of issues and checklists, renames, small text edits, rebuilding the stack from instructions, read-only analysis (replays, brainstorms) |

Parallelism: by default one Opus and one Sonnet. Two Opus at once quickly burn through the five-hour window. When the window is about half used, launch only small Sonnet tasks.

---

## 3. Budget

The limits (the five-hour window and the weekly one) are real; running out stops work until the reset.

| Rule | How |
|---|---|
| Price before launch | the launch message names the expected price in percent of the weekly limit |
| Guides | a rules task on Opus: 10-20%; a client package on Sonnet: 4-6%; documents: 1-3%; a small thing on Haiku: under 1% |
| When | put heavy Opus work at the start of the week |
| Soft thresholds | around 75% of the week: warn the owner and offer cheaper options; around 90%: recommend urgent bugs only; the owner decides |
| Idle agent | do not resume an agent that has been idle for more than an hour: the cache has gone cold, resuming reads the whole history again at full price; launch a new one with the note from the PR (section 4) |
| Cut-off | resume an agent cut off by a limit right after the reset if less than an hour has passed; otherwise launch a new one |
| Orchestrator context | at a large context (around 300 thousand tokens) propose a new session: the state lives in issues and notes (section 8) |
| Reading | the brief names exact sections; do not read `mechanics.md` in full (about 2000 lines), read `AGENTS.md` in full only where the task needs it |

The limits and thresholds are soft: there are no hard daily quotas.

---

## 4. Brief template for an agent

The brief is short. It names the task, the sections to read and the specifics; the general way of working comes from section 5 of this document and `AGENTS.md`. **Briefs are written in English.**

```
Task: issue #<N> (<title>). One PR.
Read: AGENTS.md sections 0, 3, 11 (+ <needed sections>);
      docs/design/mechanics.md only sections <numbers and titles>, do not read it in full;
      the whole issue.
What to do: <briefly; take the acceptance criteria from the issue>.
Out of scope: <what not to touch>.
Expected test values: from mechanics.md and the DEC tables, not from the code's output.
Specifics: <dependencies, versions, neighbouring PRs, what must not be touched>.
Process: work autonomously, do not ask the owner questions; workflow per docs/process/orchestration.md, section 5.
Report: for each issue: number, PR URL, merged or not, acceptance criteria, deviations,
new issues; then QUESTIONS (questions you are waiting for a decision on) and RISKS (risks, assumptions).
```

Brief rules:

- **One Opus agent: one task and one PR.** Cut big packages up instead of handing them to one agent.
- **A rules change:** simulation, protocol and bots are done by Opus; the **client part** of the change is done by a separate Sonnet agent **after the merge** of the server part.
- **Early push.** The agent pushes WIP early and often, so a limit cut-off erases nothing.
- **A note in the PR.** On every WIP push the agent updates the block "done / left / next step" in the PR description. A new agent continues from this note.
- **Tests.** Expected values come from `mechanics.md` and the DEC tables (`AGENTS.md`, section 0, item 4).
- **The report** ends with the blocks `QUESTIONS:` and `RISKS:` (they may be empty). For tasks that need a human (a manual check, the owner's verdict) a block `MANUAL:` is added.
- If a brief has several issues, the agent does them strictly one after another, each in its own PR.
- **A task that changes the look:** the brief names the scenes of `visual/scenes.ts` the agent looks at before and after (`mise run shots`) and requires links to the frames in the PR (`AGENTS.md`, section 7.5). A major visual decision does not go into a brief until the owner has chosen a variant (section 7).

---

## 5. The agent's workflow

Details of branches and commits: `AGENTS.md`, section 11; commands of the checks: section 3.

1. Read the whole issue and the needed sections of `mechanics.md`. Keep the main checkout on `develop` and do no work in it.
2. `git fetch origin`, then a separate worktree and branch: `git worktree add ../<worktree-directory>/<ID> -b feature/<N>-<slug> origin/develop` (`fix/` for fixes).
3. Implement the tasks and acceptance criteria; run the applicable checks from `AGENTS.md`, section 3, and get them green.
4. Commits: `<type>(<scope>): <message> (#<N>)`, in English.
5. Before pushing: `git fetch && git rebase origin/develop` (other agents merge in parallel); on conflicts repeat the checks.
6. Push, then `gh pr create --base develop`: the description in English per the template `.github/pull_request_template.md`, with `Closes #<N>` (or `Refs #<N>` for a PR that must not close the issue: a docs-only or mockup PR of a decision issue, one step of a multi-step issue), the acceptance criteria with ticks (an unmet one without a tick and with a reason), deviations and the justification of new dependencies.
7. Wait for CI: `gh pr checks <PR> --watch`; fix what is red. The required checks are `py`, `web`, `docker`; in a documentation-only PR only `changes` may run.
8. Squash-merge only when the checks are green, do not enable auto-merge: `gh pr merge <PR> --squash --delete-branch --subject "<type>(<scope>): <message> (#<N>)"`. The commit into `develop` must be a conventional English commit. If you get the refusal "Base branch was modified": rebase, push, CI again, retry. If the command returned an error only because a worktree holds the local branch, check that the PR state is `MERGED`.
9. Only after `MERGED`: `Closes #N` closes the issue automatically; check it (`gh issue view <N>`) and close it by hand only if it is still open (`gh issue close <N> --comment "Done in #<PR>"`); remove the worktree and the local branch (`git worktree remove`, `git branch -D`); in the main checkout `git checkout develop && git pull --ff-only`.

### Parallel rules changes

Tasks that change rules collide on `SIM_VERSION`, `PROTOCOL_VERSION`, the protocol schema, the generated TS types and the golden directories `tests/golden/v*/`.

- Such tasks go **sequentially**.
- If they still overlap, whoever merges second does a rebase, **raises the versions again**, and regenerates the golden replays and types.
- Existing golden directories are never touched.

### Tasks that need a human

The agent does everything that can be automated or checked locally (scripts, a local run, checklists, runbooks), explicitly marks the manual remainder in the documents and lists it in `MANUAL:`. The operator's personal data is not invented: only explicit placeholders. For a yes-or-no decision from the owner the agent prepares the materials and a recommendation and leaves the decision field "awaiting the owner's decision".

---

## 6. Safety and environment

| Rule | Explanation |
|---|---|
| Other people's processes | do not stop, rebuild or change other people's processes, containers and the owner's working stack |
| Your own processes | stop only what you started yourself, by PID or id; no `pkill` and `killall` by a name pattern |
| Temporary files | with a unique prefix (the task or issue id); do not overwrite or delete other people's files |
| Browser | work only in your own tabs, do not close other people's |
| Ports | do not take ports that someone else is already listening on; take free ones for a local stack |
| A permission system denial | stop that line of work, do not look for workarounds, quote the exact text of the denial in the report |
| Secrets | do not go into commits, issues, PRs and logs; tokens not in URLs |
| Local tool settings | do not commit, read or change the directory of local settings (`.claude/` and the like) |
| Dependencies | new Python and npm dependencies only with a justification in the PR description |
| Git | no force-push to `develop` and `main`; do not enable auto-merge |
| Publicity | the repository is public: no personal data, no local paths, no local network addresses in commits, documents and issues |

---

## 7. The owner's feedback

- Feedback after a game comes in a batch. **Every item** goes into the checklist of a tracking issue, none is lost. The agent creates and maintains the checklist (simple things go to Haiku).
- Before editing the rules, state the decision **exactly** per the text of the DEC. A discrepancy between a retelling and the record in `mechanics.md` is unacceptable.
- Decisions are recorded in `docs/design/mechanics.md` with the status `[accepted]`, `[proposed]` or `[superseded by DEC-N]`.
- **First the DEC, then the code.** Implementation does not start without a recorded decision.
- Open questions are turned into issues and listed to the owner with a recommendation for each.
- Earlier decisions are not brought back: if a new idea cancels an old DEC, it is a new DEC with the status `[superseded by DEC-N]` on the old one.
- **A major visual decision: first a mockup, then code** (the owner's practice, 2026-10-21; examples: `docs/design/mockups/fight-arena.html` and issue #327, `docs/design/mockups/map-style.html` and issue #332). A major decision is a new map or unit style, a new icon shape, a new look of an arena or a screen, anything that changes the look of most frames or costs more than a day. Before the code the agent makes: (1) a self-contained interactive HTML mockup with switchable variants in `docs/design/mockups/` (one file, no network, drawn by code); **by default at least 3-4 design variants per element plus the current look for comparison** (the owner, 2026-10-21); (2) an issue with a table of variants (whether DEC, protocol, simulation, client are needed; an estimate; the FPS cost; the risk), a recommendation, 2-3 frames of the mockup and the decision field "**awaiting the owner's decision**". The issue is not closed until a choice is made, and code starts only after it. Small edits (color, unifying a shape, spacing, fixing an overlap) go straight into code. Details and the loop for checking the look (`mise run shots`): `docs/design/ui-style.md`, section 23.
- **After the mechanics are frozen** new ideas go to the queue after the release, bugs are fixed at once.
- After a rules change the smoke tournament is `mise run tournament -- --seeds 3` on `mvp-1` (it looks for crashes and gross imbalance). A full tournament (default seeds) only after a change of ruleset numbers and before a playtest (BAL-02) (`AGENTS.md`, section 8).

---

## 8. Where the state is kept

| What | Where |
|---|---|
| Scope and progress of work | tracking issues on GitHub (for example "Scope of the first release"): checklists, links to PRs and DECs |
| Feedback and open questions | issues with checklists and the label `question` |
| Game rules and decisions | `docs/design/mechanics.md` |
| Balance reports, decisions, checklists | `docs/balance/`, `docs/adr/`, `docs/qa/` |
| Notes of the current orchestrator session | may live outside the repository (the tool's personal notes); work must not depend on them: everything another orchestrator needs is written in issues |

A new orchestrator session starts with the tracking issues and the external state (`git log`, `gh pr list`, `git worktree list`), then reads this document and `AGENTS.md`.
Leave unfinished worktrees (for example postponed balance tasks) alone until the work resumes: they are removed only by the owner's decision.
