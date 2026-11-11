<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import type { BotLevel } from '../api/http.ts';
  import type { MessageKey } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerColour, PlayerId } from '../protocol.gen.ts';
  import ReplayScreen from '../replay/ReplayScreen.svelte';
  import CrashGuard from './CrashGuard.svelte';
  import { AppState, type Guest } from './appState.svelte.ts';
  import { HOME_KEY, type HomeGetter } from './home.ts';
  import ProfileScreen from '../board/ProfileScreen.svelte';
  import SettingsScreen from './SettingsScreen.svelte';
  import { settings } from './settingsState.svelte.ts';
  import BootScreen from './BootScreen.svelte';
  import MatchScreen from './MatchScreen.svelte';
  import PasswordScreen from './PasswordScreen.svelte';
  import HowToScreen from './HowToScreen.svelte';
  import type { MatchSummary } from './matchSummary.ts';
  import PlayScreen from './PlayScreen.svelte';
  import {
    dismissNewHere,
    NEW_HERE_ENABLED,
    newHereDismissed,
    showNewHere,
    type PlayContext,
    type Way,
  } from './play.ts';
  import ResultScreen from './ResultScreen.svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';

  interface Props {
    /** Tests pass their own state (fake API and storage). */
    app?: AppState;
    /** The browser storage of "New here?"; tests pass their own. */
    storage?: () => Storage;
  }

  let { app = new AppState(), storage = () => window.localStorage }: Props = $props();

  onMount(() => {
    void app.start();
  });

  const screen = $derived(app.screen);

  // The brand of the bar goes back to the main screen from the pages, the result and the replay
  // (#945); on the main screen, the boot and the entry it does nothing, and a match has no bar.
  const HOME_FROM: ReadonlySet<string> = new Set([
    'profile',
    'settings',
    'howto',
    'password',
    'result',
    'replay',
  ]);
  const home: HomeGetter = () =>
    HOME_FROM.has(app.screen.name) && app.guest !== null
      ? () => {
          app.menu();
        }
      : null;
  setContext(HOME_KEY, home);

  // The menu offers a way back into a running match (a failed "return" or a match left by hand).
  $effect(() => {
    if (app.screen.name === 'menu') {
      void app.refreshActiveMatch();
      void app.refreshProfile();
    }
  });
  const guest = $derived(app.guest);

  // The opening scene (#826) belongs to the first entry of the page only: never after a match, a
  // log-out or any other screen (the session mark of introScene.ts covers reloads).
  let firstEntry = $state(true);
  $effect(() => {
    if (screen.name !== 'boot' && screen.name !== 'welcome' && guest !== null) firstEntry = false;
  });

  // The main-screen motion (#919, item 8) plays when the main screen comes in from the entry, a
  // match, the result or a replay; coming back from a page over the map (the profile, the settings,
  // How to play, the password) it is already there.
  const PAGES: ReadonlySet<string> = new Set(['profile', 'settings', 'howto', 'password']);
  const PLAY: ReadonlySet<string> = new Set(['menu', 'queue', 'invite']);
  let entrance = $state(true);
  $effect(() => {
    const name = screen.name;
    // Once the main screen is up, its motion has played: a way chosen, a search stopped or a
    // waiting room left does not raise the plinth again.
    entrance = PLAY.has(name) ? false : !PAGES.has(name);
  });

  /** "New here?" after a nick was entered (#919, item 6), off until #806 (`NEW_HERE_ENABLED`). */
  const newHere = $derived(
    screen.name === 'menu' &&
      showNewHere({
        enabled: NEW_HERE_ENABLED,
        entered: app.entered,
        dismissed: newHereDismissed(storage),
      }),
  );

  function closeNewHere(learn: boolean, never: boolean): void {
    app.entered = false;
    if (never) dismissNewHere(storage);
    // The tutorial round (#806) is not there yet: the page of the rules stands in for it.
    if (learn) app.openPage('howto');
  }

  /** What the main screen (#919, III Plinth) needs from the app. */
  function playOf(who: Guest): PlayContext {
    return {
      api: app.api,
      token: who.token,
      nick: who.nick,
      hasPassword: who.hasPassword,
      map: app.backdrop,
      maps: app.maps,
      banUntil: app.queueBanUntil,
      hasActiveMatch: app.activeMatch !== null,
      onresume: () => {
        const running = app.activeMatch;
        if (running !== null) app.resumeMatch(running);
      },
      onway: (way: Way) => {
        app.go({ name: 'menu', way });
      },
      onsearch: () => {
        app.go({ name: 'queue' });
      },
      onbot: (level: BotLevel, pick: string) => app.playBot(level, pick),
      oninvite: () => app.createInvite(),
      onstart: (matchId: string, mapId: string) => {
        app.go({ name: 'match', matchId, mapId });
      },
      onofferbot: () => {
        // The plinth shows the wait for the new map and a failure (#889).
        app.go({ name: 'menu', way: 'bot', start: 'normal' });
      },
      onbanned: (seconds: number) => {
        app.banQueue(seconds);
      },
      onleave: (notice: MessageKey | null, way: Way) => {
        app.menu(notice, way);
      },
      onhelp: () => {
        app.openPage('howto');
      },
      onprofile: () => {
        app.openAccountPage('profile');
      },
    };
  }
</script>

{#if screen.name === 'boot'}
  <BootScreen map={app.backdrop} />
{:else if screen.name === 'welcome' || guest === null}
  <WelcomeScreen
    invited={app.pendingInvite !== null}
    notice={app.notice}
    map={app.backdrop}
    intro={firstEntry && settings.intro === 'session'}
    onsubmit={(nick: string) => app.register(nick)}
    onlogin={(nick: string, password: string) => app.login(nick, password)}
    onregister={(nick: string, password: string) => app.registerAccount(nick, password)}
  />
{:else if screen.name === 'menu' || screen.name === 'queue' || screen.name === 'invite'}
  <PlayScreen
    ctx={playOf(guest)}
    view={screen}
    notice={app.notice}
    {entrance}
    {newHere}
    onnewhere={closeNewHere}
  />
{:else if screen.name === 'howto'}
  <HowToScreen
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    onprofile={() => {
      app.openAccountPage('profile');
    }}
    onback={() => {
      app.closePage();
    }}
  />
{:else if screen.name === 'profile'}
  <ProfileScreen
    api={app.api}
    token={guest.token}
    ownId={app.playerId}
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    onwatch={(matchId: string) => {
      app.openReplay(matchId);
    }}
    onbot={() => {
      app.go({ name: 'menu', way: 'bot' });
    }}
    onnick={(nick: string) => app.changeNick(nick)}
    colour={app.colour}
    oncolour={(colour: PlayerColour) => app.changeColour(colour)}
    onsettings={() => {
      app.openAccountPage('settings');
    }}
    onpassword={() => {
      app.openPage('password');
    }}
    onlogout={() => {
      app.logout();
    }}
    onhelp={() => {
      app.openPage('howto');
    }}
    onback={() => {
      app.closeAccountPage();
    }}
  />
{:else if screen.name === 'settings'}
  <SettingsScreen
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    onprofile={() => {
      app.openAccountPage('profile');
    }}
    onhowto={() => {
      app.openPage('howto');
    }}
    onpassword={() => {
      app.openPage('password');
    }}
    onlogout={() => {
      app.logout();
    }}
    onback={() => {
      app.closeAccountPage();
    }}
  />
{:else if screen.name === 'password'}
  <PasswordScreen
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    onsubmit={(password: string, oldPassword: string) => app.setPassword(password, oldPassword)}
    onprofile={() => {
      app.openAccountPage('profile');
    }}
    onhowto={() => {
      app.openPage('howto');
    }}
    onback={() => {
      app.closePage();
    }}
  />
{:else if screen.name === 'match'}
  {#key screen.matchId}
    <CrashGuard
      onexit={() => {
        app.menu();
      }}
    >
      <MatchScreen
        api={app.api}
        token={guest.token}
        matchId={screen.matchId}
        mapId={screen.mapId}
        onend={(me: PlayerId, end: MatchEndMsg, summary: MatchSummary | null) => {
          app.finishMatch(screen.matchId, screen.mapId, me, end, summary);
        }}
        onexit={() => {
          app.menu();
        }}
      />
    </CrashGuard>
  {/key}
{:else if screen.name === 'result'}
  <ResultScreen
    me={screen.me}
    end={screen.end}
    summary={screen.summary}
    map={app.backdrop}
    mapId={screen.mapId}
    onreplay={() => {
      app.openReplay(screen.matchId, screen.me);
    }}
    onmenu={() => {
      app.menu();
    }}
  />
{:else}
  <ReplayScreen
    api={app.api}
    matchId={screen.matchId}
    token={guest.token}
    me={screen.me ?? null}
    nick={guest.nick}
    onback={() => {
      app.closeReplay();
    }}
  />
{/if}
