<script lang="ts">
  import { tf } from '../i18n/index.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    units: number;
    charged: number;
  }

  let { units, charged }: Props = $props();

  /** The helmets in threes (ui-style 57u): `true` a charged unit, `false` a discharged one. */
  const threes = $derived.by(() => {
    const out: boolean[][] = [];
    for (let j = 0; j < units; j++) {
      if (j % 3 === 0) out.push([]);
      out[out.length - 1]?.push(j < charged);
    }
    return out;
  });
</script>

<!-- The unit card (#847, ui-style 57u): a helmet per unit, filled for a charged one and empty (the
dark dome) for a discharged one, set in threes. The text is for screen readers; the helmets are the
picture. -->
<div class="charges" role="img" aria-label={tf('sel.chargedOf', { charged, units })}>
  {#each threes as three, k (k)}
    <span class="three">
      {#each three as full, j (j)}
        <HelmetIcon side="own" size={21} share={full ? 1 : 0} engraved />
      {/each}
    </span>
  {/each}
</div>

<style>
  .charges {
    display: flex;
    flex-wrap: wrap;
    max-width: 260px;
    gap: 3px 6px;
  }

  .three {
    display: flex;
    gap: 3px;
  }
</style>
