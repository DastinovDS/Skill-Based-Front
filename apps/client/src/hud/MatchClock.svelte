<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import {
    BRACKETS,
    CARTOUCHE_H,
    CARTOUCHE_MID,
    CARTOUCHE_W,
    BASELINE_EM,
    PLATE,
    SERIF_CASING,
    SERIF_HOLE,
    SERIF_INK,
    SERIF_SWELL,
    PIXEL_PAD,
    SERIF_X,
    figureNudge,
    innerRule,
    lozenge,
    outerRule,
    pixelLozenge,
  } from './cartouche.ts';
  import { formatClock } from './format.ts';

  interface Props {
    /** Whole seconds left in the match. */
    seconds: number;
    /** The last minute: amber, heavier, a size up, the serifs beating once a second. */
    last: boolean;
    /** The match is paused (DEC-05): dashed rules and hollow serifs, the figures dimmed. */
    paused: boolean;
  }

  let { seconds, last, paused }: Props = $props();

  const text = $derived(formatClock(seconds));
  // The figures: 27 px, and in the last minute 31 px bold (more than the colour tells it).
  const size = $derived(last ? 31 : 27);
  const weight = $derived<400 | 700>(last ? 700 : 400);
  const x = $derived(CARTOUCHE_W / 2 + figureNudge(text, weight) * size);
  const y = $derived(CARTOUCHE_MID + BASELINE_EM[weight] * size);
  const outer = $derived(outerRule(paused));
  const inner = $derived(innerRule(paused));
  // The serifs beat once a second in the last minute while the clock runs (not under "less motion":
  // the CSS turns the beat off).
  const beat = $derived(last && !paused && seconds > 0);
  // A serif from the bottom up: the casing, the ink, the swell of the beat (it fades in and out
  // over the ink: nothing moves or scales, so the serif stays even at every frame) and the hole of
  // a hollow (paused) one.
  const layers = $derived([
    { r: SERIF_CASING, cls: 'serif-casing' },
    { r: SERIF_INK, cls: 'serif-ink' },
    ...(beat ? [{ r: SERIF_SWELL, cls: 'serif-ink swell' }] : []),
    ...(paused ? [{ r: SERIF_HOLE, cls: 'serif-casing' }] : []),
  ]);
</script>

<!-- T3 "Cartouche" (#1005, ui-style 76): the figures in an engraved tablet, corner brackets and a
     lozenge serif each side. Its own sign beside the CP gauge's cap frame: always there, a filled
     tablet with brackets, not open rules round a scale. -->
<span
  class="clock"
  class:last
  class:paused
  role="timer"
  aria-label={paused ? tf('bar.clockPaused', { time: text }) : tf('bar.clock', { time: text })}
  title={paused ? t('bar.clockPausedTip') : undefined}
>
  <svg
    width={CARTOUCHE_W}
    height={CARTOUCHE_H}
    viewBox="0 0 {CARTOUCHE_W} {CARTOUCHE_H}"
    aria-hidden="true"
    focusable="false"
  >
    <rect class="plate" x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} />
    {#each outer as r, i (i)}
      <rect class="outer" x={r.x} y={r.y} width={r.w} height={r.h} />
    {/each}
    {#each inner as r, i (i)}
      <rect class="inner" x={r.x} y={r.y} width={r.w} height={r.h} />
    {/each}
    {#each BRACKETS as r, i (i)}
      <rect class="bracket" x={r.x} y={r.y} width={r.w} height={r.h} />
    {/each}
    {#key beat ? seconds : -1}
      {#each SERIF_X as cx (cx)}
        <g class="serif">
          <g class="smooth">
            {#each layers as layer, j (j)}
              <polygon class={layer.cls} points={lozenge(cx, CARTOUCHE_MID, layer.r)} />
            {/each}
          </g>
          <g class="pixel">
            {#each layers as layer, j (j)}
              {#each pixelLozenge(cx, CARTOUCHE_MID, layer.r + PIXEL_PAD) as p, i (i)}
                <rect class={layer.cls} x={p.x} y={p.y} width={p.w} height={p.h} />
              {/each}
            {/each}
          </g>
        </g>
      {/each}
    {/key}
    <text class="figures" {x} {y} font-size={size} font-weight={weight} text-anchor="middle"
      >{text}</text
    >
  </svg>
</span>

<style>
  .clock {
    display: inline-flex;
    /* The colour of every part: ink, amber in the last minute. */
    color: var(--ink);
    transition: color 400ms var(--ease-engrave);
  }

  .clock.last {
    color: var(--warn);
  }

  svg {
    display: block;
    overflow: visible;
  }

  .plate {
    fill: var(--casing);
    opacity: 0.55;
  }

  /* The rules match the framed buttons beside the clock: a rule, two pixels of plate, a faint rule. */
  .outer {
    fill: currentColor;
    opacity: 0.6;
  }

  .inner {
    fill: currentColor;
    opacity: 0.22;
  }

  .last .outer {
    opacity: 0.8;
  }

  .last .inner {
    opacity: 0.32;
  }

  .bracket {
    fill: currentColor;
  }

  .serif-casing {
    fill: var(--casing);
  }

  /* Under a device pixel ratio of 2 the serifs are pixel lozenges (see SERIF_CASING). */
  .pixel {
    display: none;
  }

  @media (max-resolution: 1.99dppx) {
    .pixel {
      display: inline;
    }

    .smooth {
      display: none;
    }
  }

  .serif-ink {
    fill: currentColor;
  }

  .figures {
    fill: currentColor;
    font-family: var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  /* A pause: the figures stand back (the dashed rules and the hollow serifs say it by shape). */
  .paused .figures {
    opacity: 0.6;
  }

  .paused .bracket {
    opacity: 0.7;
  }

  /* The beat of the last minute: once a second each serif swells by a ring and settles. */
  .swell {
    opacity: 0;
    animation: beat 420ms var(--ease-engrave) both;
  }

  @keyframes beat {
    0%,
    100% {
      opacity: 0;
    }
    35% {
      opacity: 1;
    }
  }

  :global(:root[data-motion='reduced']) .swell {
    animation: none;
  }

  :global(:root[data-motion='reduced']) .clock {
    transition: none;
  }
</style>
