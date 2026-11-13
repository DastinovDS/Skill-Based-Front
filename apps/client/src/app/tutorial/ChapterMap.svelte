<script lang="ts">
  import type { Chapter } from '../../protocol.gen.ts';
  import { chapterGround, chapterMap, nodeNamed, SHEET_CROP } from '../../tutorial/chapters.ts';
  import { starPoints } from '../menuScene.ts';

  interface Props {
    chapter: Chapter;
    /** The caption at the foot ("About a minute"). */
    caption: string;
  }

  let { chapter, caption }: Props = $props();

  const map = $derived(chapterMap(chapter));
  const ground = $derived(chapterGround(chapter));
  const crop = $derived(SHEET_CROP[chapter.id]);
  // The crop of the walkthrough, widened to the card's 7:5 so nothing is stretched.
  const box = $derived.by(() => {
    const [x0, y0, x1, y1] = crop.crop;
    const w = x1 - x0;
    const h = y1 - y0;
    const want = 420 / 300;
    if (w / h > want) {
      const nh = w / want;
      return { x: x0, y: y0 - (nh - h) / 2, w, h: nh };
    }
    const nw = h * want;
    return { x: x0 - (nw - w) / 2, y: y0, w: nw, h };
  });
  const nodes = $derived(
    map.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      name: n.name,
      capital: n.capital_of !== null,
      city: n.kind !== 'province',
      side: n.start_owner === 0 ? 'you' : n.start_owner === 1 ? 'enemy' : 'neutral',
    })),
  );
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  // World units per CSS px of the card: the marks keep their size in px whatever the crop.
  const k = $derived(box.w / 420);
  const radius = (n: { capital: boolean; city: boolean }): number =>
    (n.capital ? 11 : n.city ? 8.5 : 5) * k;
  const goals = $derived(
    crop.goals
      .map((name) => nodeNamed(map, name))
      .filter((id): id is number => id !== undefined)
      .map((id) => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined),
  );
  const loz = (x: number, y: number, r: number): string =>
    `M${String(x)} ${String(y - r)}L${String(x + r)} ${String(y)}L${String(x)} ${String(y + r)}L${String(x - r)} ${String(y)}Z`;
</script>

<!-- A crop of the chapter's map with its goals ringed (the intro, Sheet): the real graph on the
     map's own baked ground, the places by their start owner, the goals in the Compass ring. -->
<div class="mapcard">
  <svg
    viewBox="{box.x} {box.y} {box.w} {box.h}"
    preserveAspectRatio="xMidYMid slice"
    style:--k={k}
    aria-hidden="true"
    focusable="false"
  >
    {#if ground !== null}
      <image
        href={ground}
        width={map.meta.width}
        height={map.meta.height}
        preserveAspectRatio="none"
      />
    {/if}
    <rect x={box.x} y={box.y} width={box.w} height={box.h} class="shade" />
    {#each map.edges as edge (edge.id)}
      {@const a = byId.get(edge.a)}
      {@const b = byId.get(edge.b)}
      {#if a !== undefined && b !== undefined}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="casing" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="road" />
      {/if}
    {/each}
    {#each nodes as node (node.id)}
      {@const r = radius(node)}
      <!-- The capacity ring of the map, as a faint ruled ring round every place. -->
      <circle cx={node.x} cy={node.y} r={r + 6 * k} class="cap-ring" />
      {#if node.city}
        <circle cx={node.x} cy={node.y} r={r + 2.5 * k} class="cut" />
        <circle cx={node.x} cy={node.y} {r} class="city {node.side}" />
        {#if node.capital}
          <polygon points={starPoints(node.x, node.y, r * 0.66, 5, 0.45)} class="star" />
        {/if}
      {:else}
        <circle cx={node.x} cy={node.y} {r} class="prov {node.side}" />
      {/if}
      <!-- A ringed goal keeps its name clear of the ring. -->
      <text
        x={node.x}
        y={node.y + r + (goals.some((g) => g.id === node.id) ? 21 : 13) * k}
        class="name">{node.name}</text
      >
    {/each}
    {#each goals as goal (goal.id)}
      {@const r = radius(goal) + 8 * k}
      <circle cx={goal.x} cy={goal.y} {r} class="ring-case" />
      <circle cx={goal.x} cy={goal.y} {r} class="ring" />
      <path d={loz(goal.x, goal.y - r, 4 * k)} class="ring-mark" />
    {/each}
  </svg>
  <span class="cap">{caption}</span>
</div>

<style>
  .mapcard {
    position: relative;
    align-self: center;
    width: 420px;
    height: 300px;
    overflow: hidden;
    background: #100e0b;
    box-shadow:
      inset 0 0 0 1px var(--line),
      inset 0 0 0 4px #100e0b,
      inset 0 0 0 5px rgb(214 200 172 / 12%);
  }

  .mapcard::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 1px var(--line),
      inset 0 0 0 4px rgb(16 14 11 / 70%),
      inset 0 0 0 5px rgb(214 200 172 / 14%);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .shade {
    fill: var(--plate);
    opacity: 0.18;
  }

  .casing {
    stroke: var(--casing);
    stroke-opacity: 0.8;
    stroke-width: calc(3.4px * var(--k));
    stroke-linecap: round;
  }

  .road {
    stroke: var(--ink);
    stroke-opacity: 0.62;
    stroke-width: calc(1.1px * var(--k));
    stroke-linecap: round;
  }

  .cut {
    fill: var(--cut);
    fill-opacity: 0.85;
  }

  .city {
    fill: var(--neutral-fill);
    stroke: var(--neutral);
    stroke-width: calc(1.2px * var(--k));
  }

  .city.you {
    fill: var(--own);
    stroke: var(--ink);
  }

  .city.enemy {
    fill: var(--enemy);
    stroke: var(--ink);
  }

  .star {
    fill: var(--casing);
  }

  .prov {
    fill: var(--plate);
    stroke: var(--neutral);
    stroke-width: calc(1.8px * var(--k));
  }

  .prov.you {
    stroke: var(--own);
  }

  .prov.enemy {
    stroke: var(--enemy);
  }

  .cap-ring {
    fill: none;
    stroke: var(--ink);
    stroke-opacity: 0.4;
    stroke-width: calc(1.6px * var(--k));
    stroke-dasharray: calc(3px * var(--k)) calc(1.4px * var(--k));
  }

  /* The names as the map writes them (render/nameView.ts): a bold sans in ink on a casing. */
  .name {
    fill: var(--ink);
    font-family: system-ui, sans-serif;
    font-size: calc(9.5px * var(--k));
    font-weight: 700;
    text-anchor: middle;
    paint-order: stroke;
    stroke: var(--casing);
    stroke-width: calc(3px * var(--k));
    stroke-linejoin: round;
  }

  .ring-case {
    fill: none;
    stroke: var(--casing);
    stroke-width: calc(3.5px * var(--k));
  }

  .ring {
    fill: none;
    stroke: var(--ink);
    stroke-width: calc(1.4px * var(--k));
  }

  .ring-mark {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: calc(1px * var(--k));
  }

  .cap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 22px 16px 11px;
    background: linear-gradient(rgb(10 9 7 / 0%), rgb(10 9 7 / 85%));
    color: var(--ink-soft);
    font: 500 11.5px/1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
</style>
