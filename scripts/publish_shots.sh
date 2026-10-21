#!/usr/bin/env bash
# `mise run shots:publish <N>`: puts the PNGs of `.shots/` (labels "before" and "after", or any
# other) on the branch `shots/<N>` of origin and prints markdown for the PR description. The branch
# holds only the pictures (one parentless commit, no history of the project) and is
# never merged: delete it after the PR is merged (`git push origin --delete shots/<N>`).
set -euo pipefail

issue="${1:?usage: publish_shots.sh <issue or PR number>}"
root="$(git rev-parse --show-toplevel)"
shots="$root/.shots"
[ -d "$shots" ] || { echo "no $shots: run 'mise run shots' first" >&2; exit 1; }

origin="$(git -C "$root" remote get-url origin)"
slug="$(printf '%s' "$origin" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"

# A commit with only the pictures, built with a private index (the working tree and the real index of
# the clone stay untouched); the push uses the credentials of this clone.
gitdir="$(git -C "$root" rev-parse --absolute-git-dir)"
GIT_INDEX_FILE="$(mktemp -u "${TMPDIR:-/tmp}/sbf-shots-index.XXXXXX")"
export GIT_INDEX_FILE
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
cd "$shots"
git --git-dir="$gitdir" --work-tree="$shots" add -A -f .
tree="$(git --git-dir="$gitdir" write-tree)"
commit="$(git --git-dir="$gitdir" -c user.name=shots -c user.email=shots@localhost commit-tree "$tree" -m "shots for #$issue")"
git --git-dir="$gitdir" push -q --force origin "$commit:refs/heads/shots/$issue"

(cd "$shots" && find . -name '*.png' | sort) | while read -r file; do
  name="${file#./}"
  echo "![$name](https://github.com/$slug/blob/shots/$issue/$name?raw=true)"
done
