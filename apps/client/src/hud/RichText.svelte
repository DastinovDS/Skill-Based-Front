<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { Segment } from '../tutorial/rich.ts';

  interface Props {
    segments: readonly Segment[];
    /** The marks in turn (I.7): the index of the terrain a bold word names, or -1. */
    turnOf?: (word: string) => number;
    /** The terrain ringed now, `'all'` once the pass is over, or null (no marks in turn). */
    phase?: number | 'all' | null;
  }

  let { segments, turnOf = () => -1, phase = null }: Props = $props();
</script>

<!-- The text of a tutorial card (#806, `tutorial/rich.ts`): bold words, key caps, the mouse glyph
     and the amber sign drawn inline; no markup string reaches the page. -->
{#each segments as segment, i (i)}
  {#if segment.kind === 'text'}{segment.text}{:else if segment.kind === 'bold'}
    {@const turn = turnOf(segment.text)}
    <b
      class:tw={turn >= 0}
      class:tw-on={turn >= 0 && phase === turn}
      class:tw-rest={turn >= 0 && phase === 'all'}>{segment.text}</b
    >{:else if segment.kind === 'key'}<kbd class="kbd">{segment.text}</kbd
    >{:else if segment.kind === 'mouse'}<span
      class="mouse"
      role="img"
      aria-label={t('tutorial.mouse')}
    ></span>{:else}<svg
      class="warn"
      width="15"
      height="14"
      viewBox="0 0 15 14"
      role="img"
      aria-label={t('tutorial.warnSign')}
      ><path class="warn-body" d="M7.5 1.2 14 12.8H1Z" /><path
        class="warn-bang"
        d="M7.5 5v3.6"
      /><circle class="warn-dot" cx="7.5" cy="10.6" r="1" /></svg
    >{/if}
{/each}

<style>
  b {
    font-weight: 600;
    color: #fff6e2;
  }

  /* The word of the terrain the map rings now (I.7). */
  .tw {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.2s linear;
  }

  .tw.tw-on {
    text-decoration-color: var(--ink);
  }

  .tw.tw-rest {
    text-decoration-color: var(--ink-dim);
  }

  .kbd {
    display: inline-grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 6px;
    margin: 0 2px;
    vertical-align: 2px;
    font: normal 500 10.5px/1 var(--font-display);
    letter-spacing: 0.1em;
    color: var(--ink);
    background: #14110d;
    box-shadow:
      inset 0 0 0 1px rgb(236 228 209 / 55%),
      inset 0 -2px 0 rgb(0 0 0 / 45%);
  }

  .mouse {
    display: inline-block;
    position: relative;
    width: 13px;
    height: 18px;
    box-sizing: border-box;
    margin: 0 6px 0 1px;
    vertical-align: -3px;
    border: 1.4px solid var(--ink);
    border-radius: 7px;
  }

  .mouse::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    width: 1.4px;
    height: 6px;
    margin-left: -0.7px;
    background: var(--ink);
  }

  .mouse::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 1px;
    width: 4px;
    height: 6px;
    border-radius: 5px 0 0 0;
    background: var(--ink);
  }

  .warn {
    display: inline-block;
    vertical-align: -1px;
    margin: 0 1px;
  }

  .warn-body {
    fill: var(--warn);
    stroke: var(--plate);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .warn-bang {
    stroke: var(--plate);
    stroke-width: 1.7;
    stroke-linecap: round;
  }

  .warn-dot {
    fill: var(--plate);
  }
</style>
