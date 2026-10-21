#!/usr/bin/env bash
# `mise run shots:publish <N>`: puts the PNGs of `.shots/` (labels "before" and "after", or any
# other) on the branch `shots/<N>` of origin and prints markdown for the PR description. The branch
# holds only the pictures (a fresh repository with one commit, no history of the project) and is
# never merged: delete it after the PR is merged (`git push origin --delete shots/<N>`).
set -euo pipefail

issue="${1:?usage: publish_shots.sh <issue or PR number>}"
root="$(git rev-parse --show-toplevel)"
shots="$root/.shots"
[ -d "$shots" ] || { echo "no $shots: run 'mise run shots' first" >&2; exit 1; }

origin="$(git -C "$root" remote get-url origin)"
slug="$(printf '%s' "$origin" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"

work="$(mktemp -d "${TMPDIR:-/tmp}/sbf-shots-$issue.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -R "$shots/." "$work/"
git -C "$work" init -q -b "shots/$issue"
git -C "$work" add -A
git -C "$work" -c user.name="shots" -c user.email="shots@localhost" commit -q -m "shots for #$issue"
git -C "$work" push -q --force "$origin" "HEAD:refs/heads/shots/$issue"

(cd "$shots" && find . -name '*.png' | sort) | while read -r file; do
  name="${file#./}"
  echo "![$name](https://github.com/$slug/blob/shots/$issue/$name?raw=true)"
done
