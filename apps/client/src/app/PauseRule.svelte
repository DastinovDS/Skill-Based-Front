<script lang="ts">
  import { t } from '../i18n/index.ts';

  interface Props {
    /** DEC-05: a match of the queue has no pauses, a bot or a friend match one each. */
    pause: 'none' | 'each';
  }

  let { pause }: Props = $props();
</script>

<!-- The pause rule under the ways (#919, round 2 "Shown"): a quiet italic line with a pause glyph,
     crossed for "No pauses"; the words carry it, the glyph only repeats it. -->
<span class="prule">
  <svg width="14" height="13" viewBox="0 0 14 13" aria-hidden="true" focusable="false">
    {#if pause === 'none'}
      <path d="M3.5 1.5v10M10.5 1.5v10" stroke="currentColor" stroke-width="2.2" opacity=".55" />
      <path d="M1 12 13 1" stroke="currentColor" stroke-width="1.4" />
    {:else}
      <path d="M3.5 1.5v10M10.5 1.5v10" stroke="currentColor" stroke-width="2.2" />
    {/if}
  </svg>
  {pause === 'none' ? t('dock.chip.noPause') : t('dock.chip.pause')}
</span>
