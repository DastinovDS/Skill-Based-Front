<script lang="ts">
  import Hud from './hud/Hud.svelte';
  import { BUNDLED_MAPS, DEFAULT_MAP } from './map/bundledMaps.ts';
  import GameCanvas from './render/GameCanvas.svelte';

  // Dev screen: a bundled map with the camera. The lobby and the match (CLI-01, CLI-02) replace it.
  let rendererFailed = $state(false);
  let mapName = $state(DEFAULT_MAP.meta.name);
  let fps = $state(0);
  // The part of the GameCanvas instance the HUD uses (spelled out: typescript-eslint cannot see
  // the types of .svelte imports).
  let canvas: { fitMap: () => void } | undefined = $state.raw();

  const map = $derived(BUNDLED_MAPS.find((m) => m.meta.name === mapName) ?? DEFAULT_MAP);

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
