<script lang="ts">
  import type { BotLevel } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import LevelPicker from './LevelPicker.svelte';
  import type { MapCache } from './mapCache.svelte.ts';
  import MapTiles from './MapTiles.svelte';

  interface Props {
    maps: MapCache;
    level: BotLevel;
    pick: string;
    onlevel: (level: BotLevel) => void;
    onpick: (pick: string) => void;
  }

  let { maps, level, pick, onlevel, onpick }: Props = $props();
</script>

<!-- The options of Play a bot (#919, item 8): a stone drawer above the plinth that opens with the
     way and stays open while it is chosen; the level on the left, the map on the right. The frame
     is on the drawer, the scrolling (a short window only) inside it: a frame drawn over a scrolling
     box would add its own 4 px to the scrolled area and show scroll bars where nothing scrolls (#928). -->
<section class="drw rule-frame stone-panel" aria-label={t('menu.bot')}>
  <div class="dbody">
    <div class="dcol">
      <p class="label">{t('bot.level')}</p>
      <LevelPicker value={level} onchange={onlevel} />
    </div>
    <div class="dcol">
      <p class="label">{t('map.label')}</p>
      <MapTiles {maps} value={pick} onchange={onpick} />
    </div>
  </div>
</section>
