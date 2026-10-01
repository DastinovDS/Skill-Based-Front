<script lang="ts">
  import { Api, type MapSummary } from '../api/http.ts';
  import { t } from '../i18n/index.ts';

  interface Props {
    api: Api;
    /** The chosen map id, `null` for a random one. */
    value?: string | null;
  }

  let { api, value = $bindable(null) }: Props = $props();

  let maps = $state.raw<readonly MapSummary[]>([]);

  $effect(() => {
    let current = true;
    api.maps().then(
      (list) => {
        if (current) maps = list;
      },
      () => {
        // The list is a convenience: without it the server picks a random map.
      },
    );
    return () => {
      current = false;
    };
  });
</script>

<label>
  {t('map.label')}
  <select
    value={value ?? ''}
    onchange={(event) => {
      value = event.currentTarget.value === '' ? null : event.currentTarget.value;
    }}
  >
    <option value="">{t('map.random')}</option>
    {#each maps as map (map.id)}
      <option value={map.id}>{map.id}</option>
    {/each}
  </select>
</label>
