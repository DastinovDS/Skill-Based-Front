<script lang="ts">
  import { thumbnailUrl } from '../map/thumbnails.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { starPoints } from './menuScene.ts';

  interface Props {
    /** The map file, or null while it loads (an empty frame keeps the size). */
    map: MapFile | null;
    /** The ground thumbnail; by default the bundled one of the map (a per-match map has none). */
    ground?: string | null;
  }

  let { map, ground: given }: Props = $props();

  // The real graph, small, on the map's own baked ground (#839): the pieces of the match in
  // miniature, own side (left) blue, the enemy's red, the rest neutral. Cities are discs on a dark
  // cut, provinces dark dots in a ring of the owner, the capitals a disc with the dark star.
  // Decoration, not game state.
  const nodes = $derived(
    map === null
      ? []
      : map.nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          capital: n.capital_of !== null,
          city: n.kind !== 'province',
          side: n.start_owner === 0 ? 'you' : n.start_owner === 1 ? 'enemy' : 'neutral',
        })),
  );
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const ground = $derived(given ?? (map === null ? null : thumbnailUrl(map.meta.name)));
</script>

<span class="thumb" aria-hidden="true">
  {#if map !== null}
    <svg
      viewBox={`0 0 ${String(map.meta.width)} ${String(map.meta.height)}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      {#if ground !== null}
        <image
          href={ground}
          width={map.meta.width}
          height={map.meta.height}
          preserveAspectRatio="none"
        />
        <rect width={map.meta.width} height={map.meta.height} class="th-shade" />
      {/if}
      {#each map.edges as edge (`${String(edge.a)}-${String(edge.b)}`)}
        {@const a = byId.get(edge.a)}
        {@const b = byId.get(edge.b)}
        {#if a !== undefined && b !== undefined}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="th-casing" />
        {/if}
      {/each}
      {#each map.edges as edge (`${String(edge.a)}-${String(edge.b)}`)}
        {@const a = byId.get(edge.a)}
        {@const b = byId.get(edge.b)}
        {#if a !== undefined && b !== undefined}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="th-road" />
        {/if}
      {/each}
      {#each nodes as node (node.id)}
        {#if node.city || node.capital}
          {@const r = node.capital ? 66 : 40}
          <circle cx={node.x} cy={node.y} r={r + 14} class="th-cut" />
          <circle cx={node.x} cy={node.y} {r} class={`th-city ${node.side}`} />
          {#if node.capital}
            <polygon points={starPoints(node.x, node.y, r * 0.66, 5, 0.45)} class="th-star" />
          {/if}
        {:else}
          <circle cx={node.x} cy={node.y} r="26" class={`th-prov ${node.side}`} />
        {/if}
      {/each}
    </svg>
  {/if}
</span>

<style>
  .th-shade {
    fill: var(--plate);
    opacity: 0.32;
  }
  .th-casing {
    stroke: var(--casing);
    stroke-opacity: 0.75;
    stroke-width: 30;
    stroke-linecap: round;
  }
  .th-road {
    stroke: var(--ink);
    stroke-opacity: 0.6;
    stroke-width: 11;
    stroke-linecap: round;
  }
  .th-cut {
    fill: var(--cut);
    fill-opacity: 0.85;
  }
  .th-city {
    fill: var(--neutral-fill);
    stroke: var(--neutral);
    stroke-width: 10;
  }
  .th-city.you {
    fill: var(--own);
    stroke: var(--ink);
  }
  .th-city.enemy {
    fill: var(--enemy);
    stroke: var(--ink);
  }
  .th-star {
    fill: var(--casing);
  }
  .th-prov {
    fill: var(--plate);
    stroke: var(--neutral);
    stroke-width: 12;
  }
  .th-prov.you {
    stroke: var(--own);
  }
  .th-prov.enemy {
    stroke: var(--enemy);
  }
</style>
