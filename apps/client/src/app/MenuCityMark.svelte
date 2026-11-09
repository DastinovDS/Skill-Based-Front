<svelte:options namespace="svg" />

<script lang="ts">
  import { MENU_RING, type MenuCity } from './menuPieces.ts';
  import { starPoints } from './menuScene.ts';

  interface Props {
    piece: MenuCity;
    side: 'own' | 'enemy' | 'neutral';
    capital?: boolean;
    /** The size of the pieces against the match (`MenuBackdrop`'s `k`), about the city's centre. */
    k?: number;
  }

  let { piece, side, capital = false, k = 1 }: Props = $props();

  const c = $derived(piece.at);
  const r = $derived(piece.radius);
  const transform = $derived(
    `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${k.toFixed(4)}) translate(${(-c.x).toFixed(2)} ${(-c.y).toFixed(2)})`,
  );
</script>

<!-- A city of the menu map in the match's Engraved look (#839; `CITY_ENGRAVED`, `RING_ENGRAVED`):
     the disc on a dark cut with an ink rim, on its ring of places (all room); the enemy's with an
     ink ring inside, a neutral one hatched in its grey, the capital with the dark star. -->
<g {transform}>
  <path d={piece.ring.cut} class="ring-cut" stroke-width={MENU_RING.cut} />
  <path d={piece.ring.room} class="ring-room" stroke-width={MENU_RING.room.width} />
  <circle cx={c.x} cy={c.y} r={r + 3.2} class="city-cut" />
  <circle cx={c.x} cy={c.y} {r} class={`city ${side}`} />
  {#if side === 'neutral'}
    <circle cx={c.x} cy={c.y} {r} fill="url(#menu-neutral)" />
  {:else}
    <circle cx={c.x} cy={c.y} r={r - 1.2} class="city-inner" />
  {/if}
  {#if side === 'enemy'}
    <circle cx={c.x} cy={c.y} r={r - 4.4} class="city-ink thin" />
    {#if !capital}<circle cx={c.x} cy={c.y} r={r - 6.4} class="city-ink thin" />{/if}
  {/if}
  <circle cx={c.x} cy={c.y} r={r + 1.6} class="city-ink" />
  {#if capital}<polygon points={starPoints(c.x, c.y, r * 0.6, 5, 0.45)} class="star" />{/if}
</g>

<style>
  .ring-cut {
    fill: none;
    stroke: var(--cut);
    stroke-opacity: 0.8;
  }
  .ring-room {
    fill: none;
    stroke: var(--map-ink, var(--ink));
    stroke-opacity: 0.85;
  }
  .city-cut {
    fill: var(--cut);
    fill-opacity: 0.85;
  }
  .city.own {
    fill: var(--own);
  }
  .city.enemy {
    fill: var(--enemy);
  }
  .city.neutral {
    fill: var(--neutral-fill);
  }
  .city-inner {
    fill: none;
    stroke: var(--cut);
    stroke-opacity: 0.6;
    stroke-width: 0.8;
  }
  .city-ink {
    fill: none;
    stroke: var(--map-ink, var(--ink));
    stroke-width: 1.1;
  }
  .city-ink.thin {
    stroke-width: 0.9;
  }
  .star {
    fill: var(--casing);
    stroke: var(--map-ink, var(--ink));
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
</style>
