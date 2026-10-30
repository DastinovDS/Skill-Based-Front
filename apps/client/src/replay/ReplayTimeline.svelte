<script lang="ts">
  import { formatClock } from '../hud/format.ts';
  import { t, tf } from '../i18n/index.ts';
  import type { PlayerId } from '../protocol.gen.ts';
  import type { TimelineMark } from './marks.ts';

  interface Props {
    /** Position and length in ticks. */
    position: number;
    duration: number;
    tickHz: number;
    marks: readonly TimelineMark[];
    /** The side drawn blue: its captures are blue diamonds, the other side's red ones. */
    blue: PlayerId;
    onseek: (tick: number) => void;
  }

  let { position, duration, tickHz, marks, blue, onseek }: Props = $props();

  const share = $derived(duration === 0 ? 0 : Math.min(1, position / duration));
  const at = (tick: number): number => (duration === 0 ? 0 : (100 * tick) / duration);
</script>

<!-- A native range (keyboard, pointer and screen readers for free) drawn over our own track: the
     fill, the fights as dots on the track and the captures as diamonds above it (ui-style 13.7). -->
<div class="timeline">
  <div class="lane" aria-hidden="true">
    {#each marks as mark, index (index)}
      {#if mark.kind === 'capture'}
        <svg
          class="diamond"
          class:own={mark.side === blue}
          viewBox="0 0 12 12"
          width="12"
          height="12"
          focusable="false"
          style:left="{at(mark.tick)}%"
        >
          <path d="M6 1 11 6 6 11 1 6z" class="body" />
          {#if mark.side !== blue}<path d="M6 3.4 8.6 6 6 8.6 3.4 6z" class="hole" />{/if}
        </svg>
      {/if}
    {/each}
  </div>
  <div class="rail" aria-hidden="true">
    <span class="fill" style:width="{share * 100}%"></span>
    {#each marks as mark, index (index)}
      {#if mark.kind === 'fight'}
        <span class="dot" style:left="{at(mark.tick)}%"></span>
      {/if}
    {/each}
  </div>
  <input
    type="range"
    min="0"
    max={duration}
    step="1"
    value={position}
    aria-label={t('replay.seek')}
    aria-valuetext={tf('replay.seekValue', {
      time: formatClock(position / tickHz),
      total: formatClock(duration / tickHz),
    })}
    oninput={(event) => {
      onseek(event.currentTarget.valueAsNumber);
    }}
  />
</div>

<style>
  .timeline {
    position: relative;
    height: 40px;
  }

  /* Marks and the rail stop 9px short of the ends, where the centre of the thumb stops. */
  .lane,
  .rail {
    position: absolute;
    inset-inline: 9px;
    pointer-events: none;
  }

  .lane {
    top: 2px;
    height: 12px;
  }

  .rail {
    top: 24px;
    height: 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    box-sizing: content-box;
    transform: translateY(-4px);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--you);
  }

  .dot {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    box-sizing: border-box;
    border: 2px solid var(--paper);
    border-radius: 50%;
    background: var(--bg);
  }

  .diamond {
    position: absolute;
    top: 0;
    margin-left: -6px;
  }

  .diamond .body {
    fill: var(--enemy);
    stroke: var(--paper);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .diamond.own .body {
    fill: var(--you);
  }

  .diamond .hole {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  input {
    position: absolute;
    inset: 12px 0 auto;
    width: 100%;
    height: 24px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
  }

  input::-webkit-slider-runnable-track {
    height: 24px;
    background: transparent;
  }

  input::-moz-range-track {
    height: 24px;
    background: transparent;
  }

  input::-webkit-slider-thumb {
    width: 18px;
    height: 18px;
    margin-top: 3px;
    box-sizing: border-box;
    border: 3px solid var(--bg);
    border-radius: 50%;
    background: var(--paper);
    appearance: none;
  }

  input::-moz-range-thumb {
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    border: 3px solid var(--bg);
    border-radius: 50%;
    background: var(--paper);
  }

  input:focus-visible {
    outline: none;
  }

  input:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  input:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }
</style>
