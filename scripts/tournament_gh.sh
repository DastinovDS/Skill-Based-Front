#!/usr/bin/env bash
# `mise run tournament:gh`: dispatches .github/workflows/tournament.yml (#582), waits for the run with
# one `gh run watch --exit-status` and downloads the artifact (tournament.jsonl and report.md) into
# $TGH_DIR/<artifact name>. Options come from the task as environment variables (see mise.toml).
set -euo pipefail

: "${TGH_REF:?}" "${TGH_RULESET:?}" "${TGH_BOTS:?}" "${TGH_MAPS:?}" "${TGH_SEEDS:?}" "${TGH_SHARDS:?}" "${TGH_DIR:?}"

origin="$(git remote get-url origin)"
repo="$(printf '%s' "$origin" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"

# The run is found by its title, so the label gets a nonce (parallel dispatches do not mix up).
nonce="$(date +%s)-$$"
label="${TGH_LABEL:+$TGH_LABEL-}$nonce"

gh workflow run tournament.yml -R "$repo" --ref "$TGH_REF" \
  -f ref="$TGH_REF" -f ruleset="$TGH_RULESET" -f bots="$TGH_BOTS" -f maps="$TGH_MAPS" \
  -f seeds="$TGH_SEEDS" -f shards="$TGH_SHARDS" -f label="$label"

# GitHub registers the run a moment after the dispatch: wait until it shows up (at most 60 s).
run_id=""
for _ in $(seq 1 30); do
  run_id="$(gh run list -R "$repo" --workflow tournament.yml --event workflow_dispatch --limit 20 \
    --json databaseId,displayTitle --jq "map(select(.displayTitle | endswith(\"$nonce\"))) | .[0].databaseId // empty")"
  [ -n "$run_id" ] && break
  sleep 2
done
[ -n "$run_id" ] || { echo "the dispatched run did not appear" >&2; exit 1; }
echo "run $run_id: https://github.com/$repo/actions/runs/$run_id" >&2

started="$(date +%s)"
gh run watch "$run_id" -R "$repo" --exit-status --interval 30 > /dev/null
echo "finished in $(( $(date +%s) - started )) s of waiting" >&2

mkdir -p "$TGH_DIR"
gh run download "$run_id" -R "$repo" --pattern 'tournament-*' --dir "$TGH_DIR"
echo "downloaded into $TGH_DIR" >&2
ls -1 "$TGH_DIR"/tournament-*
