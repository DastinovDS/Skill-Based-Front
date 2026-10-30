<script lang="ts">
  import { Api } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import { backgroundUrlOf } from '../map/background.ts';
  import { geoOf, type GeoFile } from '../map/geography.ts';
  import type { MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import type { MatchSummary } from './matchSummary.ts';
  import FailurePanel from './FailurePanel.svelte';
  import LiveMatch from './LiveMatch.svelte';
  import MatchLoading from './MatchLoading.svelte';

  interface Props {
    api: Api;
    token: string;
    matchId: string;
    mapId: string;
    onend: (me: PlayerId, end: MatchEndMsg, summary: MatchSummary | null) => void;
    onexit: () => void;
  }

  let { api, token, matchId, mapId, onend, onexit }: Props = $props();

  let map = $state.raw<MapFile | null>(null);
  let backgroundUrl = $state.raw<string | null>(null);
  let geo = $state.raw<GeoFile | null>(null);
  let failed = $state(false);
  // A newer load (a retry, or other props) makes the older answer stale.
  let loadId = 0;

  // The map graph is public and comes over HTTP; the socket then carries only the state.
  function load(): void {
    const mine = ++loadId;
    map = null;
    failed = false;
    Promise.all([
      api.map(mapId).then(async (file) => ({ file, geography: await geoOf(file) })),
      backgroundUrlOf(api, mapId),
    ]).then(
      ([{ file, geography }, background]) => {
        if (mine === loadId) {
          backgroundUrl = background;
          geo = geography;
          map = file;
        }
      },
      () => {
        if (mine === loadId) failed = true;
      },
    );
  }

  $effect(() => {
    load();
    return () => {
      loadId += 1;
    };
  });
</script>

{#if map !== null}
  <LiveMatch {matchId} {token} {map} {backgroundUrl} {geo} {onend} {onexit} />
{:else if failed}
  <FailurePanel
    title={t('match.error.map.title')}
    text={t('match.error.map.text')}
    primary={{
      label: 'match.retry',
      run: load,
    }}
    {onexit}
  />
{:else}
  <MatchLoading stage="map" />
{/if}
