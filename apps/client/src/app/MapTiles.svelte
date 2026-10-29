<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { MapSummary } from '../api/http.ts';
  import type { MapCache } from './mapCache.svelte.ts';
  import MapThumb from './MapThumb.svelte';

  interface Props {
    maps: MapCache;
    /** The chosen map id, `null` for a random one. */
    value?: string | null;
  }

  let { maps, value = $bindable(null) }: Props = $props();

  // The pool and every file of it are asked for once; the thumbnails fill in as they arrive.
  $effect(() => {
    void maps.load();
  });
  $effect(() => {
    for (const map of maps.list ?? []) void maps.ensure(map.id);
  });

  const pool = $derived<readonly MapSummary[]>(maps.list ?? []);
  // A chosen map that left the pool (the list was refreshed) falls back to the random one.
  const chosen = $derived(value !== null && pool.some((m) => m.id === value) ? value : null);

  const options = $derived([null, ...pool.map((m) => m.id)] as readonly (string | null)[]);

  function choose(id: string | null): void {
    value = id;
  }

  /** Arrow keys move the choice, like a radio group. */
  function onkeydown(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    const at = options.indexOf(chosen);
    const next = options[Math.max(0, Math.min(options.length - 1, at + step))];
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
    // The new radio takes the focus (roving tabindex).
    const group = event.currentTarget;
    if (group instanceof HTMLElement) {
      queueMicrotask(() => {
        group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      });
    }
  }
</script>

<div class="label">{t('map.label')}</div>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tiles" role="radiogroup" aria-label={t('map.label')} {onkeydown}>
  <button
    type="button"
    class="tile"
    class:on={chosen === null}
    role="radio"
    aria-checked={chosen === null}
    tabindex={chosen === null ? 0 : -1}
    onclick={() => {
      choose(null);
    }}
  >
    <span class="thumb rnd" aria-hidden="true">
      <svg viewBox="0 0 40 36" width="30" height="27" focusable="false">
        <polygon points="3,3 37,3 20,33" class="ghost" />
        <text x="20" y="16.5" text-anchor="middle" class="ghost-q">?</text>
      </svg>
    </span>
    <span class="row2"><b>{t('map.random')}</b></span>
  </button>
  {#each pool as map (map.id)}
    {@const file = maps.get(map.id)}
    <button
      type="button"
      class="tile"
      class:on={chosen === map.id}
      role="radio"
      aria-checked={chosen === map.id}
      tabindex={chosen === map.id ? 0 : -1}
      onclick={() => {
        choose(map.id);
      }}
    >
      <MapThumb map={file} />
      <span class="row2"
        ><b>{map.id}</b>
        {#if file !== null}<small>{tf('map.nodes', { count: file.nodes.length })}</small>{/if}</span
      >
    </button>
  {/each}
</div>
{#if maps.failed}
  <p class="note">{t('map.listFailed')}</p>
{/if}
