<script lang="ts">
  import { onMount } from 'svelte';
  import type { BotLevel } from '../api/http.ts';
  import type { MessageKey } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerColour, PlayerId } from '../protocol.gen.ts';
  import ReplayScreen from '../replay/ReplayScreen.svelte';
  import CrashGuard from './CrashGuard.svelte';
  import { AppState, type Guest } from './appState.svelte.ts';
  import type { DockContext } from './dock.ts';
  import LeaderboardScreen from '../board/LeaderboardScreen.svelte';
  import ReplaysScreen from '../board/ReplaysScreen.svelte';
  import type { AccountPages, MenuTabActions } from './menuTabs.ts';
  import ProfileScreen from '../board/ProfileScreen.svelte';
  import SettingsScreen from './SettingsScreen.svelte';
  import { settings } from './settingsState.svelte.ts';
  import BootScreen from './BootScreen.svelte';
  import BotScreen from './BotScreen.svelte';
  import CreateScreen from './CreateScreen.svelte';
  import LobbyScreen from './LobbyScreen.svelte';
  import InviteScreen from './InviteScreen.svelte';
  import MatchScreen from './MatchScreen.svelte';
  import MenuScreen from './MenuScreen.svelte';
  import PasswordScreen from './PasswordScreen.svelte';
  import HowToScreen from './HowToScreen.svelte';
  import QueueScreen from './QueueScreen.svelte';
  import type { MatchSummary } from './matchSummary.ts';
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

  /** The pages of the account chip (#871): the profile and the settings. */
  const pages: Required<AccountPages> = {
    onprofile: () => {
      app.openAccountPage('profile');
    },
    onsettings: () => {
      app.openAccountPage('settings');
    },
  };

  /** Where the tabs of the menu lead (#629, M5), and the pages of the account chip. */
  function tabsOf(): MenuTabActions & AccountPages {
    return {
      ...pages,
      onplay: () => {
        app.menu();
      },
      onreplays: () => {
        app.openBoard('history');
      },
      onboard: () => {
        app.openBoard('board');
      },
      onhowto: () => {
        app.go({ name: 'howto' });
      },
    };
  }

  /** What the lobby, invite and bot screens (the Dock, #473) need besides their own data. */
  function dockOf(who: Guest): DockContext {
    return {
      nick: who.nick,
      hasPassword: who.hasPassword,
      calibration: app.calibration,
      rating: app.rating,
      banUntil: app.queueBanUntil,
      map: app.backdrop,
      maps: app.maps,
      onbot: () => {
        app.go({ name: 'bot' });
      },
      oncreate: () => {
        app.go({ name: 'create', public: false });
      },
      onlobby: () => {
        app.go({ name: 'lobby' });
      },
      onreplays: () => {
        app.openBoard('history');
      },
      onboard: () => {
        app.openBoard('board');
      },
      onhowto: () => {
        app.go({ name: 'howto' });
      },
      onmenu: () => {
        app.menu();
      },
      ...pages,
      onpassword: () => {
        app.go({ name: 'password' });
      },
      onlogout: () => {
        app.logout();
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
{:else if screen.name === 'menu'}
  <MenuScreen
    nick={guest.nick}
    notice={app.notice}
    map={app.backdrop}
    calibration={app.calibration}
    rating={app.rating}
    banUntil={app.queueBanUntil}
    hasActiveMatch={app.activeMatch !== null}
    onresume={() => {
      const running = app.activeMatch;
      if (running !== null) app.resumeMatch(running);
    }}
    oncreate={() => {
      app.go({ name: 'create', public: false });
    }}
    onqueue={() => {
      app.go({ name: 'queue' });
    }}
    onlobby={() => {
      app.go({ name: 'lobby' });
    }}
    onreplays={() => {
      app.openBoard('history');
    }}
    onboard={() => {
      app.openBoard('board');
    }}
    onbot={() => {
      app.go({ name: 'bot' });
    }}
    onhowto={() => {
      app.go({ name: 'howto' });
    }}
    hasPassword={guest.hasPassword}
    {...pages}
    onpassword={() => {
      app.go({ name: 'password' });
    }}
    onlogout={() => {
      app.logout();
    }}
  />
{:else if screen.name === 'create'}
  <CreateScreen
    dock={dockOf(guest)}
    isPublic={screen.public}
    oncreate={(pick: string) => app.createInvite(pick, screen.public)}
    onback={() => {
      if (screen.public) app.go({ name: 'lobby' });
      else app.menu();
    }}
  />
{:else if screen.name === 'lobby'}
  <LobbyScreen
    api={app.api}
    token={guest.token}
    dock={dockOf(guest)}
    colour={app.colour}
    oncolour={(colour: PlayerColour) => app.changeColour(colour)}
    oncreate={() => {
      app.go({ name: 'create', public: true });
    }}
    onjoined={(code: string) => {
      app.go({ name: 'invite', code });
    }}
    onback={() => {
      app.menu();
    }}
  />
{:else if screen.name === 'queue'}
  <QueueScreen
    api={app.api}
    token={guest.token}
    map={app.backdrop}
    nick={guest.nick}
    onstart={(matchId: string, mapId: string) => {
      app.go({ name: 'match', matchId, mapId });
    }}
    onbot={() => {
      // The bot screen shows the wait for the new map and a failure (#889).
      app.go({ name: 'bot', start: 'normal' });
    }}
    onbanned={(seconds: number) => {
      app.banQueue(seconds);
    }}
    onleave={(notice: MessageKey | null) => {
      app.menu(notice);
    }}
  />
{:else if screen.name === 'bot'}
  <BotScreen
    dock={dockOf(guest)}
    start={screen.start}
    onstart={(level: BotLevel, pick: string) => app.playBot(level, pick)}
    onback={() => {
      app.menu();
    }}
  />
{:else if screen.name === 'howto'}
  <HowToScreen
    dock={dockOf(guest)}
    onback={() => {
      app.menu();
    }}
  />
{:else if screen.name === 'leaderboard' && screen.mode === 'history'}
  <ReplaysScreen
    api={app.api}
    token={guest.token}
    ownId={app.playerId}
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    calibration={app.calibration}
    rating={app.rating}
    map={app.backdrop}
    maps={app.maps}
    onwatch={(matchId: string) => {
      app.openReplay(matchId);
    }}
    onbot={() => {
      app.go({ name: 'bot' });
    }}
    onpassword={() => {
      app.go({ name: 'password' });
    }}
    onlogout={() => {
      app.logout();
    }}
    {...tabsOf()}
  />
{:else if screen.name === 'leaderboard'}
  <LeaderboardScreen
    api={app.api}
    token={guest.token}
    ownId={app.playerId}
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    calibration={app.calibration}
    rating={app.rating}
    map={app.backdrop}
    onpassword={() => {
      app.go({ name: 'password' });
    }}
    onlogout={() => {
      app.logout();
    }}
    {...tabsOf()}
  />
{:else if screen.name === 'profile'}
  <ProfileScreen
    api={app.api}
    token={guest.token}
    ownId={app.playerId}
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    calibration={app.calibration}
    rating={app.rating}
    map={app.backdrop}
    onwatch={(matchId: string) => {
      app.openReplay(matchId);
    }}
    onbot={() => {
      app.go({ name: 'bot' });
    }}
    onnick={(nick: string) => app.changeNick(nick)}
    colour={app.colour}
    oncolour={(colour: PlayerColour) => app.changeColour(colour)}
    onpassword={() => {
      app.go({ name: 'password' });
    }}
    onlogout={() => {
      app.logout();
    }}
    onback={() => {
      app.closeAccountPage();
    }}
    {...tabsOf()}
  />
{:else if screen.name === 'settings'}
  <SettingsScreen
    nick={guest.nick}
    hasPassword={guest.hasPassword}
    calibration={app.calibration}
    rating={app.rating}
    map={app.backdrop}
    onpassword={() => {
      app.go({ name: 'password' });
    }}
    onlogout={() => {
      app.logout();
    }}
    onback={() => {
      app.closeAccountPage();
    }}
    {...tabsOf()}
  />
{:else if screen.name === 'password'}
  <PasswordScreen
    dock={dockOf(guest)}
    hasPassword={guest.hasPassword}
    onsubmit={(password: string, oldPassword: string) => app.setPassword(password, oldPassword)}
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
      dock={dockOf(guest)}
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
