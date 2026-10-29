<script lang="ts">
  import { Api } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import { backgroundUrlOf } from '../map/background.ts';
  import { geoOf, type GeoFile } from '../map/geography.ts';
  import type { MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import LiveMatch from './LiveMatch.svelte';

  interface Props {
    api: Api;
    token: string;
    matchId: string;
    mapId: string;
    onend: (me: PlayerId, end: MatchEndMsg) => void;
    onexit: () => void;
  }

  let { api, token, matchId, mapId, onend, onexit }: Props = $props();

  let map = $state.raw<MapFile | null>(null);
  let backgroundUrl = $state.raw<string | null>(null);
  let geo = $state.raw<GeoFile | null>(null);
  let failed = $state(false);

  // The map graph is public and comes over HTTP; the socket then carries only the state.
  $effect(() => {
    let current = true;
    map = null;
    failed = false;
    Promise.all([
      api.map(mapId).then(async (file) => ({ file, geography: await geoOf(file) })),
      backgroundUrlOf(api, mapId),
    ]).then(
      ([{ file, geography }, background]) => {
        if (current) {
          backgroundUrl = background;
          geo = geography;
          map = file;
        }
      },
      () => {
        if (current) failed = true;
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if map !== null}
  <LiveMatch {matchId} {token} {map} {backgroundUrl} {geo} {onend} {onexit} />
{:else}
  <main class="screen">
    <div class="card">
      {#if failed}
        <p class="error" role="alert">{t('match.error.map')}</p>
        <div class="actions">
          <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
        </div>
      {:else}
        <p role="status">{t('match.connecting')}</p>
      {/if}
    </div>
  </main>
{/if}
