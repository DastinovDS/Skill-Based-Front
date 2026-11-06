<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { RANDOM_GENERATED, type MapSummary } from '../api/http.ts';
  import type { MapCache } from './mapCache.svelte.ts';
  import MapThumb from './MapThumb.svelte';

  interface Props {
    maps: MapCache;
    /** The chosen map id, `null` for a random pool map, `RANDOM_GENERATED` for a random generated one. */
    value?: string | null;
    /** Offer the generated maps too (#771): a private or a bot match, never the public lobby. */
    generated?: boolean;
  }

  let { maps, value = $bindable(null), generated = false }: Props = $props();

  const listed = $derived<readonly MapSummary[]>(maps.list ?? []);
  const extra = $derived(generated ? listed.filter((m) => m.generated) : []);
  // Each group opens with its random choice.
  const groups = $derived([
    { random: null, maps: listed.filter((m) => !m.generated) },
    ...(extra.length > 0 ? [{ random: RANDOM_GENERATED, maps: extra }] : []),
  ]);
  const options = $derived(groups.flatMap((g) => [g.random, ...g.maps.map((m) => m.id)]));

  // The list and every file of it are asked for once; the thumbnails fill in as they arrive.
  $effect(() => {
    void maps.load();
  });
  $effect(() => {
    for (const group of groups) for (const map of group.maps) void maps.ensure(map.id);
  });

  // A chosen map that left the list (the list was refreshed) falls back to the random one.
  const chosen = $derived(options.includes(value) ? value : null);

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
<div role="radiogroup" aria-label={t('map.label')} {onkeydown}>
  {#each groups as group (group.random)}
    {#if group.random !== null}
      <div class="label">{t('map.generated')}</div>
    {/if}
    <div class="tiles" class:gen={group.random !== null}>
      <button
        type="button"
        class="tile"
        class:on={chosen === group.random}
        role="radio"
        aria-checked={chosen === group.random}
        tabindex={chosen === group.random ? 0 : -1}
        aria-label={group.random === null ? undefined : t('map.randomGenerated')}
        onclick={() => {
          choose(group.random);
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
      {#each group.maps as map (map.id)}
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
            {#if file !== null}<small>{tf('map.nodes', { count: file.nodes.length })}</small
              >{/if}</span
          >
        </button>
      {/each}
    </div>
    {#if group.random !== null}
      <p class="note">{t('map.generatedHint')}</p>
    {/if}
  {/each}
</div>
{#if maps.failed}
  <p class="note">{t('map.listFailed')}</p>
{/if}
