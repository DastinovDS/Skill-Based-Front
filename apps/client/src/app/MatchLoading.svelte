<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';

  import type { LoadingStage } from './matchStatus.ts';

  interface Props {
    stage: LoadingStage;
    /** Joining failed (the bar over the plate says why): the current ring stands still. */
    stalled?: boolean;
  }

  let { stage, stalled = false }: Props = $props();

  const STAGES = [
    { id: 'map', label: 'match.loading.map' },
    { id: 'connect', label: 'match.loading.connect' },
    { id: 'frame', label: 'match.loading.frame' },
  ] as const;
  const at = $derived(STAGES.findIndex((s) => s.id === stage));
</script>

<!-- Joining a match (ui-style 13.9): the three stages in a line. The same plate covers the page while
     the map file loads and while the map draws its first frame, so nothing jumps when the map arrives.
     Done is a check, now is a ring that turns, next is an empty ring: it reads without the hue. -->
<main class="loading" aria-busy="true">
  <div class="plate">
    <p class="eyebrow">{t('match.loading.eyebrow')}</p>
    <div role="status">
      <ol>
        {#each STAGES as item, index (item.id)}
          <li
            class:done={index < at}
            class:now={index === at}
            class:stalled={stalled && index === at}
            aria-current={index === at ? 'step' : undefined}
          >
            <span class="mark">
              {#if index < at}<Icon name="check" size={14} />{/if}
            </span>
            <span class="label">{t(item.label)}</span>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</main>

<style>
  .loading {
    position: absolute;
    inset: 0;
    z-index: 15;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
  }

  .plate {
    width: max-content;
    max-width: 100%;
  }

  .eyebrow {
    margin: 0 0 14px;
    font-size: 13px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-dim);
  }

  li.now {
    color: var(--text);
  }

  li.done .label {
    font-weight: 500;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    border: 2px solid var(--text-dim);
    border-radius: 50%;
    color: var(--bg);
  }

  .done .mark {
    border-color: var(--you);
    background: var(--you);
  }

  .now .mark {
    border-color: var(--text);
    border-style: dashed;
  }

  @media (prefers-reduced-motion: no-preference) {
    .now:not(.stalled) .mark {
      animation: loading-turn 2s linear infinite;
    }
  }

  @keyframes loading-turn {
    to {
      transform: rotate(360deg);
    }
  }
</style>
