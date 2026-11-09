<script lang="ts">
  import LeaderboardScreen from '../board/LeaderboardScreen.svelte';
  import ReplaysScreen from '../board/ReplaysScreen.svelte';
  import ProfileScreen from '../board/ProfileScreen.svelte';
  import SettingsScreen from '../app/SettingsScreen.svelte';
  import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
  import MenuScreen from '../app/MenuScreen.svelte';
  import { Api } from '../api/http.ts';
  import CrashGuard from '../app/CrashGuard.svelte';
  import MatchLoading from '../app/MatchLoading.svelte';
  import MatchScreen from '../app/MatchScreen.svelte';
  import DevBoom from './DevBoom.svelte';
  import DevDock from './DevDock.svelte';
  import DevStyle from './DevStyle.svelte';
  import ResultScreen from '../app/ResultScreen.svelte';
  import QueueView from '../app/QueueView.svelte';
  import WelcomeScreen from '../app/WelcomeScreen.svelte';
  import ExitDialog from '../hud/ExitDialog.svelte';
  import BootScreen from '../app/BootScreen.svelte';
  import { MENU_MAP } from '../app/menuMap.ts';
  import { freezeBackdrop } from '../app/menuCaptures.ts';
  import { isSeason, setSeasonOverride } from '../app/menuSeason.ts';
  import { BOARD_NOW, BOARD_SCENES, isBoardScene, ME, sceneApi } from './boardScenes.ts';
  import {
    BAN_SECONDS,
    CALIBRATION,
    QUEUE_SCENES,
    RESULT_SCENES,
    RESULT_SUMMARY,
    isDockScene,
    isMenuScene,
  } from './menuScenes.ts';

  // `?menu=<id>`: one screen before a match with fixed data (see menuScenes.ts).
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('menu');
  // `&season=winter`: the picture in another season than the date's (#474).
  const season = params.get('season');
  setSeasonOverride(isSeason(season) ? season : null);
  // `&bt=12.5`: the picture frozen at that second of its clock (a capture, the seam of its loop, #866).
  const frozen = params.get('bt');
  freezeBackdrop(frozen === null || !Number.isFinite(Number(frozen)) ? null : Number(frozen));
  const id = isMenuScene(requested) ? requested : 'menu-guest';
  const map = MENU_MAP;
  // `welcome-intro&t=2.6`: the opening scene frozen at that moment; `welcome&intro` plays it (#826).
  const introAt = Number(params.get('t') ?? '2.6');
  const nothing = (): void => undefined;
  const handlers = {
    oncreate: nothing,
    onqueue: nothing,
    onlobby: nothing,
    onreplays: nothing,
    onboard: nothing,
    onhowto: nothing,
    onbot: nothing,
    onpassword: nothing,
    onlogout: nothing,
    onprofile: nothing,
    onsettings: nothing,
  };
  // The joining scenes: the real MatchScreen on a fetch that never answers (the map stage) or fails.
  const waiting = new Api(() => new Promise<Response>(() => undefined));
  const broken = new Api(() => Promise.reject(new TypeError('offline')));
  const board = isBoardScene(id) ? BOARD_SCENES[id] : null;
  const tabs = {
    onplay: nothing,
    onreplays: nothing,
    onboard: nothing,
    onhowto: nothing,
    onprofile: nothing,
    onsettings: nothing,
  };
  // The pool maps of the replay cards, from the bundle: the scenes ask no server.
  const bundled = (mapId: string) => BUNDLED_MAPS.find((m) => m.meta.name === mapId) ?? null;
  const maps = {
    get: bundled,
    ensure: (mapId: string) => Promise.resolve(bundled(mapId)),
    thumb: () => null,
  };
  const queue = QUEUE_SCENES[id];
  const result = RESULT_SCENES[id];
</script>

{#if id === 'style'}
  <DevStyle part="sheet" />
{:else if id === 'style-overlay'}
  <MenuScreen
    {map}
    nick="Ember"
    notice={null}
    hasPassword
    calibration={null}
    rating={1480}
    {...handlers}
  />
  <DevStyle part="overlay" />
{:else if id === 'welcome' || id === 'welcome-notice' || id === 'welcome-invited' || id === 'welcome-intro'}
  <WelcomeScreen
    {map}
    introAt={id === 'welcome-intro' ? introAt : null}
    intro={params.has('intro')}
    invited={id === 'welcome-invited'}
    notice={id === 'welcome-notice' ? 'error.api.unauthorized' : null}
    onsubmit={() => Promise.resolve()}
    onlogin={() => Promise.resolve(null)}
    onregister={() => Promise.resolve(null)}
  />
{:else if isDockScene(id)}
  <DevDock {id} {map} />
{:else if board !== null && board.mode === 'profile'}
  <ProfileScreen
    api={sceneApi(board)}
    token="dev"
    ownId={ME}
    nick="Ember"
    hasPassword={board.hasPassword}
    calibration={board.calibration}
    rating={board.rating}
    {map}
    onwatch={nothing}
    onbot={nothing}
    onnick={(nick: string) =>
      Promise.resolve(
        nick.toLowerCase() === 'vega' ? { key: 'welcome.error.taken' as const } : null,
      )}
    onpassword={nothing}
    onlogout={nothing}
    onback={nothing}
    {...tabs}
  />
{:else if board !== null && board.mode === 'settings'}
  <SettingsScreen
    nick="Ember"
    hasPassword={board.hasPassword}
    calibration={board.calibration}
    rating={board.rating}
    {map}
    onpassword={nothing}
    onlogout={nothing}
    onback={nothing}
    {...tabs}
  />
{:else if board !== null && board.mode === 'history'}
  <ReplaysScreen
    api={sceneApi(board)}
    token="dev"
    ownId={ME}
    nick="Ember"
    hasPassword={board.hasPassword}
    calibration={board.calibration}
    rating={board.rating}
    {map}
    {maps}
    now={() => BOARD_NOW}
    onwatch={nothing}
    onbot={nothing}
    onpassword={nothing}
    onlogout={nothing}
    {...tabs}
  />
{:else if board !== null}
  <LeaderboardScreen
    api={sceneApi(board)}
    token="dev"
    ownId={ME}
    nick="Ember"
    hasPassword={board.hasPassword}
    calibration={board.calibration}
    rating={board.rating}
    {map}
    onpassword={nothing}
    onlogout={nothing}
    {...tabs}
  />
{:else if result !== undefined}
  <ResultScreen
    me={0}
    end={result}
    summary={RESULT_SUMMARY}
    {map}
    mapId="gen1-17"
    onreplay={nothing}
    onmenu={nothing}
  />
{:else if id === 'match-loading-map'}
  <MatchScreen
    api={waiting}
    token="dev"
    matchId="dev"
    mapId="dev"
    onend={nothing}
    onexit={nothing}
  />
{:else if id === 'match-error-map'}
  <MatchScreen
    api={broken}
    token="dev"
    matchId="dev"
    mapId="dev"
    onend={nothing}
    onexit={nothing}
  />
{:else if id === 'match-loading-connect' || id === 'match-loading-frame'}
  <div class="stage">
    <MatchLoading stage={id === 'match-loading-connect' ? 'connect' : 'frame'} />
  </div>
{:else if id === 'crash'}
  <CrashGuard onexit={nothing} onreload={nothing}><DevBoom /></CrashGuard>
{:else if id === 'boot'}
  <BootScreen {map} delay={0} />
{:else if id === 'exit-rated'}
  <div class="stage">
    <ExitDialog open rated banSeconds={300} onforfeit={nothing} onstay={nothing} />
  </div>
{:else if queue !== undefined}
  <QueueView
    {map}
    status={queue}
    nick="Ember"
    failure={null}
    busy={false}
    {...{ onconfirm: nothing, onleave: nothing, onbot: nothing }}
  />
{:else if id === 'menu-resume'}
  <MenuScreen
    {map}
    nick="Ember"
    notice={null}
    hasPassword
    calibration={CALIBRATION}
    hasActiveMatch
    {...handlers}
  />
{:else if id === 'menu-banned'}
  <MenuScreen
    {map}
    nick="Ember"
    notice={null}
    hasPassword
    calibration={CALIBRATION}
    banUntil={BAN_SECONDS * 1000}
    now={() => 0}
    {...handlers}
  />
{:else if id === 'menu-error'}
  <MenuScreen
    {map}
    nick="Ember"
    notice="error.api.network"
    hasPassword
    calibration={null}
    {...handlers}
  />
{:else}
  <MenuScreen
    {map}
    nick="Ember"
    notice={null}
    hasPassword={id !== 'menu-guest'}
    calibration={id === 'menu-calibration' ? CALIBRATION : null}
    rating={id === 'menu-ranked' ? 1480 : null}
    {...handlers}
  />
{/if}

<style>
  /* The exit dialog is an overlay of the match screen: give it a page to cover. */
  .stage {
    position: fixed;
    inset: 0;
    background: var(--bg);
  }
</style>
