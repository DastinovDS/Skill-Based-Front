<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { eventText } from './eventText.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
  }

  let { data }: Props = $props();
</script>

<section class="log">
  <h2>{t('events.title')}</h2>
  {#if data === null || data.events.length === 0}
    <p class="hint">{t('events.empty')}</p>
  {:else}
    <ul>
      {#each data.events as event (event.seq)}
        <li>
          <span class="tick">{tf('event.tick', { tick: event.tick })}</span>
          {eventText(event, data.me)}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .log {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tick {
    color: #8b949e;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: #8b949e;
  }
</style>
