<script lang="ts">
  import { untrack } from 'svelte';
  import type { MapFile } from '../protocol.gen.ts';
  import { reducedMotion } from '../render/motion.ts';
  import MenuCityMark from './MenuCityMark.svelte';
  import {
    backdropFrozenAt,
    captureLook,
    capturedNodes,
    capturesAt,
    ownersAt,
  } from './menuCaptures.ts';
  import { menuWorldOf } from './menuMap.ts';
  import {
    FALLBACK_PALETTE,
    STILL_AT,
    drawMotion,
    sightOf,
    type MotionClock,
    readPalette,
    type Sight,
  } from './menuMotion.ts';
  import {
    FALLBACK_COLOURS,
    floodBox,
    gradeGround,
    paintMap,
    readColours,
    type Box,
    type FloodPaint,
    type MapPaint,
  } from './menuPaint.ts';
  import { MENU_INK, menuCity, menuLand, menuTerritory, type MenuLand } from './menuPieces.ts';
  import {
    BAR_BOTTOM,
    FOG_TOP_FADE,
    layoutEntry,
    layoutScene,
    pieceScale,
    type BackdropPhase,
    type Owners,
    type Point,
    type Scene,
  } from './menuScene.ts';
  import { currentSeason, groundMatrix } from './menuSeason.ts';
  import { storyOf, type Story } from './menuStory.ts';

  interface Props {
    /** The map to draw; without it the backdrop is the plain dark page. */
    map: MapFile | null;
    phase?: BackdropPhase;
    /** The opponent's nick, written under the enemy capital once a pair is found. */
    opponent?: string | null;
    /** Seconds in the queue (the search): where the scout is. */
    waited?: number;
    /** The entry screen (#839): the whole map over the window, no fog; muted and slower (#866). */
    entry?: boolean;
  }

  let { map, phase = 'idle', opponent = null, waited = 0, entry = false }: Props = $props();

  /** The motion is drawn 30 times a second; the hole of the scout's sight in the fog 10 times. */
  const FRAME_MS = 1000 / 30;
  const SIGHT_MS = 100;
  /** The entry screen's clock runs slower than the main menu's (#866: muted behind the title). */
  const ENTRY_PACE = 0.7;

  let host: HTMLDivElement | undefined = $state();
  let mapCanvas: HTMLCanvasElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let size = $state({ width: 1280, height: 720 });
  /** The hole in the fog round the scout, in whole px (the fog layer repaints only when it moves). */
  let sight = $state.raw<Sight | null>(null);
  /** The baked ground graded by the season, once it has loaded. */
  let ground = $state.raw<HTMLCanvasElement | null>(null);
  /** The names are drawn in the self-hosted Cinzel: the map layer is drawn again once it is in. */
  let fontsIn = $state(false);
  /** The map layer is drawn with its ground and its fonts (`data-map`, for the shots). */
  let ready = $state(false);
  const season = currentSeason();
  const matrix = groundMatrix(season);

  $effect(() => {
    const element = host;
    if (element === undefined || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        size = { width: Math.round(box.width), height: Math.round(box.height) };
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  });

  $effect(() => {
    const fonts = (document as Partial<Document>).fonts;
    if (fonts === undefined) return;
    let live = true;
    void fonts.ready.then(() => {
      if (live) fontsIn = true;
    });
    return () => {
      live = false;
    };
  });

  /** The menu maps have their ground, their areas and their loop of captures (#866). */
  const world = $derived(map === null ? null : menuWorldOf(map));

  // The ground: fetched once, graded by the season into a canvas of its own (drawn, never filtered).
  $effect(() => {
    const url = world?.ground ?? null;
    const known = world;
    if (url === null || known === null || typeof Image === 'undefined') {
      ground = null;
      return undefined;
    }
    let live = true;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!live) return;
      try {
        ground = gradeGround(image, matrix, {
          width: known.map.meta.width,
          height: known.map.meta.height,
        });
      } catch {
        ground = null;
      }
    };
    image.src = url;
    return () => {
      live = false;
      image.onload = null;
    };
  });

  const scene = $derived<Scene | null>(
    map === null
      ? null
      : entry
        ? layoutEntry(map, size.width, size.height, world?.owners)
        : layoutScene(map, size.width, size.height, world?.owners),
  );
  const story = $derived<Story | null>(
    scene === null ? null : storyOf(scene, world === null ? [] : capturedNodes(world.script)),
  );
  const revealed = $derived((phase === 'found' || phase === 'confirmed') && opponent !== null);
  /** The world units under one px: lines that must stay a hairline on the screen. */
  const px = $derived(scene === null ? 1 : 1 / Math.max(0.05, scene.scale));
  /** The pieces at most `PIECES_PX` of their match size on the screen (`pieceScale`). */
  const k = $derived(scene === null ? 1 : pieceScale(scene));

  function sameSight(a: Sight | null, b: Sight | null): boolean {
    if (a === null || b === null) return a === b;
    return a.x === b.x && a.y === b.y && a.r === b.r;
  }

  /** A 2D context of `target` sized to the scene, or null (jsdom has none). */
  function contextOf(
    target: HTMLCanvasElement,
    laid: Scene,
    ratio: number,
  ): CanvasRenderingContext2D | null {
    target.width = Math.round(laid.width * ratio);
    target.height = Math.round(laid.height * ratio);
    try {
      return target.getContext('2d');
    } catch {
      return null;
    }
  }

  // The phase clock: when the phase began and how long the queue had waited then.
  let clockPhase: BackdropPhase | null = null;
  let phaseStart = 0;
  let waitedAtStart = 0;

  $effect(() => {
    const target = canvas;
    const layer = mapCanvas;
    const laid = scene;
    const places = story;
    const current = phase;
    const known = world;
    const graded = ground;
    const pieces = k;
    const fontsReady = fontsIn;
    if (target === undefined || layer === undefined || laid === null || places === null) {
      return undefined;
    }
    if (map === null) return undefined;
    const drawn = map;
    const now = performance.now();
    if (current !== clockPhase) {
      clockPhase = current;
      phaseStart = now;
      waitedAtStart = untrack(() => waited);
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const context = contextOf(target, laid, ratio);
    const mapContext = contextOf(layer, laid, ratio);
    const colours = host === undefined ? FALLBACK_PALETTE : readPalette(host);
    const tokens = host === undefined ? FALLBACK_COLOURS : readColours(host);
    const pace = entry ? ENTRY_PACE : 1;
    const frozen = backdropFrozenAt();
    const script = known?.script ?? null;
    const base: Owners = known?.owners ?? laid.nodes.map((n) => n.owner);

    // The land of each owner state, worked out once (a loop has a handful).
    const lands: Record<string, MenuLand | undefined> = {};
    const paint: MapPaint = {
      scene: laid,
      k: pieces,
      colours: tokens,
      ground: graded,
      world: { width: drawn.meta.width, height: drawn.meta.height },
      cells: menuTerritory(drawn, known?.geo ?? null).cells,
      land: (owners) => {
        const key = owners.join(',');
        const land = lands[key] ?? menuLand(drawn, known?.geo ?? null, pieces, owners);
        lands[key] = land;
        return land;
      },
    };

    const clockAt = (at: number, still: boolean): MotionClock => {
      if (frozen !== null) {
        return { phase: current, t: frozen, g: frozen, waited: waitedAtStart, reduced: false };
      }
      return still
        ? {
            phase: current,
            t: STILL_AT[current],
            g: STILL_AT[current],
            waited: waitedAtStart,
            reduced: true,
          }
        : {
            phase: current,
            t: (at - phaseStart) / 1000,
            g: (at / 1000) * pace,
            waited: waitedAtStart,
            reduced: false,
          };
    };

    /** The capture flooding its area at `clock`, or null. */
    const floodAt = (clock: MotionClock, owners: Owners): FloodPaint | null => {
      if (script === null || clock.reduced) return null;
      for (const { capture, u } of capturesAt(script, clock.g)) {
        const look = captureLook(u, capture.by === 1).flood;
        if (look === null) continue;
        const before = [...owners];
        before[capture.node] = capture.by === 0 ? 1 : 0;
        return { node: capture.node, before, after: owners, look };
      }
      return null;
    };

    // The map layer: drawn whole once, then only the box of a capture while it floods.
    let paintedKey: string | null = null;
    let floodedBox: Box | null = null;
    const paintLayer = (clock: MotionClock): void => {
      if (mapContext === null) return;
      const owners = script === null ? base : ownersAt(base, script, clock.g);
      const key = owners.join(',');
      const flood = floodAt(clock, owners);
      mapContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (paintedKey === null) {
        paintMap(mapContext, paint, owners, flood);
        paintedKey = key;
      } else if (flood !== null) {
        const box = floodBox(laid, paint.cells, flood.node, pieces);
        paintMap(mapContext, paint, owners, flood, box);
        floodedBox = box;
        paintedKey = key;
      } else if (floodedBox !== null) {
        // The flood is over: its box once more in the new owners' look.
        paintMap(mapContext, paint, owners, null, floodedBox);
        floodedBox = null;
        paintedKey = key;
      } else if (key !== paintedKey) {
        // The owners changed while nothing was drawn (a hidden tab): the whole layer again.
        paintMap(mapContext, paint, owners, null);
        paintedKey = key;
      }
    };
    const paintMotion = (clock: MotionClock): void => {
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, laid.width, laid.height);
      drawMotion(context, colours, laid, places, clock, script);
    };
    const place = (clock: MotionClock): void => {
      const found = sightOf(laid, places, clock);
      const next =
        found === null
          ? null
          : { ...found, x: Math.round(found.x), y: Math.round(found.y), r: Math.round(found.r) };
      const shown = untrack(() => sight);
      if (!sameSight(shown, next)) sight = next;
    };

    const first = clockAt(now, reducedMotion());
    paintLayer(first);
    paintMotion(first);
    place(first);
    const fontsKnown = fontsReady || (document as Partial<Document>).fonts === undefined;
    ready = fontsKnown && (graded !== null || known === null || known.ground === null);
    // A locked queue is a still picture (the supply stands), so is a frozen dev scene: no loop.
    const still = first.reduced || current === 'banned' || frozen !== null;
    if (still || typeof requestAnimationFrame !== 'function') return undefined;

    let handle = 0;
    let lastFrame = 0;
    let lastSight = now;
    // "Less motion" switched on while the menu is open: one still frame, then nothing to repaint.
    let calmPainted = false;
    // A hidden tab gets no frames at all (the browser stops them): the loop costs nothing then.
    const frame = (at: number): void => {
      handle = requestAnimationFrame(frame);
      if (at - lastFrame < FRAME_MS - 2) return;
      lastFrame = at;
      const calm = reducedMotion();
      if (calm && calmPainted) return;
      calmPainted = calm;
      const clock = clockAt(at, calm);
      paintLayer(clock);
      paintMotion(clock);
      if (calm || at - lastSight >= SIGHT_MS) {
        lastSight = at;
        place(clock);
      }
    };
    handle = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(handle);
    };
  });

  /** The two capitals in world units (drawn on their own layer, over the fog). */
  const capitalAt = (id: number | undefined): Point | null =>
    scene?.nodes.find((n) => n.id === id)?.world ?? null;
  const ownCapital = $derived(capitalAt(scene?.capitalIds[0]));
  const enemyCapital = $derived(capitalAt(scene?.capitalIds[1]));

  const worldTransform = $derived(
    scene === null
      ? ''
      : `translate(${scene.origin.x.toFixed(2)} ${scene.origin.y.toFixed(2)}) scale(${scene.scale.toFixed(4)})`,
  );
</script>

<!-- Four layers, each its own: the map (the baked ground, the territory, the roads, the cities and
     their names) is one canvas drawn once, and again only round a capture while it floods (#866);
     the fog repaints only when the hole of the scout's sight moves (10 times a second at most); the
     motion is one canvas; the capitals stand on top. The map is the match's (#839): the Intaglio
     ground of the menu map, the territory as the Border band, roads and cities engraved. -->
<div
  class={`backdrop ${season}`}
  class:entry
  bind:this={host}
  aria-hidden="true"
  data-map={ready ? 'ready' : 'pending'}
  style:--map-ink={MENU_INK}
>
  {#if scene !== null && map !== null}
    <canvas class="map layer" bind:this={mapCanvas}></canvas>

    <!-- The fog on the enemy side: the Ruled veil of the match (dark, one run of fine horizontal
         rules) with a soft left edge; the scout's sight cuts a soft hole in it (DEC-35: own groups
         are the source of sight). The entry screen has no fog. -->
    {#if scene.fog}
      <svg
        class="fog layer"
        viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
        width={scene.width}
        height={scene.height}
        focusable="false"
      >
        <defs>
          <linearGradient
            id="menu-fog"
            gradientUnits="userSpaceOnUse"
            x1={scene.fadeStart}
            x2={scene.fogStart}
            y1="0"
            y2="0"
          >
            <stop offset="0" class="stop-fog-0" />
            <stop offset="1" class="stop-fog-1" />
          </linearGradient>
          <linearGradient
            id="menu-fog-mask"
            gradientUnits="userSpaceOnUse"
            x1={scene.fadeStart}
            x2={scene.fogStart}
            y1="0"
            y2="0"
          >
            <stop offset="0" stop-color="#000" />
            <stop offset="1" stop-color="#fff" />
          </linearGradient>
          <linearGradient
            id="menu-top-mask"
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="0"
            y1={BAR_BOTTOM}
            y2={BAR_BOTTOM + FOG_TOP_FADE}
          >
            <stop offset="0" stop-color="#000" />
            <stop offset="1" stop-color="#fff" />
          </linearGradient>
          <radialGradient id="menu-sight-hole">
            <stop offset="0.7" stop-color="#000" />
            <stop offset="0.85" stop-color="#000" stop-opacity="0.55" />
            <stop offset="1" stop-color="#000" stop-opacity="0" />
          </radialGradient>
          <!-- The fog does not reach the title bar: the chip of the player is there (#471). -->
          <mask
            id="menu-fog-top"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={scene.width}
            height={scene.height}
          >
            <rect
              x="0"
              y="0"
              width={scene.width}
              height={scene.height}
              fill="url(#menu-top-mask)"
            />
            {#if sight !== null}
              <circle
                class="sight-hole"
                cx={sight.x}
                cy={sight.y}
                r={sight.r}
                fill="url(#menu-sight-hole)"
              />
            {/if}
          </mask>
          <mask
            id="menu-fog-rules"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={scene.width}
            height={scene.height}
          >
            <rect
              x="0"
              y="0"
              width={scene.width}
              height={scene.height}
              fill="url(#menu-fog-mask)"
            />
          </mask>
          <pattern id="menu-rules" width="8" height="3.4" patternUnits="userSpaceOnUse">
            <rect width="8" height="1" class="rule-line" />
          </pattern>
        </defs>
        <g mask="url(#menu-fog-top)">
          <rect
            x={scene.fadeStart}
            y="0"
            width={scene.width - scene.fadeStart}
            height={scene.height}
            fill="url(#menu-fog)"
          />
          <rect
            x={scene.fadeStart}
            y="0"
            width={scene.width - scene.fadeStart}
            height={scene.height}
            fill="url(#menu-rules)"
            mask="url(#menu-fog-rules)"
          />
        </g>
      </svg>
    {/if}

    <canvas class="motion layer" bind:this={canvas}></canvas>

    <svg
      class="capitals layer"
      viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
      width={scene.width}
      height={scene.height}
      focusable="false"
    >
      {#if ownCapital !== null && enemyCapital !== null}
        {@const own = menuCity('capital', ownCapital)}
        {@const enemy = menuCity('capital', enemyCapital)}
        {@const e = scene.enemyCapital}
        {@const ringPx = own.ring.radius * k * scene.scale}
        <g transform={worldTransform}>
          <!-- The own capital: the engraved disc and star on its ring of places. -->
          {#if phase === 'banned'}
            <circle
              class="ban-ring pulse"
              cx={ownCapital.x}
              cy={ownCapital.y}
              r={(own.ring.radius + 9) * k}
              stroke-width={2 * px}
              stroke-dasharray={`${String(6 * px)} ${String(4 * px)}`}
            />
          {/if}
          <MenuCityMark piece={own} side="own" capital {k} />

          <!-- The enemy capital: unknown behind the fog, the engraved city once a pair is found;
               on the entry screen (no fog) a plain enemy capital. -->
          {#if !scene.fog || revealed}
            <g class:reveal={scene.fog}>
              {#if scene.fog}
                <circle
                  cx={enemyCapital.x}
                  cy={enemyCapital.y}
                  r={(enemy.ring.radius + 12) * k}
                  class="enemy-plate"
                />
              {/if}
              <MenuCityMark piece={enemy} side="enemy" capital {k} />
            </g>
          {:else}
            <circle
              cx={enemyCapital.x}
              cy={enemyCapital.y}
              r={(enemy.radius + 3.2) * k}
              class="unknown-plate"
            />
            <circle
              cx={enemyCapital.x}
              cy={enemyCapital.y}
              r={enemy.radius * k}
              class="unknown march"
              stroke-width={1.6 * px}
              stroke-dasharray={`${String(5 * px)} ${String(4 * px)}`}
            />
          {/if}
        </g>
        {#if scene.fog && !revealed}
          <text x={e.x} y={e.y + 6} text-anchor="middle" class="unknown-mark">?</text>
        {/if}
        {#if scene.fog && revealed && opponent !== null}
          <!-- The opponent's name under its capital, on a dark tag in a double rule. -->
          <g class="reveal">
            <rect x={e.x - 52} y={e.y + ringPx + 8} width="104" height="26" class="nick-plate" />
            <rect x={e.x - 49} y={e.y + ringPx + 11} width="98" height="20" class="nick-rule" />
            <text x={e.x} y={e.y + ringPx + 25.5} text-anchor="middle" class="nick-text"
              >{opponent.length > 12 ? `${opponent.slice(0, 11)}…` : opponent}</text
            >
          </g>
        {/if}
      {/if}
    </svg>
  {/if}
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Each layer is composited on its own: the motion and the fog hole never repaint the map. */
  .layer {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  .map,
  .motion {
    width: 100%;
    height: 100%;
  }
  /* The entry (#866): the motion is muted behind the title, lower in contrast than the main menu's. */
  .entry .motion {
    opacity: 0.6;
  }

  .stop-fog-0 {
    stop-color: var(--plate);
    stop-opacity: 0;
  }
  .stop-fog-1 {
    stop-color: var(--plate);
    stop-opacity: 0.86;
  }
  .rule-line {
    fill: var(--cut);
    opacity: 0.5;
  }

  .enemy-plate {
    fill: var(--plate);
    opacity: 0.72;
  }
  .nick-plate {
    fill: var(--plate);
    fill-opacity: 0.92;
    stroke: var(--cut);
    stroke-width: 1;
  }
  .nick-rule {
    fill: none;
    stroke: var(--enemy);
    stroke-width: 1;
  }
  .nick-text {
    fill: var(--ink);
    font: 500 12px var(--font-display);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .unknown-plate {
    fill: var(--plate);
    fill-opacity: 0.9;
  }
  .unknown {
    fill: none;
    stroke: var(--enemy);
    stroke-width: 1.6;
    stroke-dasharray: 5 4;
  }
  .unknown-mark {
    fill: var(--enemy);
    font: 500 19px var(--font-text);
  }
  .ban-ring {
    fill: none;
    stroke: var(--warn);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }

  .march {
    animation: march 1.1s linear infinite;
  }
  .pulse {
    animation: pulse 1.25s ease-in-out infinite;
  }
  /* The opponent shows up where the scout looked: the name fades in with the sight. */
  .reveal {
    animation: reveal 1.2s ease-out both;
  }

  @keyframes march {
    to {
      stroke-dashoffset: -18;
    }
  }
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }

  /* The state stays readable without the motion: the "?" ring still dashed, the ring still amber. */
  @media (prefers-reduced-motion: reduce) {
    .march,
    .pulse,
    .reveal {
      animation: none;
    }
  }
</style>
