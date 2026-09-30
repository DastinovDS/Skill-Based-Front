<script lang="ts">
  import { DEV_PLAYER, DEV_RULES, startDevFeed } from './hud/devFeed.ts';
  import Hud from './hud/Hud.svelte';
  import { HudState } from './hud/hudState.svelte.ts';
  import { DEMO_SCENE, FIXTURE_SCENES, demoSource, frozenSource } from './dev/scenarios.ts';
  import { BUNDLED_MAPS, DEFAULT_MAP, backgroundUrl } from './map/bundledMaps.ts';
  import { NO_INSETS, type Insets } from './render/camera.ts';
  import GameCanvas from './render/GameCanvas.svelte';

  // Dev screen: a bundled map with the camera and a scene (a protocol fixture frozen at its tick,
  // or a scripted demo that moves). The lobby and the match (CLI-06) replace it.
  // `?scene=<id>` opens a scene right away (the Playwright reference screenshots use it).
  const requested = new URLSearchParams(window.location.search).get('scene');
  const fixtureScene = (id: string | null) => FIXTURE_SCENES.find((scene) => scene.id === id);
  let rendererFailed = $state(false);
  let sceneId = $state(
    fixtureScene(requested) === undefined ? DEMO_SCENE : (requested ?? DEMO_SCENE),
  );
  let mapName = $state(fixtureScene(requested)?.map ?? DEFAULT_MAP.meta.name);
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
  // A fixture belongs to its map; the demo runs on whichever map is picked.
  const source = $derived.by(() => {
    const scene = fixtureScene(sceneId);
    return scene === undefined ? demoSource(map) : frozenSource(scene);
  });

  function selectScene(id: string): void {
    sceneId = id;
    const scene = fixtureScene(id);
    if (scene !== undefined) {
      mapName = scene.map;
    }
  }

  function selectMap(name: string): void {
    mapName = name;
    // A fixture is written for one map: picking another map leaves it for the demo.
    if (fixtureScene(sceneId)?.map !== name) {
      sceneId = DEMO_SCENE;
    }
  }

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
    {source}
    backgroundUrl={backgroundUrl(map.meta.name)}
    onerror={handleRendererError}
    onfps={(value: number) => {
      fps = value;
    }}
  />
  <Hud
    {rendererFailed}
    maps={BUNDLED_MAPS.map((m) => m.meta.name)}
    {mapName}
    scenes={[DEMO_SCENE, ...FIXTURE_SCENES.map((scene) => scene.id)]}
    {sceneId}
    {fps}
    {hud}
    oninsets={(next: Insets) => {
      insets = next;
    }}
    onselectmap={selectMap}
    onselectscene={selectScene}
    onfit={() => canvas?.fitMap()}
  />
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
</style>
