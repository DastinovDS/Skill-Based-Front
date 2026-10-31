<script lang="ts">
  import { t } from '../i18n/index.ts';

  interface Props {
    /** Economy v2 (DEC-41): no stance and no road levels; the supply lines and the plan instead. */
    v2?: boolean;
  }

  let { v2 = false }: Props = $props();

  /** `[key, dictionary key of what it does]`: the keys themselves are not translated. */
  const HINTS_V1 = [
    ['Q', 'hints.stance'],
    ['U', 'hints.road'],
    ['R', 'hints.recruit'],
    ['?', 'hints.help'],
  ] as const;
  const HINTS_V2 = [
    ['Tab', 'hints.lines'],
    ['Shift', 'hints.plan'],
    ['R', 'hints.recruit'],
    ['?', 'hints.help'],
  ] as const;
  const HINTS = $derived(v2 ? HINTS_V2 : HINTS_V1);
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
    padding: 4px 10px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-dim);
    font-size: 12px;
    pointer-events: none;
  }

  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    font: inherit;
  }
</style>
