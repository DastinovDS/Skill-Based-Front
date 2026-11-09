<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { NEW_MAP, RANDOM_GENERATED, RANDOM_POOL, type MapSummary } from '../api/http.ts';
  import type { MapCache } from './mapCache.svelte.ts';
  import MapThumb from './MapThumb.svelte';

  interface Props {
    maps: MapCache;
    /**
     * The choice: a map id, `NEW_MAP` (a map made for this match, #884, the default), `RANDOM_POOL`
     * or `RANDOM_GENERATED` (a random map of the pool or of the stored generated ones, #771).
     */
    value?: string;
  }

  let { maps, value = $bindable(NEW_MAP) }: Props = $props();

  const listed = $derived<readonly MapSummary[]>(maps.list ?? []);
  const extra = $derived(listed.filter((m) => m.generated));
  // Each group opens with its random choice; the pool row with the new map before it. Every
  // match chosen here is unrated (a private, public or bot match, #889), so all are offered.
  const groups = $derived([
    { random: RANDOM_POOL, lead: [NEW_MAP], maps: listed.filter((m) => !m.generated) },
    ...(extra.length > 0 ? [{ random: RANDOM_GENERATED, lead: [], maps: extra }] : []),
  ]);
  /** The tiles of each group in order: the new map, the random one, the maps. */
  const rows = $derived(
    groups.map((g) => ({
      generated: g.random === RANDOM_GENERATED,
      tiles: [
        ...g.lead.map((id) => ({ id, label: t('map.new'), kind: 'new' as const })),
        {
          id: g.random,
          label: g.random === RANDOM_POOL ? t('map.random') : t('map.randomGenerated'),
          kind: 'random' as const,
        },
        ...g.maps.map((m) => ({ id: m.id, label: m.id, kind: 'map' as const })),
      ],
    })),
  );
  const options = $derived(rows.flatMap((r) => r.tiles.map((tile) => tile.id)));

  // The list and every file of it are asked for once; the thumbnails fill in as they arrive.
  $effect(() => {
    void maps.load();
  });
  $effect(() => {
    for (const group of groups) for (const map of group.maps) void maps.ensure(map.id);
  });

  // A chosen map that left the list (the list was refreshed) falls back to the new map.
  const chosen = $derived(options.includes(value) ? value : NEW_MAP);

  function choose(id: string): void {
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

<!-- The map choice (Lapis, #845): the new map first (#884), then each group opens with its random
     tile; the chosen tile is framed in ivory. Spare captions: no node counts, no notes. -->
<p class="label">{t('map.label')}</p>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div role="radiogroup" aria-label={t('map.label')} {onkeydown}>
  {#each rows as row (row.generated)}
    {#if row.generated}
      <p class="label">{t('map.generated')}</p>
    {/if}
    <div class="tiles" class:gen={row.generated}>
      {#each row.tiles as tile (tile.id)}
        <button
          type="button"
          class="tile"
          class:on={chosen === tile.id}
          role="radio"
          aria-checked={chosen === tile.id}
          tabindex={chosen === tile.id ? 0 : -1}
          onclick={() => {
            choose(tile.id);
          }}
        >
          {#if tile.kind === 'new'}
            <!-- A graph in dashed ink, not drawn yet: the map is made when the match is. -->
            <span class="thumb rnd" aria-hidden="true">
              <svg class="sketch" viewBox="0 0 96 58" focusable="false">
                <path
                  d="M16 38 32 17 52 29 73 13 83 37 60 46 36 47 16 38M32 17 36 47M52 29 60 46"
                />
                <circle cx="16" cy="38" r="2.6" /><circle cx="32" cy="17" r="2.6" />
                <circle cx="52" cy="29" r="3.4" /><circle cx="73" cy="13" r="2.6" />
                <circle cx="83" cy="37" r="2.6" /><circle cx="60" cy="46" r="2.6" />
                <circle cx="36" cy="47" r="2.6" />
              </svg>
            </span>
          {:else if tile.kind === 'random'}
            <span class="thumb rnd" aria-hidden="true">?</span>
          {:else}
            <MapThumb map={maps.get(tile.id)} />
          {/if}
          <span class="tl">{tile.label}</span>
        </button>
      {/each}
    </div>
  {/each}
</div>
{#if maps.failed}
  <p class="hint">{t('map.listFailed')}</p>
{/if}

<style>
  .sketch {
    display: block;
    width: 100%;
    height: 100%;
  }

  .sketch path {
    fill: none;
    stroke: var(--ink-dim);
    stroke-width: 1.4;
    stroke-dasharray: 3 3;
    stroke-linecap: round;
  }

  .sketch circle {
    fill: #0f0d0a;
    stroke: var(--ink-dim);
    stroke-width: 1.2;
  }
</style>
