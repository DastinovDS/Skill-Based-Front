<script lang="ts">
  import { untrack } from 'svelte';
  import { HudChrome } from '../hud/chrome.svelte.ts';
  import { DEV_PLAYER, DEV_RULES } from '../hud/devFeed.ts';
  import Hud from '../hud/Hud.svelte';
  import { routeKey } from '../hud/hudKeys.ts';
  import { HudState } from '../hud/hudState.svelte.ts';
  import { HudPrefs } from '../hud/prefs.svelte.ts';
  import { createDevMatch } from './devMatch.ts';
  import { DEMO_SCENE, FIXTURE_SCENES, frozenSource } from './scenarios.ts';
  import { OrderBook } from '../match/orderBook.ts';
  import { forwardKey } from '../match/keyEvents.ts';
  import { OrderController } from '../match/orderController.ts';
  import { BUNDLED_MAPS, DEFAULT_MAP, backgroundUrl } from '../map/bundledMaps.ts';
  import type { Anchor } from '../render/anchors.ts';
  import { NO_INSETS, type Insets } from '../render/camera.ts';
  import GameCanvas from '../render/GameCanvas.svelte';

  // Dev screen: a bundled map with the camera and a scene (a protocol fixture frozen at its tick,
  // or a live match against the dev server). The lobby replaces it.
  // `?scene=<id>` opens a scene right away (the Playwright reference screenshots use it).
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('scene');
  // `?menus` lets a fixture scene open the menus of the map (orders go nowhere): the screenshots
  // of the radial menus (`mise run shots`) use it. Without it a fixture only selects.
  const menusOn = params.has('menus');
  // `?at=<tick>` freezes a fixture scene at another render tick (also a fractional one): a round of a fight frame by frame.
  const atParam = Number(params.get('at'));
  const at = params.has('at') && Number.isFinite(atParam) ? atParam : undefined;
  const fixtureScene = (id: string | null) => FIXTURE_SCENES.find((scene) => scene.id === id);
  let rendererFailed = $state(false);
  let sceneId = $state(
    fixtureScene(requested) === undefined ? DEMO_SCENE : (requested ?? DEMO_SCENE),
  );
  let mapName = $state(fixtureScene(requested)?.map ?? DEFAULT_MAP.meta.name);
  let fps = $state(0);
  // The part of the GameCanvas instance the HUD uses (spelled out: typescript-eslint cannot see
  // the types of .svelte imports).
  let canvas:
    | {
        fitMap: () => void;
        setInsets: (insets: Insets) => void;
        focusNode: (node: number) => void;
        nodeAnchor: (node: number) => Anchor | null;
        groupAnchor: (group: string) => Anchor | null;
      }
    | undefined = $state.raw();

  // Screen margins the HUD covers: "fit map" keeps the map out of them.
  let insets: Insets = $state.raw(NO_INSETS);

  $effect(() => {
    canvas?.setInsets(insets);
  });

  const map = $derived(BUNDLED_MAPS.find((m) => m.meta.name === mapName) ?? DEFAULT_MAP);
  const fixture = $derived(fixtureScene(sceneId));

  // The HUD numbers for the map on screen.
  const hud = $derived(
    new HudState({ me: DEV_PLAYER, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map }),
  );
  const chrome = new HudChrome();
  const prefs = new HudPrefs();

  // The demo scene is a live match against the dev server (until SRV-03); a fixture is a frozen
  // snapshot. Either way the map and the HUD read the same snapshots.
  const match = $derived(
    fixture === undefined
      ? createDevMatch(map, DEV_RULES, hud, (msg) => {
          orders.onReach(msg);
        })
      : null,
  );
  const source = $derived(
    match === null ? (fixture === undefined ? null : frozenSource(fixture, at)) : match.session,
  );

  $effect(() => {
    const current = match;
    if (current === null) {
      return undefined;
    }
    current.start();
    return () => {
      current.stop();
    };
  });

  $effect(() => {
    if (fixture !== undefined) {
      const scene = fixture;
      // The HUD reads and writes its own state: feeding it must not make this effect depend on it.
      untrack(() => {
        hud.onSnapshot(scene.snapshot);
        for (const event of scene.events) {
          hud.onEvent(event);
        }
      });
    }
  });

  // Clicks and keys on the map; orders go to the match, a fixture scene only selects.
  const orders = $derived(
    new OrderController({
      hud,
      map,
      // With `?menus` the city development is on too: the city menu shows all three sectors.
      rules: menusOn
        ? { ...DEV_RULES, city_upgrades: { ...DEV_RULES.city_upgrades, enabled: true } }
        : DEV_RULES,
      book: match?.session.orders ?? new OrderBook(),
      send: match === null ? (menusOn ? () => 0 : null) : (cmd) => match.session.send(cmd),
      alerts: hud.alerts,
      focusNode: (node) => canvas?.focusNode(node),
      queryReach: (group) => match?.session.queryReach(group),
    }),
  );

  $effect(() => {
    const current = orders;
    return () => {
      current.destroy();
    };
  });

  function handleKey(event: KeyboardEvent): void {
    if (routeKey(chrome, event, { fit: () => canvas?.fitMap(), idle: () => orders.isIdle() })) {
      return;
    }
    if (forwardKey(orders, event)) {
      event.preventDefault();
    }
  }

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

  function handleRendererError(error: unknown): void {
    console.error(error);
    rendererFailed = true;
  }
</script>

<svelte:window
  onkeydown={handleKey}
  onkeyup={handleKey}
  onblur={() => {
    orders.key({ type: 'keyup', code: '', shiftKey: false });
  }}
/>

<main class="app">
  <GameCanvas
    bind:this={canvas}
    {map}
    {source}
    interaction={orders}
    backgroundUrl={backgroundUrl(map.meta.name)}
    viewRect={fixture?.view ?? null}
    onerror={handleRendererError}
    onfps={(value: number) => {
      fps = value;
    }}
  />
  <Hud
    {rendererFailed}
    dev={{
      maps: BUNDLED_MAPS.map((m) => m.meta.name),
      mapName,
      scenes: [DEMO_SCENE, ...FIXTURE_SCENES.map((scene) => scene.id)],
      sceneId,
      fps,
      onselectmap: selectMap,
      onselectscene: selectScene,
    }}
    {hud}
    {orders}
    {chrome}
    {prefs}
    oninsets={(next: Insets) => {
      insets = next;
    }}
    anchors={{
      node: (id: number) => canvas?.nodeAnchor(id) ?? null,
      group: (id: string) => canvas?.groupAnchor(id) ?? null,
    }}
  />
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
</style>
