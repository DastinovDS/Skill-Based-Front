<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { PlayerColour } from '../protocol.gen.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    visible: boolean;
    /** The player's colour in this match (DEC-49), named in the title; Lapis while unknown. */
    colour?: PlayerColour | null;
  }

  let { data, visible, colour = null }: Props = $props();

  // The Star rule (#968, ui-style 74, D): the capital star in ink set into a rule that fades at both
  // ends, with a small lozenge on either side. Ink only: the title names the colour.
  const uid = $props.id();
  const STAR =
    'M120 3.2 L122.47 9.2 L128.94 9.7 L123.99 13.9 L125.53 20.2 L120 16.8 L114.47 20.2 L116.01 13.9 L111.06 9.7 L117.53 9.2 Z';
  const LOZENGES = 'M98 9.5 L100.5 12 L98 14.5 L95.5 12 Z M142 9.5 L144.5 12 L142 14.5 L139.5 12 Z';
</script>

<!-- The first three seconds of a match (ui-style U4); the map rings the own capital meanwhile. -->
{#if visible && data !== null}
  <div class="banner" role="status">
    <svg class="mark" viewBox="0 0 240 24" width="240" height="24" aria-hidden="true">
      <defs>
        <linearGradient id="{uid}-rule">
          <stop offset="0" class="rule-end" stop-opacity="0" />
          <stop offset="0.35" class="rule-end" />
          <stop offset="0.65" class="rule-end" />
          <stop offset="1" class="rule-end" stop-opacity="0" />
        </linearGradient>
        <mask id="{uid}-gap">
          <rect width="240" height="24" fill="#fff" />
          <rect x="104" width="32" height="24" fill="#000" />
        </mask>
      </defs>
      <rect x="0" y="11.5" width="240" height="1" fill="url(#{uid}-rule)" mask="url(#{uid}-gap)" />
      <path class="casing" d={STAR} />
      <path class="star" d={STAR} />
      <path class="loz" d={LOZENGES} />
    </svg>
    <p class="title">{tf('start.title', { colour: t(`colour.${colour ?? 'lapis'}`) })}</p>
    <p class="sub">{tf('start.capital', { nick: data.nicks.enemy })}</p>
  </div>
{/if}

<style>
  .banner {
    position: absolute;
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 28px;
    border: 1px solid rgb(236 228 209 / 60%);
    background: rgb(14 12 9 / 94%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 94%),
      inset 0 0 0 4px rgb(236 228 209 / 25%);
    color: var(--ink);
    text-align: center;
    pointer-events: none;
    animation: banner-in 240ms ease-out;
  }

  .mark {
    display: block;
    overflow: visible;
  }

  .mark .rule-end {
    stop-color: var(--ink);
  }

  .mark .casing {
    fill: none;
    stroke: var(--casing);
    stroke-width: 3.6;
    stroke-linejoin: miter;
  }

  .mark .star {
    fill: var(--ink);
    stroke: var(--ink);
    stroke-width: 1.2;
    stroke-linejoin: miter;
  }

  .mark .loz {
    fill: var(--frame-lozenge);
    stroke: var(--cut);
    stroke-width: 0.8;
  }

  p {
    margin: 0;
  }

  .title {
    font: 500 22px/1.2 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .sub {
    color: var(--ink-soft);
    font-size: 16px;
  }

  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-8px);
    }
  }

  /* The motion setting of the page (#871) decides, not the media query alone. */
  :global(:root[data-motion='reduced']) .banner {
    animation: none;
  }
</style>
