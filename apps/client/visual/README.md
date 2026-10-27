# Map screenshot tests (CLI-04, #60)

Playwright opens the client's dev screen with a fixed scene (`/?scene=<id>`) and compares the
canvas with a reference. The scenes are assembled in `src/dev/scenarios.ts` from the protocol fixtures
`packages/protocol/fixtures/server/snapshot*.json`, each on its own map and "frozen" at the tick of the
snapshot (no animation):

| Scene            | Map       | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`       | `diamond` | own groups in a city and on a road, a packet, the enemy's "Defense" and scheduled order, the enemy's presence without numbers, a fight marker, the accumulated "Defense" bonus "+N / M" by the shield of an own group (#318), the barracks house of own cities and of an enemy capital next to an own city (DEC-31, #319; the icon frame in the owner's color)                                                                                                                                                                                                                                                                                                                                                                     |
| `snapshot_fog`   | `line3`   | a warehouse with a full bar, an enemy intent, a city in the fog: the F1 haze (a veil with a soft edge and a light border line), a memory ghost with the age `-0:21`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `snapshot_clash` | `siege`   | three groups in one city (one icon with the sum of units), the enemy with exact numbers, the enemy's "Defense" and "Building" modes, arrows of both sides, a fight in progress with a round in flight and three finished ones (captured, held, both withdrew)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `overflow`       | `diamond` | two own cities overflowing (ui-style 12): a unit-loss countdown `1.8 s` and a grace period after capture `3.0 s`, two alert lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ranges`         | `diamond` | what DEC-21 and DEC-33 show about the enemy (#359): a city with the range "21+", figures on road halves exactly ("4"), as a range ("1-2", "6-10") and without numbers, the memory of a city (range "3-5") and of road halves in the fog (exact numbers, presence) as ghosts at the border point with an age, a tick mark of the border point on every road, a shade on halves in the fog                                                                                                                                                                                                                                                                                                                                           |
| `fights`         | `siege`   | four fights at once (#325, #330): an arena plate with a chip for each unit (charged, discharged with hatching, killed with a dashed outline), "+N" above 8, the reserve ◇ ×N of both sides, an amber icon of a silent charge, the caption "bonus attack" above the plate of a fight with a bonus shot; the plates do not overlap each other or the cities (the layout of `arenaLayout.ts`, #360), a shifted plate is linked to the place of the fight by a dashed line; the FX3 effects (#351) of each fight in its phase after the hit: extinguishing on a road (✕ and rays), a hit on a charge in a city, a kill with shards ▽ and "−1", a wind-up and a silent charge (an amber sign), the fading paths of the SH1 tracers (#352) |
| `fights_kill`    | `siege`   | the same four fights at tick 395, shots in the air (#352): a real tracer of the enemy's side before the kill in the city below, a bonus tracer (a hollow diamond, an echo) of the own side halfway in the city on the left, no shots yet on the road                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `fights_flight`  | `siege`   | the same fights at tick 398 (#352): on the road the own side's bonus shot and the enemy's real one before they meet (two arcs as a lens), a bonus tracer at the target in the city on the left, the kill has just arrived, a wind-up in the city above                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Commands (from the repository root; `mise run` installs Playwright Chromium itself if it is missing):

- `mise run test:visual`: compare with the references (the dev server starts itself on port 5199), like the job `visual` in CI;
- `mise run shots [label]`: take a PNG of all scenes (the list: `visual/scenes.ts`) and of the replay viewer in `.shots/<label>/`
  (`current` by default; the directory is in `.gitignore`, `SHOTS_DIR` moves it) without comparing: for the agent and the owner,
  to look at the appearance with their own eyes. The names are stable: `<scene>.png` the whole screen with the HUD, `<scene>-map.png` the map only,
  `replay.png`. The dev server runs on a free port, Playwright stops it;
- `mise run shots:publish <number>`: PNGs from `.shots/` to the branch `shots/<number>` and ready markdown links for the PR description;
- `pnpm -C apps/client test:visual:update`: write the references anew after an intended change of look (there is no `mise run` command
  for this: an update is always deliberate).

## Changing the look: the agent's loop

1. `mise run shots before`, before the edit.
2. Edit the code, `mise run shots after`.
3. Read (Read) the pairs `.shots/before/<scene>.png` and `.shots/after/<scene>.png` for all scenes the edit touched,
   and always the scenes `snapshot_fog` (fog) and `fights` (fight). The edit is not finished until the frame looks as intended:
   overlaps, contrast, anything conveyed by color alone (AGENTS.md, 7.4).
4. `mise run test:visual`. A failed comparison is either a regression (fix it) or an intended change: then
   `pnpm -C apps/client test:visual:update` for darwin and the Linux references (the Playwright container, below); both sets
   are committed together with the edit.
5. `mise run shots:publish <PR or issue number>`, put the links into the PR description: "before" and "after", which scenes were viewed and what was seen.
   After the PR is merged: `git push origin --delete shots/<number>`.

Radial menus (#350): `mise run shots` takes them too, on the scene `snapshot_fog` with the parameter `?menus` (in a frozen
scene orders go nowhere, the menus open as for a player, city development is on): `menu-stance.png` (key Q),
`menu-city.png` (a click on a city ring), `menu-group.png` (two clicks on a group), `menu-supply.png` (Tab and a click on a city)
and the same frames in grayscale `menu-<name>-gray.png`. They have no `visual` references (the HUD is hidden in the references).

`?at=<tick>` (for example `/?scene=fights&at=397.5`) freezes a fixture scene at another tick of the frame, a fractional one too: fight effects
are functions of the tick, so a round is viewed frame by frame (the shot frames in the description of #352 were taken this way). References have no such parameter.

A new scene: add it to `src/dev/scenarios.ts` and to `visual/scenes.ts` (the test `src/dev/sceneList.test.ts` will remind you),
and record a reference.

The references live in `visual/scenes.spec.ts-snapshots/` separately for each platform
(`-darwin`, `-linux`): the font and the rasterizer differ. The tolerance: 1% of pixels.

The Linux references for CI are written in a Playwright container of the same version as in `package.json`
(from the repository root):

```sh
docker run --rm -v "$PWD":/src:ro -v "$PWD/apps/client/visual":/out mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c 'mkdir /work && cd /src && tar --exclude=node_modules --exclude=.git --exclude=.venv -cf - . | tar -xf - -C /work \
  && cd /work/apps/client && corepack enable && pnpm install --frozen-lockfile \
  && CI=1 pnpm exec playwright test --update-snapshots; cp -r visual/scenes.spec.ts-snapshots/. /out/scenes.spec.ts-snapshots/'
```

CI runs them as a separate job `visual` (not part of the required `py`, `web`, `docker`).
A failed comparison puts the actual frames and the difference into the artifact `visual-diff`.

## Replay viewer (CLI-10, #66)

`visual/replay.spec.ts` opens `/?replay=dev` (the built-in sample `src/replay/siege.frames.json`:
a short match on the map `siege`, recorded by `gow_server.frames.build_frames` and unpacked) and checks
that the speed buttons, the pause and the slider drive the real renderer. There is no reference screenshot.
`/?replay=dev-fights` plays `src/replay/siege-fights.frames.json` (rusher against rusher on `siege`, recorded the same way, 464 ticks)
with fights and their round data (#323); `mise run shots` takes `replay-fights-385.png` and `replay-fights-460.png` of it (the arena
with a killed unit, the "bonus attack" caption). There is no reference screenshot.
