<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import ScreenFrame from './ScreenFrame.svelte';

  interface Props {
    /** The map drawn behind the rail (null: the plain dark page). */
    map?: MapFile | null;
    /** Ms before the status line appears: a wait of up to a second shows nothing (13.9). */
    delay?: number;
  }

  let { map = null, delay = 1000 }: Props = $props();

  let shown = $state(false);

  $effect(() => {
    shown = false;
    if (delay <= 0) {
      shown = true;
      return;
    }
    const timer = setTimeout(() => {
      shown = true;
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  });
</script>

<!-- The bare frame of the start menu while the saved guest is checked (#601): the map, the mark and
     nothing else for the first second, then one quiet line. The status region is always there, so
     assistive technology hears the text when it appears. -->
<ScreenFrame {map} label={t('common.loading')}>
  <div class="boot" role="status">
    {#if shown}{t('common.loading')}{/if}
  </div>
</ScreenFrame>

<style>
  .boot {
    min-height: 28px;
    font-size: 15px;
    color: var(--text-dim);
  }
</style>
