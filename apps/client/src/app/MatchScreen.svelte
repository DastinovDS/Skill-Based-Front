<script lang="ts">
  import { Api } from '../api/http.ts';
  import { t } from '../i18n/index.ts';
  import { backgroundUrlOf } from '../map/background.ts';
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
  let failed = $state(false);

  // The map graph is public and comes over HTTP; the socket then carries only the state.
  $effect(() => {
    let current = true;
    map = null;
    failed = false;
    Promise.all([api.map(mapId), backgroundUrlOf(api, mapId)]).then(
      ([file, background]) => {
        if (current) {
          backgroundUrl = background;
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
  <LiveMatch {matchId} {token} {map} {backgroundUrl} {onend} {onexit} />
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
