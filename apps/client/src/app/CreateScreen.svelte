<script lang="ts">
  import { Api } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import MapChoice from './MapChoice.svelte';

  interface Props {
    api: Api;
    oncreate: (mapId: string | null) => Promise<void>;
    onback: () => void;
  }

  let { api, oncreate, onback }: Props = $props();

  let mapId = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    try {
      await oncreate(mapId);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <form class="card" onsubmit={submit}>
    <h1>{t('create.title')}</h1>
    <p class="hint">{t('create.intro')}</p>
    <MapChoice {api} bind:value={mapId} />
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{t('create.submit')}</button>
      <button type="button" onclick={onback}>{t('common.back')}</button>
    </div>
  </form>
</main>
