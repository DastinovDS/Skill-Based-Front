<script lang="ts">
  import { t } from '../i18n/index.ts';

  /** `[key, dictionary key of what it does]`: the keys themselves are not translated. */
  const HINTS = [
    ['Q', 'hints.stance'],
    ['Tab', 'hints.supply'],
    ['Shift', 'hints.plan'],
    ['R', 'hints.recruit'],
    ['?', 'hints.help'],
  ] as const;
</script>

<!-- The key bar at the bottom right: the first matches only (ui-style 10.4). -->
<ul class="hints" aria-label={t('hints.title')}>
  {#each HINTS as [key, text] (text)}
    <li><kbd>{key}</kbd> {t(text)}</li>
  {/each}
</ul>

<style>
  .hints {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 3;
    display: flex;
    gap: 12px;
    margin: 0;
    padding: 5px 12px;
    list-style: none;
    border: 1px solid rgb(236 228 209 / 55%);
    background: rgb(14 12 9 / 94%);
    color: var(--ink-dim);
    font: 500 14px/1.3 var(--font-text);
    pointer-events: none;
  }

  kbd {
    padding: 0 4px;
    border: 1px solid rgb(236 228 209 / 40%);
    color: var(--ink);
    font: 500 10.5px/16px var(--font-display);
    letter-spacing: 0.06em;
  }
</style>
