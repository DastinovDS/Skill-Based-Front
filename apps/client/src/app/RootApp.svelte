<script lang="ts">
  import { onMount } from 'svelte';
  import type { BotLevel } from '../api/http.ts';
  import { t, type MessageKey } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import ReplayScreen from '../replay/ReplayScreen.svelte';
  import { AppState } from './appState.svelte.ts';
  import BotScreen from './BotScreen.svelte';
  import CreateScreen from './CreateScreen.svelte';
  import InviteScreen from './InviteScreen.svelte';
  import MatchScreen from './MatchScreen.svelte';
  import MenuScreen from './MenuScreen.svelte';
  import ResultScreen from './ResultScreen.svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';

  interface Props {
    /** Tests pass their own state (fake API and storage). */
    app?: AppState;
  }

  let { app = new AppState() }: Props = $props();

  onMount(() => {
    void app.start();
  });

  const screen = $derived(app.screen);
  const guest = $derived(app.guest);
</script>

{#if screen.name === 'boot'}
  <main class="screen"><p role="status">{t('common.loading')}</p></main>
{:else if screen.name === 'welcome' || guest === null}
  <WelcomeScreen
    invited={app.pendingInvite !== null}
    notice={app.notice}
    onsubmit={(nick: string) => app.register(nick)}
  />
{:else if screen.name === 'menu'}
  <MenuScreen
    nick={guest.nick}
    notice={app.notice}
    oncreate={() => {
      app.go({ name: 'create' });
    }}
    onbot={() => {
      app.go({ name: 'bot' });
    }}
    onchangenick={() => {
      app.forget();
      app.menu();
    }}
  />
{:else if screen.name === 'create'}
  <CreateScreen
    api={app.api}
    oncreate={(mapId: string | null) => app.createInvite(mapId)}
    onback={() => {
      app.menu();
    }}
  />
{:else if screen.name === 'bot'}
  <BotScreen
    api={app.api}
    onstart={(level: BotLevel, mapId: string | null) => app.playBot(level, mapId)}
    onback={() => {
      app.menu();
    }}
  />
{:else if screen.name === 'invite'}
  {#key screen.code}
    <InviteScreen
      api={app.api}
      token={guest.token}
      nick={guest.nick}
      code={screen.code}
      onstart={(matchId: string, mapId: string) => {
        app.go({ name: 'match', matchId, mapId });
      }}
      onleave={(notice: MessageKey | null) => {
        app.menu(notice);
      }}
    />
  {/key}
{:else if screen.name === 'match'}
  {#key screen.matchId}
    <MatchScreen
      api={app.api}
      token={guest.token}
      matchId={screen.matchId}
      mapId={screen.mapId}
      onend={(me: PlayerId, end: MatchEndMsg) => {
        app.finishMatch(screen.matchId, me, end);
      }}
      onexit={() => {
        app.menu();
      }}
    />
  {/key}
{:else if screen.name === 'result'}
  <ResultScreen
    me={screen.me}
    end={screen.end}
    onreplay={() => {
      app.go({ name: 'replay', matchId: screen.matchId });
    }}
    onmenu={() => {
      app.menu();
    }}
  />
{:else}
  <ReplayScreen
    matchId={screen.matchId}
    token={guest.token}
    onback={() => {
      app.menu();
    }}
  />
{/if}
