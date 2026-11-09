<svelte:options namespace="svg" />

<script lang="ts">
  import { starPoints } from '../app/menuScene.ts';

  interface Props {
    x: number;
    y: number;
    /** An own city, one with units in it (the dark plate, a helmet on top), or a neutral one. */
    kind: 'own' | 'plate' | 'neutral';
    /** The capital: the dark star with its ink edge. */
    capital?: boolean;
  }

  let { x, y, kind, capital = false }: Props = $props();
</script>

<!-- A city of the pictures in the match's Engraved look (#839): the disc on a dark cut with an ink
     rim; with units in it the dark plate. Drawn inside the picture's own <svg>. -->
<circle cx={x} cy={y} r="19.2" class="city-cut" />
<circle cx={x} cy={y} r="16" class={`city ${kind}`} />
<circle cx={x} cy={y} r="17.6" class="city-rim" />
{#if capital}<polygon points={starPoints(x, y, 9.6, 5, 0.45)} class="star" />{/if}

<style>
  .city-cut {
    fill: var(--cut);
    fill-opacity: 0.85;
  }

  .city.own {
    fill: var(--own);
  }

  .city.plate {
    fill: var(--plate);
  }

  .city.neutral {
    fill: var(--neutral-fill);
  }

  .city-rim {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.1;
  }

  .star {
    fill: var(--casing);
    stroke: var(--ink);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
</style>
