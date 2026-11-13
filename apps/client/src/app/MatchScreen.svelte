<script lang="ts">
  import { Api } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import { loadMatchMap } from '../map/art.ts';
  import type { GeoFile } from '../map/geography.ts';
  import type { ChapterId, MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import type { MatchSummary } from './matchSummary.ts';
  import type { HintProgress } from '../tutorial/hintCoach.svelte.ts';
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
    /** A tutorial chapter (#806): see `LiveMatch`. */
    chapter?: ChapterId | null;
    onchapters?: () => void;
    onreplay?: () => void;
    onchapterdone?: (chapter: ChapterId) => void;
    /** The first match of the tutorial: its hints (see `LiveMatch`). */
    hints?: HintProgress | null;
  }

  let {
    api,
    token,
    matchId,
    mapId,
    onend,
    onexit,
    chapter = null,
    onchapters,
    onreplay,
    onchapterdone,
    hints = null,
  }: Props = $props();

  let map = $state.raw<MapFile | null>(null);
  let backgroundUrl = $state.raw<string | null>(null);
  let geo = $state.raw<GeoFile | null>(null);
  let failed = $state(false);
  // A newer load (a retry, or other props) makes the older answer stale.
  let loadId = 0;

  // The map graph is public and comes over HTTP; the socket then carries only the state. The
  // background and the areas come from the summary of the map, a per-match one too (#884).
  function load(): void {
    const mine = ++loadId;
    map = null;
    failed = false;
    loadMatchMap(api, mapId).then(
      (loaded) => {
        if (mine === loadId) {
          backgroundUrl = loaded.backgroundUrl;
          geo = loaded.geo;
          map = loaded.file;
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
  <LiveMatch
    {matchId}
    {token}
    {map}
    {backgroundUrl}
    {geo}
    {onend}
    {onexit}
    {chapter}
    {onchapters}
    {onreplay}
    {onchapterdone}
    {hints}
  />
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
