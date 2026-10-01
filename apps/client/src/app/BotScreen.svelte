<script lang="ts">
  import { Api, BOT_LEVELS, type BotLevel } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import MapChoice from './MapChoice.svelte';

  interface Props {
    api: Api;
    onstart: (level: BotLevel, mapId: string | null) => Promise<void>;
    onback: () => void;
  }

  let { api, onstart, onback }: Props = $props();

  let level = $state<BotLevel>('normal');
  let mapId = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    try {
      await onstart(level, mapId);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <form class="card" onsubmit={submit}>
    <h1>{t('bot.title')}</h1>
    <label>
      {t('bot.level')}
      <select bind:value={level}>
        {#each BOT_LEVELS as option (option)}
          <option value={option}>{t(`bot.level.${option}`)}</option>
        {/each}
      </select>
    </label>
    <MapChoice {api} bind:value={mapId} />
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{t('bot.start')}</button>
      <button type="button" onclick={onback}>{t('common.back')}</button>
    </div>
  </form>
</main>
