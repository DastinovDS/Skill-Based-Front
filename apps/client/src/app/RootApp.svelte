<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import type { BotLevel } from '../api/http.ts';
  import type { MessageKey } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerColour, PlayerId } from '../protocol.gen.ts';
  import { applyPlayerColour } from '../theme/tokens.ts';
  import CrashGuard from './CrashGuard.svelte';
  import { AppState, type Guest } from './appState.svelte.ts';
  import { HOME_KEY, type HomeGetter } from './home.ts';
  import ProfileScreen from '../board/ProfileScreen.svelte';
  import SettingsScreen from './SettingsScreen.svelte';
  import { settings } from './settingsState.svelte.ts';
  import BootScreen from './BootScreen.svelte';
  import MatchLoading from './MatchLoading.svelte';
  import PasswordScreen from './PasswordScreen.svelte';
  import type { MatchSummary } from './matchSummary.ts';
  import PlayScreen from './PlayScreen.svelte';
  import type { PlayContext, Way } from './play.ts';
  import ResultScreen from './ResultScreen.svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';
  import Charter from './tutorial/Charter.svelte';
  import ChapterSheet from './tutorial/ChapterSheet.svelte';
  import TutorialOffer from './tutorial/TutorialOffer.svelte';
  import RulesScreen from './tutorial/RulesScreen.svelte';
  import type { ChapterId } from '../protocol.gen.ts';

  interface Props {
    /** Tests pass their own state (fake API and storage). */
    app?: AppState;
  }

  let { app = new AppState() }: Props = $props();

  onMount(() => {
    void app.start();
  });

  // The match and the replay screens carry PixiJS and the renderer; they are separate chunks, so the
  // entry does not load them (ARC-C05, #482). Once a player is signed in and the page is idle the
  // chunks are fetched anyway, so the first match does not wait for them.
  const loadMatchScreen = () => import('./MatchScreen.svelte');
  const loadReplayScreen = () => import('../replay/ReplayScreen.svelte');
  $effect(() => {
    if (app.guest === null) return;
    const warm = () => {
      void loadMatchScreen().catch(() => undefined);
      void loadReplayScreen().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(warm, 2000);
    return () => {
      window.clearTimeout(id);
    };
  });

  // Outside a match every helmet that stands for the player wears the colour they chose (DEC-49),
  // an illustrative opponent a contrasting one. A match, a replay and the result card set their own
  // `--own` and `--enemy` below this, from the colours the match used.
  $effect(() => applyPlayerColour(app.colour));

  const screen = $derived(app.screen);

  // The brand of the bar goes back to the main screen from the pages, the result and the replay
  // (#945); on the main screen, the boot and the entry it does nothing, and a match has no bar.
  const HOME_FROM: ReadonlySet<string> = new Set([
    'tutorial',
    'profile',
    'settings',
    'rules',
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
      // The first main screen of an entry may offer the tutorial (#806).
      void app.askOffer();
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
  // the tutorial, the rules, the password) it is already there.
  const PAGES: ReadonlySet<string> = new Set([
    'profile',
    'settings',
    'rules',
    'password',
    'tutorial',
    'chapter',
  ]);
  const PLAY: ReadonlySet<string> = new Set(['menu', 'queue', 'invite']);
  let entrance = $state(true);
  $effect(() => {
    const name = screen.name;
    // Once the main screen is up, its motion has played: a way chosen, a search stopped or a
    // waiting room left does not raise the plinth again.
    entrance = PLAY.has(name) ? false : !PAGES.has(name);
  });

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
        app.openTutorial();
      },
      onprofile: () => {
        app.openAccountPage('profile');
      },
    };
  }

  /** "Replay chapter" on a chapter's result: the chapter again, or the chapter select if it fails. */
  function replay(chapter: ChapterId): void {
    void app.startChapter(chapter).then((failed) => {
      if (failed !== null) {
        app.openTutorial();
        app.notice = failed;
      }
    });
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
  <PlayScreen ctx={playOf(guest)} view={screen} notice={app.notice} {entrance} />
  {#if app.offer && screen.name === 'menu'}
    <TutorialOffer
      onanswer={(start: boolean, off: boolean) => {
        app.answerOffer(start, off);
      }}
    />
  {/if}
{:else if screen.name === 'tutorial'}
  <Charter
    progress={app.tutorial.current}
    initial={screen.sel}
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    onchapter={(chapter: ChapterId) => {
      app.openChapter(chapter);
    }}
    onmatch={() => app.playFirstMatch()}
    onrules={() => {
      app.openPage('rules');
    }}
    onprofile={() => {
      app.openAccountPage('profile');
    }}
  />
{:else if screen.name === 'chapter'}
  <ChapterSheet
    chapter={screen.chapter}
    map={app.backdrop}
    onstart={() => app.startChapter(screen.chapter)}
    onchapters={() => {
      app.openTutorial();
    }}
  />
{:else if screen.name === 'rules'}
  <RulesScreen
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    map={app.backdrop}
    load={() => app.api.ruleset()}
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
    colour={app.colour}
    oncolour={(colour: PlayerColour) => app.changeColour(colour)}
    onsettings={() => {
      app.openAccountPage('settings');
    }}
    onhelp={() => {
      app.openTutorial();
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
      app.openTutorial();
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
      app.openTutorial();
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
      {#await loadMatchScreen()}
        <MatchLoading stage="map" />
      {:then { default: MatchScreen }}
        <MatchScreen
          api={app.api}
          token={guest.token}
          matchId={screen.matchId}
          mapId={screen.mapId}
          chapter={screen.chapter ?? null}
          hints={screen.chapter === undefined && app.tutorial.isFirstMatch(screen.matchId)
            ? app.tutorial
            : null}
          onend={(me: PlayerId, end: MatchEndMsg, summary: MatchSummary | null) => {
            app.finishMatch(screen.matchId, screen.mapId, me, end, summary);
          }}
          onexit={() => {
            if (screen.chapter === undefined) app.menu();
            else app.openTutorial();
          }}
          onchapters={() => {
            app.activeMatch = null;
            app.openTutorial();
          }}
          onreplay={() => {
            if (screen.chapter !== undefined) replay(screen.chapter);
          }}
          onchapterdone={(chapter: ChapterId) => {
            app.tutorial.complete(chapter);
          }}
        />
      {/await}
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
  <CrashGuard
    onexit={() => {
      app.closeReplay();
    }}
  >
    {#await loadReplayScreen()}
      <MatchLoading stage="map" />
    {:then { default: ReplayScreen }}
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
    {/await}
  </CrashGuard>
{/if}
