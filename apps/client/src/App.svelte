<script lang="ts">
  import { DEV_PLAYER, DEV_RULES, startDevFeed } from './hud/devFeed.ts';
  import Hud from './hud/Hud.svelte';
  import { HudState } from './hud/hudState.svelte.ts';
  import { BUNDLED_MAPS, DEFAULT_MAP } from './map/bundledMaps.ts';
  import { NO_INSETS, type Insets } from './render/camera.ts';
  import GameCanvas from './render/GameCanvas.svelte';

  // Dev screen: a bundled map with the camera. The lobby and the match (CLI-01, CLI-02) replace it.
  let rendererFailed = $state(false);
  let mapName = $state(DEFAULT_MAP.meta.name);
  let fps = $state(0);
  // The part of the GameCanvas instance the HUD uses (spelled out: typescript-eslint cannot see
  // the types of .svelte imports).
  let canvas: { fitMap: () => void; setInsets: (insets: Insets) => void } | undefined =
    $state.raw();

  // Screen margins the HUD covers: "fit map" keeps the map out of them.
  let insets: Insets = $state.raw(NO_INSETS);

  $effect(() => {
    canvas?.setInsets(insets);
  });

  const map = $derived(BUNDLED_MAPS.find((m) => m.meta.name === mapName) ?? DEFAULT_MAP);

  // The HUD numbers for the map on screen, fed by the dev feed until the match connection (CLI-01).
  const hud = $derived(new HudState({ me: DEV_PLAYER, rules: DEV_RULES, map }));

  $effect(() => {
    const current = hud;
    return startDevFeed(map, DEV_RULES, {
      onSnapshot: (snapshot) => {
        current.onSnapshot(snapshot);
      },
      onEvent: (event) => {
        current.onEvent(event);
      },
    });
  });

  function handleRendererError(error: unknown): void {
    console.error(error);
    rendererFailed = true;
  }
</script>

<main class="app">
  <GameCanvas
    bind:this={canvas}
    {map}
    onerror={handleRendererError}
    onfps={(value: number) => {
      fps = value;
    }}
  />
  <Hud
    {rendererFailed}
    maps={BUNDLED_MAPS.map((m) => m.meta.name)}
    {mapName}
    {fps}
    {hud}
    oninsets={(next: Insets) => {
      insets = next;
    }}
    onselectmap={(name: string) => {
      mapName = name;
    }}
    onfit={() => canvas?.fitMap()}
  />
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
</style>
