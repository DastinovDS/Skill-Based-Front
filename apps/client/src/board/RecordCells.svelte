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
<td class="r">{matches}</td>
<td class="r">{tally.wins}&ndash;{tally.losses}&ndash;{tally.draws}</td>
<td class="r">
  {#if share === null}
    <span class="dim">&ndash;</span>
  {:else}
    <span class="bar" aria-hidden="true"><i style:width={`${String(share)}%`}></i></span>{share}%
  {/if}
</td>

<style>
  td {
    padding: 5px 14px 5px 0;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
    text-align: right;
    white-space: nowrap;
    font-size: 18px;
  }

  .dim {
    color: var(--ink-dim);
  }

  /* The share of wins: a bar and the number, never the bar alone. */
  .bar {
    display: inline-block;
    width: 90px;
    height: 6px;
    margin-right: 10px;
    background: #2a251e;
    vertical-align: middle;
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--ink);
  }
</style>
