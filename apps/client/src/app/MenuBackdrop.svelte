<script lang="ts">
  import { untrack } from 'svelte';
  import type { MapFile } from '../protocol.gen.ts';
  import { reducedMotion } from '../render/motion.ts';
  import MenuCityMark from './MenuCityMark.svelte';
  import { MENU_GEO, MENU_GROUND, MENU_MAP } from './menuMap.ts';
  import {
    FALLBACK_PALETTE,
    STILL_AT,
    drawMotion,
    sightOf,
    type MotionClock,
    readPalette,
    type Sight,
  } from './menuMotion.ts';
  import { MENU_BORDER, MENU_LANE, menuCity, menuLand, type MenuLand } from './menuPieces.ts';
  import {
    BAR_BOTTOM,
    FOG_TOP_FADE,
    dockOwnLeft,
    layoutEntry,
    layoutScene,
    type BackdropPhase,
    type Point,
    type Scene,
    type SceneEdge,
  } from './menuScene.ts';
  import { currentSeason, groundMatrix } from './menuSeason.ts';
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
    /** The entry screen (#839): the whole map over the window, no fog. */
    entry?: boolean;
  }

  let {
    map,
    phase = 'idle',
    opponent = null,
    waited = 0,
    docked = false,
    entry = false,
  }: Props = $props();

  /** The motion is drawn 30 times a second; the hole of the scout's sight in the fog 10 times. */
  const FRAME_MS = 1000 / 30;
  /** Px on the screen per world unit of a piece of the map at most (`k`). */
  const PIECES_PX = 0.8;
  const SIGHT_MS = 100;

  let host: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let size = $state({ width: 1280, height: 720 });
  /** The hole in the fog round the scout, in whole px (the fog layer repaints only when it moves). */
  let sight = $state.raw<Sight | null>(null);
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

  const scene = $derived<Scene | null>(
    map === null
      ? null
      : entry
        ? layoutEntry(map, size.width, size.height)
        : layoutScene(map, size.width, size.height, docked ? dockOwnLeft(size.width) : undefined),
  );
  const story = $derived<Story | null>(scene === null ? null : storyOf(scene));
  const revealed = $derived((phase === 'found' || phase === 'confirmed') && opponent !== null);
  /** The menu map has its baked ground and its areas; another map is drawn on the flat stone. */
  const menuMap = $derived(map !== null && map.meta.name === MENU_MAP.meta.name);
  const ground = $derived(menuMap ? MENU_GROUND : null);
  /** The world units under one px: lines that must stay a hairline on the screen. */
  const px = $derived(scene === null ? 1 : 1 / Math.max(0.05, scene.scale));
  /**
   * The pieces of the map (cities, roads, the border) at most `PIECES_PX` of their match size on
   * the screen: a map laid out large (the entry screen) keeps small, quiet pieces.
   */
  const k = $derived(scene === null ? 1 : Math.min(1, PIECES_PX / scene.scale));
  const land = $derived<MenuLand | null>(
    map === null ? null : menuLand(map, menuMap ? MENU_GEO : null, k),
  );
  /** The hatch of the band: the match's pitch, never closer than 3 px on the screen. */
  const pitch = $derived(Math.max(MENU_BORDER.band.pitch * k, 3 * px));

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
    const colours = host === undefined ? FALLBACK_PALETTE : readPalette(host);
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

  /** How a road is drawn: an own road, the opponent's (in the fog), a buffer road, a road in the fog. */
  function roadKind(edge: SceneEdge, laid: Scene): 'own' | 'enemy' | 'buffer' | 'fog' {
    const hidden = laid.fog && edge.a.x > laid.fadeStart && edge.b.x > laid.fadeStart;
    if (edge.own) return 'own';
    if (edge.a.owner === 1 && edge.b.owner === 1) return hidden ? 'fog' : 'enemy';
    return hidden ? 'fog' : 'buffer';
  }

  /** The two capitals in world units (drawn on their own layer, over the fog). */
  const capitalAt = (id: number | undefined): Point | null =>
    scene?.nodes.find((n) => n.id === id)?.world ?? null;
  const ownCapital = $derived(capitalAt(scene?.capitalIds[0]));
  const enemyCapital = $derived(capitalAt(scene?.capitalIds[1]));

  /** A transform that scales a piece by `by` about its centre `c` (world units). */
  const about = (c: Point, by: number): string =>
    `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${by.toFixed(4)}) translate(${(-c.x).toFixed(2)} ${(-c.y).toFixed(2)})`;

  /** The dashes of the lane of a road, in world units scaled with the pieces. */
  const dashes = (kind: string): string | undefined =>
    kind === 'buffer'
      ? `${String(7 * k)} ${String(5 * k)}`
      : kind === 'fog'
        ? `${String(1.5 * k)} ${String(4.5 * k)}`
        : undefined;

  const world = $derived(
    scene === null
      ? ''
      : `translate(${scene.origin.x.toFixed(2)} ${scene.origin.y.toFixed(2)}) scale(${scene.scale.toFixed(4)})`,
  );
</script>

<!-- Four layers, each its own: the map is drawn once (its baked ground never repaints), the fog
     repaints only when the hole of the scout's sight moves (10 times a second at most), the motion is
     one canvas, and the capitals stand on top. The map is the match's (#839): the Intaglio ground of
     the menu map, the start territory as the Border band, roads and cities engraved. -->
<div class={`backdrop ${season}`} class:entry bind:this={host} aria-hidden="true">
  {#if scene !== null && map !== null && land !== null}
    <svg
      class="scene layer"
      viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
      width={scene.width}
      height={scene.height}
      focusable="false"
    >
      <defs>
        <filter id="menu-grade" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values={matrix} />
        </filter>
        <filter id="menu-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <!-- The baked ground fades into the stone at its edges (the map does not fill the window). -->
        <mask
          id="menu-ground-edge"
          maskUnits="userSpaceOnUse"
          x={-80}
          y={-80}
          width={map.meta.width + 160}
          height={map.meta.height + 160}
        >
          <rect
            x="34"
            y="34"
            width={Math.max(0, map.meta.width - 68)}
            height={Math.max(0, map.meta.height - 68)}
            fill="#fff"
            filter="url(#menu-soft)"
          />
        </mask>
        <pattern id="menu-band-own" width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={pitch} height={Math.max(MENU_BORDER.band.width, px)} class="hatch-own" />
        </pattern>
        <pattern
          id="menu-band-enemy"
          width={pitch}
          height={pitch}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width={pitch} height={Math.max(MENU_BORDER.band.width, px)} class="hatch-enemy" />
        </pattern>
        <pattern
          id="menu-neutral"
          width="2.6"
          height="2.6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="2.6" height="0.7" class="hatch-neutral" />
        </pattern>
        <clipPath id="menu-land-own" clipPathUnits="userSpaceOnUse">
          <path d={land.own.cells} />
        </clipPath>
        <clipPath id="menu-land-enemy" clipPathUnits="userSpaceOnUse">
          <path d={land.enemy.cells} />
        </clipPath>
      </defs>

      <g transform={world}>
        <!-- The ground: the baked Intaglio of the menu map, graded by the season and darker. -->
        {#if ground !== null}
          <g mask="url(#menu-ground-edge)">
            <image
              href={ground}
              width={map.meta.width}
              height={map.meta.height}
              preserveAspectRatio="none"
              filter="url(#menu-grade)"
            />
          </g>
        {/if}

        <!-- The start territory: the Border band (own horizontal, the enemy's at 45 degrees) and
             the engraved border (a dark cut, the owner's rule, a second rule or a row of beads). -->
        {#each [['own', land.own], ['enemy', land.enemy]] as const as [side, part] (side)}
          <path
            d={part.band}
            class="band"
            stroke={`url(#menu-band-${side})`}
            stroke-width={MENU_BORDER.band.depth * 2 * k}
            clip-path={`url(#menu-land-${side})`}
          />
          <path d={part.cut} class="cut" stroke-width={Math.max(MENU_BORDER.cut.width * k, px)} />
          <path
            d={part.rule}
            class={`rule ${side}`}
            stroke-width={Math.max(MENU_BORDER.rule.width * k, px)}
          />
          {#if side === 'own'}
            <path
              d={part.inner}
              class="rule own"
              stroke-width={Math.max(MENU_BORDER.rule2.width * k, px)}
            />
          {:else}
            <path
              d={part.inner}
              class="beads"
              stroke-width={Math.max(MENU_BORDER.beads.radius * 2 * k, px)}
              stroke-dasharray={`0 ${String(MENU_BORDER.beads.step * k)}`}
            />
          {/if}
        {/each}

        <!-- Roads as the match draws them at level 1: an own road is a band of the owner's colour
             with a light lane, a buffer road dashed lanes on a dark casing, a road in fog dotted. -->
        {#each scene.edges as edge, i (i)}
          {@const kind = roadKind(edge, scene)}
          {@const a = edge.a.world}
          {@const b = edge.b.world}
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            class={`road-casing ${kind}`}
            stroke-width={(MENU_LANE + (kind === 'fog' ? 3 : 3.6)) * k}
          />
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            class={`road-lane ${kind}`}
            stroke-width={Math.max(MENU_LANE * k, px)}
            stroke-dasharray={dashes(kind)}
          />
        {/each}

        <!-- Cities: the disc on a dark cut with an ink rim, on its ring of places; a province is a
             dark plate with the owner's dot. The capitals stand on their own layer. -->
        {#each scene.nodes as node (node.id)}
          {#if !scene.capitalIds.includes(node.id)}
            {@const c = node.world}
            {@const side = node.owner === 0 ? 'own' : node.owner === 1 ? 'enemy' : 'neutral'}
            {#if node.city}
              <MenuCityMark piece={menuCity(node.kind, c)} {side} {k} />
            {:else}
              <g transform={about(c, k)}>
                <circle cx={c.x} cy={c.y} r="8" class="prov-plate" />
                {#if side === 'neutral'}
                  <circle cx={c.x} cy={c.y} r="6" class="prov-ring" />
                  <circle cx={c.x} cy={c.y} r="1.5" class="prov-dot" />
                {:else}
                  <circle cx={c.x} cy={c.y} r="6.4" class={`prov ${side}`} />
                  <circle cx={c.x} cy={c.y} r="7.6" class="prov-ring" />
                  {#if side === 'enemy'}<circle cx={c.x} cy={c.y} r="10" class="prov-ring" />{/if}
                {/if}
              </g>
            {/if}
          {/if}
        {/each}

        <!-- The names of the cities in cut capitals, small and faint (the Lapis plate of #826). -->
        {#each scene.nodes as node (node.id)}
          {#if node.city}
            <text
              x={node.world.x}
              y={node.world.y + menuCity(node.kind, node.world).ring.radius * k + 11 * px}
              class="name"
              font-size={10 * px}
              letter-spacing={1.8 * px}
              text-anchor="middle">{node.name.toUpperCase()}</text
            >
          {/if}
        {/each}
      </g>
    </svg>

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
        <g transform={world}>
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
  .motion {
    width: 100%;
    height: 100%;
  }

  .hatch-own {
    fill: var(--own);
    opacity: 0.85;
  }
  .hatch-enemy {
    fill: var(--enemy);
    opacity: 0.85;
  }
  .hatch-neutral {
    fill: var(--neutral);
    opacity: 0.7;
  }

  .band {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cut {
    fill: none;
    stroke: var(--cut);
    stroke-opacity: 0.85;
    stroke-linejoin: round;
  }
  .rule {
    fill: none;
    stroke-linejoin: round;
  }
  .rule.own {
    stroke: var(--own);
  }
  .rule.enemy {
    stroke: var(--enemy);
  }
  .beads {
    fill: none;
    stroke: var(--enemy);
    stroke-linecap: round;
  }

  .road-casing {
    stroke-linecap: butt;
  }
  .road-casing.own {
    stroke: var(--own);
    stroke-opacity: 0.62;
  }
  .road-casing.enemy {
    stroke: var(--enemy);
    stroke-opacity: 0.62;
  }
  .road-casing.buffer {
    stroke: var(--cut);
    stroke-opacity: 0.4;
  }
  .road-casing.fog {
    stroke: var(--cut);
    stroke-opacity: 0.3;
  }
  .road-lane.own,
  .road-lane.enemy {
    stroke: #e6edf3;
    stroke-opacity: 0.95;
  }
  .road-lane.buffer {
    stroke: #aab2bd;
    stroke-opacity: 0.95;
  }
  .road-lane.fog {
    stroke: #aab2bd;
    stroke-opacity: 0.75;
  }

  .prov-plate {
    fill: var(--plate);
  }
  .prov.own {
    fill: var(--own);
  }
  .prov.enemy {
    fill: var(--enemy);
  }
  .prov-ring {
    fill: none;
    stroke: var(--ink);
    stroke-width: 0.9;
  }
  .prov-dot {
    fill: var(--neutral);
  }
  .name {
    fill: var(--ink);
    fill-opacity: 0.62;
    font-family: var(--font-display);
    font-weight: 500;
    paint-order: stroke;
    stroke: var(--plate);
    stroke-opacity: 0.7;
    stroke-width: 2.4px;
    vector-effect: non-scaling-stroke;
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
