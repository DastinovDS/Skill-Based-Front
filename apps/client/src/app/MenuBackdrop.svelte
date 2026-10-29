<script lang="ts">
  import type { MapFile } from '../protocol.gen.ts';
  import {
    BAR_BOTTOM,
    FOG_TOP_FADE,
    layoutScene,
    starPoints,
    type BackdropPhase,
    type Point,
    type Scene,
  } from './menuScene.ts';

  interface Props {
    /** The map to draw; without it the backdrop is the plain dark page. */
    map: MapFile | null;
    phase?: BackdropPhase;
    /** The opponent's nick, written under the enemy capital once a pair is found. */
    opponent?: string | null;
  }

  let { map, phase = 'idle', opponent = null }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let size = $state({ width: 1280, height: 720 });

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
    map === null ? null : layoutScene(map, size.width, size.height),
  );

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

  const legs = $derived(
    scene === null
      ? []
      : scene.front.slice(1).map((to, i) => [scene.front[i] as Point, to] as const),
  );
  const ring = 22;
  const ringLength = 2 * Math.PI * ring;
</script>

<div class="backdrop" bind:this={host} aria-hidden="true">
  {#if scene !== null}
    <svg
      class="scene"
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
        <filter id="menu-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <!-- Terrain: soft blobs, one blurred layer (a static one, drawn once). -->
      <g filter="url(#menu-blur)" opacity="0.7">
        {#each scene.nodes as node (node.id)}
          <circle cx={node.x} cy={node.y} r={147 * scene.scale} class={`terrain ${node.terrain}`} />
        {/each}
      </g>
      <!-- Territory at the start: the own side in blue, the enemy's in red (it is in the fog). -->
      {#each scene.nodes as node (node.id)}
        {#if node.owner !== null}
          <circle
            cx={node.x}
            cy={node.y}
            r={116 * scene.scale}
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

      <!-- The road into the fog: marching while we search, solid once a pair is found. -->
      {#if phase === 'search' || phase === 'found'}
        {#each legs as [from, to], i (i)}
          <line {...line(from, to)} class={phase === 'search' ? 'road-march' : 'road-found'} />
        {/each}
      {/if}

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

      <!-- The fog on the enemy side: a veil with a soft left edge and hatching, as on the match map. -->
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

      <!-- The own capital. -->
      {#if phase === 'banned'}
        <circle class="ban-ring pulse" cx={scene.ownCapital.x} cy={scene.ownCapital.y} r="27" />
      {/if}
      {#if phase === 'search'}
        {#each [0, 1] as i (i)}
          <circle
            class="grow"
            style:animation-delay={`${String(i * 1.2)}s`}
            cx={scene.ownCapital.x}
            cy={scene.ownCapital.y}
            r="16"
          />
        {/each}
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
      {#if phase === 'found' && opponent !== null}
        <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="34" class="enemy-plate" />
        <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="16" class="capital-enemy" />
        <polygon points={starPoints(scene.enemyCapital.x, scene.enemyCapital.y, 8)} class="star" />
        <circle cx={scene.enemyCapital.x} cy={scene.enemyCapital.y} r="23" class="seg-shade" />
        <circle
          cx={scene.enemyCapital.x}
          cy={scene.enemyCapital.y}
          r="23"
          class="seg-enemy"
          stroke-dasharray={`${String((2 * Math.PI * 23) / 5 - 3)} 3`}
          transform={`rotate(-90 ${String(scene.enemyCapital.x)} ${String(scene.enemyCapital.y)})`}
        />
        <g>
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

  .scene {
    position: absolute;
    inset: 0;
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
  .road-march {
    stroke: var(--paper);
    stroke-width: 2.4;
    stroke-dasharray: 12 12;
    stroke-linecap: round;
    animation: march 1.1s linear infinite;
  }
  .road-found {
    stroke: var(--paper);
    stroke-width: 2.4;
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

  .grow {
    fill: none;
    stroke: var(--you);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
    animation: grow 2.4s ease-out infinite;
  }
  .march {
    animation: march 1.1s linear infinite;
  }
  .pulse {
    animation: pulse 1.25s ease-in-out infinite;
  }

  @keyframes march {
    to {
      stroke-dashoffset: -24;
    }
  }
  @keyframes grow {
    from {
      transform: scale(0.8);
      opacity: 0.9;
    }
    to {
      transform: scale(2.4);
      opacity: 0;
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

  /* The state stays readable without the motion: the road is still dashed, the ring still amber. */
  @media (prefers-reduced-motion: reduce) {
    .road-march,
    .march,
    .grow,
    .pulse {
      animation: none;
    }
    .grow {
      opacity: 0.5;
    }
  }
</style>
