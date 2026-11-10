<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { MapCache } from './mapCache.svelte.ts';
  import MapThumb from './MapThumb.svelte';
  import { pickedTile, pickerTiles } from './play.ts';

  interface Props {
    maps: MapCache;
    /**
     * The choice: `NEW_MAP` (a map made for this match, #884, the default), `RANDOM_POOL` (a
     * random map of the pool) or a pool map's id. No stored generated map (#919, item 2).
     */
    value: string;
    onchange: (pick: string) => void;
  }

  let { maps, value, onchange }: Props = $props();

  const tiles = $derived(pickerTiles(maps.list));

  // The list and every file of it are asked for once; the thumbnails fill in as they arrive.
  $effect(() => {
    void maps.load();
  });
  $effect(() => {
    for (const tile of tiles) if (tile.kind === 'map') void maps.ensure(tile.id);
  });

  // A chosen map that left the list (the list was refreshed) falls back to the new map.
  const chosen = $derived(pickedTile(value, tiles));

  function choose(id: string): void {
    onchange(id);
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
    const at = tiles.findIndex((tile) => tile.id === chosen);
    const next = tiles[Math.max(0, Math.min(tiles.length - 1, at + step))];
    if (next === undefined) return;
    event.preventDefault();
    choose(next.id);
    // The new radio takes the focus (roving tabindex).
    const group = event.currentTarget;
    if (group instanceof HTMLElement) {
      queueMicrotask(() => {
        group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      });
    }
  }
</script>

<!-- The map choice of Play a bot (#919): New map first (the default), Random map, then the pool;
     the chosen tile is framed in ivory (also `aria-checked`). Spare captions: no node counts. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tiles" role="radiogroup" aria-label={t('map.label')} {onkeydown}>
  {#each tiles as tile (tile.id)}
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
            <path d="M16 38 32 17 52 29 73 13 83 37 60 46 36 47 16 38M32 17 36 47M52 29 60 46" />
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
      <span class="tl"
        >{tile.kind === 'new'
          ? t('map.new')
          : tile.kind === 'random'
            ? t('map.random')
            : tile.id}</span
      >
    </button>
  {/each}
</div>
{#if maps.failed}
  <p class="hint">{t('map.listFailed')}</p>
{/if}

<style>
  .sketch {
    display: block;
    width: 86%;
    height: 86%;
  }

  .sketch path {
    fill: none;
    stroke: var(--ink-soft);
    stroke-width: 1.3;
    stroke-dasharray: 3 2.4;
    stroke-linecap: round;
  }

  .sketch circle {
    fill: var(--plate);
    stroke: var(--ink-soft);
    stroke-width: 1.3;
  }
</style>
