<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    visible: boolean;
  }

  let { data, visible }: Props = $props();
</script>

<!-- The first three seconds of a match (ui-style U4); the map rings the own capital meanwhile. -->
{#if visible && data !== null}
  <div class="banner" role="status">
    <svg class="mark" viewBox="0 0 16 14" width="24" height="21" aria-hidden="true">
      <path d="M1.5 1.5h13L8 12.5z" />
    </svg>
    <p class="title">{t('start.title')}</p>
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
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    text-align: center;
    pointer-events: none;
    animation: banner-in 240ms ease-out;
  }

  .mark path {
    fill: var(--you);
    stroke: var(--paper);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  p {
    margin: 0;
  }

  .title {
    font-size: 22px;
    font-weight: 700;
  }

  .sub {
    color: var(--text-dim);
    font-size: 14px;
  }

  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .banner {
      animation: none;
    }
  }
</style>
