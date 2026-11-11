#!/bin/sh
# `mise run shots` and `mise run perf` (#977): runs the Playwright script `$1` of apps/client
# (`shots` or `perf`) with SHOTS_LABEL set to the label. mise passes the task arguments in the
# environment (`usage_label`, and `usage_playwright_args` shell-quoted), so the extra arguments reach
# Playwright: `mise run shots before -- --grep "fight"` runs only the matching scenes into
# .shots/before/. A first argument that starts with `-` is a Playwright argument, not a label
# (`mise run shots -- --grep fight` writes .shots/current/).
set -eu

script="${1:?usage: client_shots.sh <shots|perf> (run it through mise run shots or perf)}"
label="${usage_label:-current}"
eval "set -- ${usage_playwright_args-}"
case "$label" in
  -*) set -- "$label" "$@"; label=current ;;
esac
SHOTS_LABEL="$label" exec pnpm --silent -C apps/client "$script" "$@"
