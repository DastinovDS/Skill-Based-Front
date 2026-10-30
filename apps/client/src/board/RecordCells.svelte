<script lang="ts">
  import type { RecordTally } from '../api/http.ts';
  import { winShare } from './view.ts';

  interface Props {
    /** The matches that changed the rating, calibration included. */
    matches: number;
    tally: RecordTally;
  }

  let { matches, tally }: Props = $props();

  const share = $derived(winShare(tally, matches));
</script>

<!-- The record columns of a leaderboard row (#629, L10): matches, W-L-D and the share of wins. -->
<td class="r dim">{matches}</td>
<td class="r dim">{tally.wins}&ndash;{tally.losses}&ndash;{tally.draws}</td>
<td class="r">
  {#if share === null}
    <span class="dim">&ndash;</span>
  {:else}
    <span class="bar" aria-hidden="true"><i style:width={`${String(share)}%`}></i></span>{share}%
  {/if}
</td>

<style>
  td {
    height: 38px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--text-dim);
  }

  /* The share of wins: a bar and the number, never the bar alone. */
  .bar {
    display: inline-block;
    width: 60px;
    height: 8px;
    margin-right: 6px;
    border: 1px solid var(--border);
    vertical-align: middle;
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--text-dim);
  }
</style>
