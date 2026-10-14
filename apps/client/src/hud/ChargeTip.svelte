<script lang="ts">
  import { tf } from '../i18n/index.ts';

  interface Props {
    units: number;
    charged: number;
  }

  let { units, charged }: Props = $props();

  const empty = $derived(units - charged);
</script>

<!-- Filled circle: charged units, empty circle: discharged ones. A fully charged group shows only
the filled one. The text is for screen readers; the numbers are the picture. -->
<div class="charges" role="img" aria-label={tf('sel.chargedOf', { charged, units })}>
  {#if charged > 0}
    <span class="item"><span class="dot filled"></span><span class="num">{charged}</span></span>
  {/if}
  {#if empty > 0}
    <span class="item"><span class="dot hollow"></span><span class="num">{empty}</span></span>
  {/if}
</div>

<style>
  .charges {
    display: flex;
    gap: 14px;
  }

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .dot {
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    border: 2px solid var(--paper);
    border-radius: 50%;
  }

  .dot.filled {
    background: var(--paper);
  }

  .num {
    font-weight: 700;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
</style>
