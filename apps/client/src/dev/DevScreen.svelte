<script lang="ts">
  import { untrack } from 'svelte';
  import { HudChrome } from '../hud/chrome.svelte.ts';
  import { DEV_PLAYER, DEV_RULES } from '../hud/devFeed.ts';
  import MatchStatus from '../app/MatchStatus.svelte';
  import { statusView } from '../app/matchStatus.ts';
  import Hud from '../hud/Hud.svelte';
  import { routeKey } from '../hud/hudKeys.ts';
  import { HudState } from '../hud/hudState.svelte.ts';
  import { STATUS_INPUTS, isStatusScene } from './statusScenes.ts';
  import { createDevMatch } from './devMatch.ts';
  import { parseEta, pinEta } from './etaPin.ts';
  import { parseUndo, pinUndo } from './undoPin.ts';
  import { DEMO_SCENE, FIXTURE_SCENES, frozenSource, parseFlood } from './scenarios.ts';
  import { OrderBook } from '../match/orderBook.ts';
  import { forwardKey } from '../match/keyEvents.ts';
  import { OrderController } from '../match/orderController.ts';
  import type { Command, ReachNode } from '../protocol.gen.ts';
  import { BUNDLED_MAPS, DEFAULT_MAP, backgroundUrl, bundledGeo } from '../map/bundledMaps.ts';
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
  // `?motion` makes the live demo move: a group marches along a road, the charges cycle (#508, `devMotion.ts`).
  const motionOn = params.has('motion');
  // `?map=<name>` opens the demo on a bundled map (the FPS check wants a 45-55 node one).
  const mapParam = params.get('map');
  // `?at=<tick>` freezes a fixture scene at another render tick (also a fractional one): a round of a fight frame by frame.
  const atParam = Number(params.get('at'));
  const at = params.has('at') && Number.isFinite(atParam) ? atParam : undefined;
  // `?eta=<from>,<to>,<ticks>[,<via>...]` pins the travel-time label of an order to a frozen scene (#432).
  const etaPinned = parseEta(params.get('eta'));
  // `?flood=<ms>,<node>:<owner before>,...` shows a capture under way on a fixture scene, held at that age (#819).
  const floodPinned = parseFlood(params.get('flood')) ?? undefined;
  const undoPinned = parseUndo(params.get('undo'));
  // `?split=<node>[,<units>]` makes a fixture scene answer the `reach` of a selected group with that
  // node under `split` (the group is too big for it, DEC-20) and the size that fits there (0 by
  // default): the hint "split the group" (#468) and the click that opens the split menu (#762).
  const splitParts = (params.get('split') ?? '').split(',').map(Number);
  const splitPinned =
    params.has('split') && Number.isInteger(splitParts[0])
      ? {
          node: splitParts[0] ?? 0,
          units: Number.isInteger(splitParts[1]) ? (splitParts[1] ?? 0) : 0,
        }
      : null;
  // `?reach=<to>,<ticks>[,<via>...]` makes a fixture scene answer the `reach` of a selected group with
  // that target, its travel time and the route through `via` (#793): the ghost and the bonus counter
  // of a planned order (Shift over the target) are drawn only for a target the answer lists.
  const reachParts = (params.get('reach') ?? '').split(',').map(Number);
  const reachPinned =
    params.has('reach') && reachParts.length >= 2 && reachParts.every(Number.isInteger)
      ? { node: reachParts[0] ?? 0, ticks: reachParts[1] ?? 0, via: reachParts.slice(2) }
      : null;
  const cpParam = Number(params.get('cp'));
  const cpPinned = params.has('cp') && Number.isInteger(cpParam) ? Math.max(0, cpParam) : null;
  // `?capture=<node>` turns on the price of a capture (`capture.charge_cost = 1`, DEC-38) and adds a
  // `capture_failed` event at that node to a fixture scene: its toast and the capture tip on a target
  // the player does not own (#580) can be looked at.
  const capturePinned =
    params.has('capture') && Number.isInteger(Number(params.get('capture')))
      ? Number(params.get('capture'))
      : null;
  // `?status=<state>` puts an in-match status bar over a fixture scene (#602, `statusScenes.ts`);
  // `renderer` is the notice of a map that could not be drawn.
  const statusParam = params.get('status');
  const statusId = isStatusScene(statusParam) ? statusParam : null;
  const status = statusId === null ? null : statusView(STATUS_INPUTS[statusId]);
  // `?retreat=none` plays the rules of DEC-40 (`combat.retreat = "none"`): a group in a fight has
  // no cancel in its menu and sends no move.
  const retreatNone = params.get('retreat') === 'none';
  const rules = {
    ...DEV_RULES,
    ...(capturePinned === null ? {} : { capture: { charge_cost: 1 } }),
    ...(retreatNone ? { combat: { ...DEV_RULES.combat, retreat: 'none' as const } } : {}),
  };
  const fixtureScene = (id: string | null) => FIXTURE_SCENES.find((scene) => scene.id === id);
  let rendererFailed = $state(statusId === 'renderer');
  let sceneId = $state(
    fixtureScene(requested) === undefined ? DEMO_SCENE : (requested ?? DEMO_SCENE),
  );
  let mapName = $state(
    fixtureScene(requested)?.map ??
      BUNDLED_MAPS.find((m) => m.meta.name === mapParam)?.meta.name ??
      DEFAULT_MAP.meta.name,
  );
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
  // A scene may play other rules (economy v2, #649): the HUD and the menus follow them.
  const sceneRules = $derived(fixture?.rules ?? rules);

  // The HUD numbers for the map on screen.
  const hud = $derived(
    new HudState({ me: DEV_PLAYER, nicks: ['Ember', 'Bot'], rules: sceneRules, map }),
  );
  const chrome = new HudChrome();

  // The demo scene is a live match against the dev server (until SRV-03); a fixture is a frozen
  // snapshot. Either way the map and the HUD read the same snapshots.
  const match = $derived(
    fixture === undefined
      ? createDevMatch(
          map,
          rules,
          hud,
          (msg) => {
            orders.onReach(msg);
          },
          motionOn,
        )
      : null,
  );
  const source = $derived(
    match === null
      ? fixture === undefined
        ? null
        : frozenSource(fixture, at, floodPinned)
      : match.session,
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
        // `?cp=<hundredths>` sets the own CP of the frozen scene (the CP shortage, #762).
        hud.onSnapshot(
          cpPinned === null
            ? scene.snapshot
            : {
                ...scene.snapshot,
                view: { ...scene.snapshot.view, me: { ...scene.snapshot.view.me, cp: cpPinned } },
              },
        );
        for (const event of scene.events) {
          hud.onEvent(event);
        }
        if (capturePinned !== null) {
          hud.onEvent({
            type: 'event',
            tick: scene.snapshot.tick,
            kind: 'capture_failed',
            data: { node: capturePinned, player: DEV_PLAYER, group: 'dev', result: 'bounce' },
          });
        }
        // A frozen scene has no render clock: its toasts show at once.
        hud.onRender(Number.POSITIVE_INFINITY);
      });
    }
  });

  // `?reject=<code>` (with `menus`) makes a fixture scene refuse every command with that code at
  // once, as an `ack` would: the cut-off arrow of `NOT_ENOUGH_CP` (#762) can be looked at.
  const rejectPinned = params.get('reject');
  let rejectSeq = 0;
  /** The `send` of a fixture scene with `menus`: nowhere, or refused at once (`?reject`). */
  function frozenSend(book: OrderBook): (cmd: Command) => number {
    if (rejectPinned === null) return () => 0;
    return () => {
      rejectSeq += 1;
      const seq = rejectSeq;
      queueMicrotask(() => {
        book.onAck({
          type: 'ack',
          seq,
          applied_tick: 0,
          path: null,
          arrive_tick: null,
          reject_code: rejectPinned,
        });
      });
      return seq;
    };
  }

  // Clicks and keys on the map; orders go to the match, a fixture scene only selects.
  const orders = $derived.by(() => {
    const book = match?.session.orders ?? new OrderBook();
    return new OrderController({
      hud,
      map,
      // With `?menus` the city development is on too: the city menu shows all three sectors.
      rules: menusOn
        ? { ...sceneRules, city_upgrades: { ...sceneRules.city_upgrades } }
        : sceneRules,
      book,
      send: match === null ? (menusOn ? frozenSend(book) : null) : (cmd) => match.session.send(cmd),
      alerts: hud.alerts,
      focusNode: (node) => canvas?.focusNode(node),
      queryReach: (group) => {
        match?.session.queryReach(group);
        const from = hud.current?.group?.node ?? null;
        if (match === null && (splitPinned !== null || (reachPinned !== null && from !== null))) {
          const nodes: ReachNode[] = [];
          if (reachPinned !== null && from !== null) {
            const [next, ...rest] = [...reachPinned.via, reachPinned.node];
            nodes.push({
              node: reachPinned.node,
              ticks: reachPinned.ticks,
              path: [from, next, ...rest],
            });
          }
          const split = splitPinned === null ? [] : [splitPinned];
          orders.onReach({ type: 'reach', group, tick: 0, nodes, split });
        }
      },
    });
  });

  $effect(() => {
    const current = orders;
    return () => {
      current.destroy();
    };
  });

  const etaInteraction = $derived(etaPinned === null ? orders : pinEta(orders, etaPinned));
  const interaction = $derived(
    undoPinned === null ? etaInteraction : pinUndo(etaInteraction, undoPinned),
  );

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
    {interaction}
    backgroundUrl={backgroundUrl(map.meta.name)}
    geo={bundledGeo(map)}
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
    onreload={() => undefined}
    oninsets={(next: Insets) => {
      insets = next;
    }}
    anchors={{
      node: (id: number) => canvas?.nodeAnchor(id) ?? null,
      group: (id: string) => canvas?.groupAnchor(id) ?? null,
    }}
  />
  {#if status !== null}
    <MatchStatus view={status} lifted={rendererFailed} onaction={() => undefined} />
  {/if}
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
</style>
