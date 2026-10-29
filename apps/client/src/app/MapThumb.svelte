<script lang="ts">
  import type { MapFile } from '../protocol.gen.ts';

  interface Props {
    /** The map file, or null while it loads (an empty frame keeps the size). */
    map: MapFile | null;
  }

  let { map }: Props = $props();

  // The real graph, small: own side (left) blue, the enemy's red, the rest neutral. Cities are
  // filled, provinces are rings, the capitals are the big dots. Decoration, not game state.
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
  const enemyCapital = $derived(nodes.find((n) => n.capital && n.side === 'enemy'));
</script>

<span class="thumb" aria-hidden="true">
  {#if map !== null}
    <svg
      viewBox={`0 0 ${String(map.meta.width)} ${String(map.meta.height)}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      {#each map.edges as edge (`${String(edge.a)}-${String(edge.b)}`)}
        {@const a = byId.get(edge.a)}
        {@const b = byId.get(edge.b)}
        {#if a !== undefined && b !== undefined}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="th-road" />
        {/if}
      {/each}
      {#each nodes as node (node.id)}
        {#if node.city || node.capital}
          <circle
            cx={node.x}
            cy={node.y}
            r={node.capital ? 64 : 36}
            class={`th-city ${node.side}`}
            stroke-width={node.capital ? 14 : 10}
          />
        {:else}
          <circle cx={node.x} cy={node.y} r="22" class={`th-prov ${node.side}`} />
        {/if}
      {/each}
      {#if enemyCapital !== undefined}
        <circle cx={enemyCapital.x} cy={enemyCapital.y} r="38" class="th-hole" />
      {/if}
    </svg>
  {/if}
</span>
