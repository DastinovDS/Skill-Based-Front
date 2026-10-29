<script lang="ts">
  import { untrack } from 'svelte';
  import type { MapFile } from '../protocol.gen.ts';
  import { reducedMotion } from '../render/motion.ts';
  import {
    FALLBACK_PALETTE,
    STILL_AT,
    drawMotion,
    sightOf,
    type MotionClock,
    type Palette,
    type Sight,
  } from './menuMotion.ts';
  import {
    BAR_BOTTOM,
    FOG_TOP_FADE,
    dockOwnLeft,
    layoutScene,
    starPoints,
    type BackdropPhase,
    type Point,
    type Scene,
  } from './menuScene.ts';
  import { currentSeason } from './menuSeason.ts';
  import { storyOf, type Story } from './menuStory.ts';

  interface Props {
    /** The map to draw; without it the backdrop is the plain dark page. */
    map: MapFile | null;
    phase?: BackdropPhase;
    /** The opponent's nick, written under the enemy capital once a pair is found. */
    opponent?: string | null;
    /** Seconds in the queue (the search): where the scout is, how big the stack at the front is. */
    waited?: number;
    /** A panel stands right of the rail (#473): the map moves out from under it where the window allows. */
    docked?: boolean;
  }

  let { map, phase = 'idle', opponent = null, waited = 0, docked = false }: Props = $props();

  /** The motion is drawn 30 times a second; the hole of the scout's sight in the fog 10 times. */
  const FRAME_MS = 1000 / 30;
  const SIGHT_MS = 100;

  let host: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let size = $state({ width: 1280, height: 720 });
  /** The hole in the fog round the scout, in whole px (the fog layer repaints only when it moves). */
  let sight = $state.raw<Sight | null>(null);
  const season = currentSeason();

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

  const scene = $derived<Scene | null>(
    map === null
      ? null
      : layoutScene(map, size.width, size.height, docked ? dockOwnLeft(size.width) : undefined),
  );
  const story = $derived<Story | null>(scene === null ? null : storyOf(scene));
  const revealed = $derived((phase === 'found' || phase === 'confirmed') && opponent !== null);

  /** The token colours, read from the page once the backdrop is in it. */
  function palette(element: Element): Palette {
    const style = getComputedStyle(element);
    const token = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      bg: token('--bg', FALLBACK_PALETTE.bg),
      paper: token('--paper', FALLBACK_PALETTE.paper),
      dim: token('--text-dim', FALLBACK_PALETTE.dim),
      you: token('--you', FALLBACK_PALETTE.you),
      enemy: token('--enemy', FALLBACK_PALETTE.enemy),
    };
  }

  function sameSight(a: Sight | null, b: Sight | null): boolean {
    if (a === null || b === null) return a === b;
    return a.x === b.x && a.y === b.y && a.r === b.r;
  }

  // The phase clock: when the phase began and how long the queue had waited then.
  let clockPhase: BackdropPhase | null = null;
  let phaseStart = 0;
  let waitedAtStart = 0;

  $effect(() => {
    const target = canvas;
    const laid = scene;
    const places = story;
    const current = phase;
    if (target === undefined || laid === null || places === null) return undefined;
    const now = performance.now();
    if (current !== clockPhase) {
      clockPhase = current;
      phaseStart = now;
      waitedAtStart = untrack(() => waited);
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    target.width = Math.round(laid.width * ratio);
    target.height = Math.round(laid.height * ratio);
    // jsdom has no 2D canvas: the picture then stays still, the fog hole still follows the clock.
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = target.getContext('2d');
    } catch {
      context = null;
    }
    const colours = host === undefined ? FALLBACK_PALETTE : palette(host);
    const clockAt = (at: number, still: boolean): MotionClock =>
      still
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
            g: at / 1000,
            waited: waitedAtStart,
            reduced: false,
          };
    const paint = (clock: MotionClock): void => {
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, laid.width, laid.height);
      drawMotion(context, colours, laid, places, clock);
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
    paint(first);
    place(first);
    // A locked queue is a still picture (the supply stands): no loop to run.
    const still = first.reduced || current === 'banned';
    if (still || typeof requestAnimationFrame !== 'function') return undefined;

    let handle = 0;
    let lastFrame = 0;
    let lastSight = now;
    // "Less motion" switched on while the menu is open: one still frame, then nothing to repaint.
    let calmPainted = false;
    const frame = (at: number): void => {
      handle = requestAnimationFrame(frame);
      if (at - lastFrame < FRAME_MS - 2) return;
      lastFrame = at;
      const calm = reducedMotion();
      if (calm && calmPainted) return;
      calmPainted = calm;
      const clock = clockAt(at, calm);
      paint(clock);
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

  const line = (from: Point, to: Point): { x1: number; y1: number; x2: number; y2: number } => ({
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
  });

  /** A parallel copy of a road at `offset` px, for the lines of a wide road. */
  function parallel(
    a: Point,
    b: Point,
    offset: number,
  ): { x1: number; y1: number; x2: number; y2: number } {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / length) * offset;
    const ny = ((b.x - a.x) / length) * offset;
    return { x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny };
  }

  const ring = 22;
  const ringLength = 2 * Math.PI * ring;
</script>

<!-- Four layers, each its own: the map is drawn once (its blurred terrain never repaints), the fog
     repaints only when the hole of the scout's sight moves (10 times a second at most), the motion is
     one canvas, and the capitals stand on top. -->
<div class={`backdrop ${season}`} bind:this={host} aria-hidden="true">
  {#if scene !== null}
    <svg
      class="scene layer"
      viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
      width={scene.width}
      height={scene.height}
      focusable="false"
    >
      <defs>
        <radialGradient id="menu-you" cx="38%" cy="30%" r="80%">
          <stop offset="0" class="stop-you-hi" />
          <stop offset="1" class="stop-you" />
        </radialGradient>
        <radialGradient id="menu-enemy" cx="38%" cy="30%" r="80%">
          <stop offset="0" class="stop-enemy-hi" />
          <stop offset="1" class="stop-enemy" />
        </radialGradient>
        <filter id="menu-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <!-- Terrain: soft blobs in the colours of the season, one blurred layer drawn once. -->
      <g filter="url(#menu-blur)" opacity="0.7">
        {#each scene.nodes as node (node.id)}
          <circle
            cx={node.x}
            cy={node.y}
            r={scene.terrainRadius}
            class={`terrain ${node.terrain}`}
          />
        {/each}
      </g>
      <!-- Territory at the start: the own side in blue, the enemy's in red (it is in the fog). -->
      {#each scene.nodes as node (node.id)}
        {#if node.owner !== null}
          <circle
            cx={node.x}
            cy={node.y}
            r={scene.territoryRadius}
            class={node.owner === 0 ? 'land-you' : 'land-enemy'}
          />
        {/if}
      {/each}

      <g opacity="0.5">
        {#each scene.edges as edge, i (i)}
          {#if !edge.own}
            {@const hidden = edge.a.x > scene.fadeStart && edge.b.x > scene.fadeStart}
            <line {...line(edge.a, edge.b)} class={hidden ? 'road-fog' : 'road-border-shade'} />
            {#if !hidden}
              <line {...line(edge.a, edge.b)} class="road-border" />
            {/if}
          {/if}
        {/each}
      </g>
      {#each scene.edges as edge, i (i)}
        {#if edge.own}
          <line
            {...line(edge.a, edge.b)}
            class="road-own"
            stroke-width={2 + edge.lines * 1.6 + 3.6}
          />
          {#each Array.from({ length: edge.lines }, (_, k) => k) as k (k)}
            <line
              {...parallel(edge.a, edge.b, (k - (edge.lines - 1) / 2) * 3.4)}
              class="road-line"
            />
          {/each}
        {/if}
      {/each}

      {#each scene.nodes as node (node.id)}
        {#if node.city}
          {#if !scene.capitalIds.includes(node.id)}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.owner === 0 ? 9 : 8}
              class={node.owner === 0
                ? 'city-you'
                : node.owner === 1
                  ? 'city-enemy'
                  : 'city-neutral'}
            />
          {/if}
        {:else}
          <circle cx={node.x} cy={node.y} r="7.5" class="prov-shade" />
          <circle
            cx={node.x}
            cy={node.y}
            r="5.5"
            class={node.owner === 0 ? 'prov-you' : node.owner === 1 ? 'prov-enemy' : 'prov-neutral'}
          />
        {/if}
      {/each}
    </svg>

    <!-- The fog on the enemy side: a veil with a soft left edge and hatching, as on the match map;
         the scout's sight cuts a soft hole in it (DEC-35: own groups are the source of sight). -->
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
          <rect x="0" y="0" width={scene.width} height={scene.height} fill="url(#menu-top-mask)" />
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
          id="menu-fog-hatch"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={scene.width}
          height={scene.height}
        >
          <rect x="0" y="0" width={scene.width} height={scene.height} fill="url(#menu-fog-mask)" />
        </mask>
        <pattern
          id="menu-hatch"
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="1.6" height="9" class="hatch" />
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
          fill="url(#menu-hatch)"
          mask="url(#menu-fog-hatch)"
        />
      </g>
    </svg>

    <canvas class="motion layer" bind:this={canvas}></canvas>

    <svg
      class="capitals layer"
      viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
      width={scene.width}
      height={scene.height}
      focusable="false"
    >
      <!-- The own capital. -->
      {#if phase === 'banned'}
        <circle class="ban-ring pulse" cx={scene.ownCapital.x} cy={scene.ownCapital.y} r="27" />
      {/if}
      <circle cx={scene.ownCapital.x} cy={scene.ownCapital.y} r="15" class="capital-you" />
      <polygon points={starPoints(scene.ownCapital.x, scene.ownCapital.y, 7.5)} class="star" />
      <circle cx={scene.ownCapital.x} cy={scene.ownCapital.y} r={ring} class="seg-shade" />
      <circle
        cx={scene.ownCapital.x}
        cy={scene.ownCapital.y}
        r={ring}
        class="seg"
        stroke-dasharray={`${String(ringLength / 5 - 3)} 3`}
        transform={`rotate(-90 ${String(scene.ownCapital.x)} ${String(scene.ownCapital.y)})`}
      />

      <!-- The enemy capital: unknown behind the fog, a name once a pair is found. -->
      {#if revealed && opponent !== null}
        <g class="reveal">
          <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="34" class="enemy-plate" />
          <circle
            cx={scene.enemyCapital.x}
            cy={scene.enemyCapital.y}
            r="16"
            class="capital-enemy"
          />
          <polygon
            points={starPoints(scene.enemyCapital.x, scene.enemyCapital.y, 8)}
            class="star"
          />
          <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="23" class="seg-shade" />
          <circle
            cx={scene.enemyCapital.x}
            cy={scene.enemyCapital.y}
            r="23"
            class="seg-enemy"
            stroke-dasharray={`${String((2 * Math.PI * 23) / 5 - 3)} 3`}
            transform={`rotate(-90 ${String(scene.enemyCapital.x)} ${String(scene.enemyCapital.y)})`}
          />
          <rect
            x={scene.enemyCapital.x - 48}
            y={scene.enemyCapital.y + 32}
            width="96"
            height="24"
            rx="12"
            class="nick-plate"
          />
          <text
            x={scene.enemyCapital.x}
            y={scene.enemyCapital.y + 49}
            text-anchor="middle"
            class="nick-text">{opponent.length > 12 ? `${opponent.slice(0, 11)}…` : opponent}</text
          >
        </g>
      {:else}
        <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="17" class="unknown-plate" />
        <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="16" class="unknown march" />
        <text
          x={scene.enemyCapital.x}
          y={scene.enemyCapital.y + 6}
          text-anchor="middle"
          class="unknown-mark">?</text
        >
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
  .motion {
    width: 100%;
    height: 100%;
  }

  /* The season of the date as a still tint of the terrain (#474, BG4 in BG5); summer is the default of app.css. */
  .backdrop.spring {
    --terrain-plains: #405233;
    --terrain-forest: #2b4632;
    --terrain-mountains: #4a4740;
  }
  .backdrop.autumn {
    --terrain-plains: #47452f;
    --terrain-forest: #43382a;
  }
  .backdrop.winter {
    --terrain-plains: #464c53;
    --terrain-forest: #2f3c3b;
    --terrain-mountains: #5b5e64;
  }

  .stop-you-hi {
    stop-color: color-mix(in srgb, var(--you) 60%, white);
  }
  .stop-you {
    stop-color: var(--you);
  }
  .stop-enemy-hi {
    stop-color: color-mix(in srgb, var(--enemy) 60%, white);
  }
  .stop-enemy {
    stop-color: var(--enemy);
  }
  .stop-fog-0 {
    stop-color: var(--bg);
    stop-opacity: 0;
  }
  .stop-fog-1 {
    stop-color: var(--bg);
    stop-opacity: 0.9;
  }
  .hatch {
    fill: var(--text-dim);
    opacity: 0.16;
  }

  .terrain.plains {
    fill: var(--terrain-plains);
  }
  .terrain.forest {
    fill: var(--terrain-forest);
  }
  .terrain.mountains {
    fill: var(--terrain-mountains);
  }
  .land-you {
    fill: var(--you);
    opacity: 0.16;
  }
  .land-enemy {
    fill: var(--enemy);
    opacity: 0.12;
  }

  .road-fog {
    stroke: #aab2bd;
    stroke-opacity: 0.55;
    stroke-width: 1.5;
    stroke-dasharray: 1.5 4.5;
    stroke-linecap: round;
  }
  .road-border-shade {
    stroke: var(--bg);
    stroke-opacity: 0.5;
    stroke-width: 5;
  }
  .road-border {
    stroke: #aab2bd;
    stroke-width: 2;
    stroke-dasharray: 7 5;
  }
  .road-own {
    stroke: var(--you);
    stroke-opacity: 0.55;
    stroke-linecap: round;
  }
  .road-line {
    stroke: var(--text);
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .city-you {
    fill: url(#menu-you);
    stroke: var(--paper);
    stroke-width: 3;
  }
  .city-enemy {
    fill: url(#menu-enemy);
    stroke: var(--paper);
    stroke-width: 3;
  }
  .city-neutral {
    fill: var(--neutral-fill);
    stroke: var(--neutral);
    stroke-width: 2;
  }
  .prov-shade {
    fill: var(--bg);
    fill-opacity: 0.9;
  }
  .prov-you,
  .prov-enemy,
  .prov-neutral {
    fill: none;
    stroke-width: 2.4;
  }
  .prov-you {
    stroke: var(--you);
  }
  .prov-enemy {
    stroke: var(--enemy);
  }
  .prov-neutral {
    stroke: var(--neutral);
  }

  .capital-you {
    fill: url(#menu-you);
    stroke: var(--paper);
    stroke-width: 3;
  }
  .capital-enemy {
    fill: url(#menu-enemy);
    stroke: var(--paper);
    stroke-width: 3;
  }
  .star {
    fill: var(--bg);
    stroke: var(--paper);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .seg-shade {
    fill: none;
    stroke: var(--bg);
    stroke-opacity: 0.8;
    stroke-width: 6;
  }
  .seg,
  .seg-enemy {
    fill: none;
    stroke: var(--paper);
    stroke-width: 3;
  }
  .enemy-plate {
    fill: var(--bg);
    opacity: 0.7;
  }
  .nick-plate {
    fill: var(--bg);
    fill-opacity: 0.9;
    stroke: var(--enemy);
    stroke-width: 1.5;
  }
  .nick-text {
    fill: var(--text);
    font-size: 14px;
    font-weight: 700;
  }
  .unknown-plate {
    fill: var(--bg);
    fill-opacity: 0.85;
  }
  .unknown {
    fill: none;
    stroke: var(--enemy);
    stroke-width: 2.4;
    stroke-dasharray: 7 5;
  }
  .unknown-mark {
    fill: var(--enemy);
    font-size: 18px;
    font-weight: 800;
  }
  .ban-ring {
    fill: none;
    stroke: var(--warn);
    stroke-width: 2.4;
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
      stroke-dashoffset: -24;
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
