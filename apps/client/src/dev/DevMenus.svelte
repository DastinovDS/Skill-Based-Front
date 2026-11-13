<script lang="ts">
  import { setContext } from 'svelte';
  import ProfileScreen from '../board/ProfileScreen.svelte';
  import SettingsScreen from '../app/SettingsScreen.svelte';
  import { Api } from '../api/http.ts';
  import CrashGuard from '../app/CrashGuard.svelte';
  import MatchLoading from '../app/MatchLoading.svelte';
  import MatchScreen from '../app/MatchScreen.svelte';
  import PasswordScreen from '../app/PasswordScreen.svelte';
  import DevBoom from './DevBoom.svelte';
  import DevPlay from './DevPlay.svelte';
  import DevStyle from './DevStyle.svelte';
  import ResultScreen from '../app/ResultScreen.svelte';
  import type { MatchSummary } from '../app/matchSummary.ts';
  import type { PlayerColour } from '../protocol.gen.ts';
  import { PLAYER_COLOUR_IDS, applyPlayerColour } from '../theme/tokens.ts';
  import WelcomeScreen from '../app/WelcomeScreen.svelte';
  import ExitDialog from '../hud/ExitDialog.svelte';
  import BootScreen from '../app/BootScreen.svelte';
  import { HOME_KEY } from '../app/home.ts';
  import { MENU_MAP } from '../app/menuMap.ts';
  import { freezeBackdrop } from '../app/menuCaptures.ts';
  import { isSeason, setSeasonOverride } from '../app/menuSeason.ts';
  import { BOARD_SCENES, isBoardScene, ME, sceneApi } from './boardScenes.ts';
  import { RESULT_SCENES, RESULT_SUMMARY, isMenuScene, isPlayScene } from './menuScenes.ts';
  import Charter from '../app/tutorial/Charter.svelte';
  import ChapterSheet from '../app/tutorial/ChapterSheet.svelte';
  import TutorialOffer from '../app/tutorial/TutorialOffer.svelte';
  import RulesScreen from '../app/tutorial/RulesScreen.svelte';
  import { DEV_RULES } from '../hud/devFeed.ts';
  import { EMPTY_PROGRESS, type CharterSeat } from '../tutorial/progress.ts';

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
  // The joining scenes: the real MatchScreen on a fetch that never answers (the map stage) or fails.
  const waiting = new Api(() => new Promise<Response>(() => undefined));
  const broken = new Api(() => Promise.reject(new TypeError('offline')));
  const board = isBoardScene(id) ? BOARD_SCENES[id] : null;
  // The brand of the bar goes home from the pages, as in the app (RootApp, #945).
  const pages = id === 'rules' || id.startsWith('settings') || id.startsWith('password');
  setContext(HOME_KEY, () => (board !== null || pages ? nothing : null));
  // The colour picker of the profile (DEC-49): a choice is kept at once, nothing is asked of a server.
  // `&colour=shell`: the player's chosen colour outside a match, for the shots.
  const asked = params.get('colour');
  let colour = $state<PlayerColour>(PLAYER_COLOUR_IDS.find((known) => known === asked) ?? 'lapis');
  $effect(() => applyPlayerColour(colour));
  const pickColour = (next: PlayerColour): Promise<null> => {
    colour = next;
    return Promise.resolve(null);
  };
  // `result-rated` is in the players' colours (DEC-49): the own Shell against the opponent's Violet.
  const resultSummary: MatchSummary =
    id === 'result-rated' ? { ...RESULT_SUMMARY, colours: ['shell', 'violet'] } : RESULT_SUMMARY;
  const result = RESULT_SCENES[id];
  // The chapter select at the walkthrough's three moments (R.1 to R.3) and a locked seal chosen.
  const charter = {
    'tutorial-charter-first': { progress: EMPTY_PROGRESS, sel: undefined },
    'tutorial-charter-progress': {
      progress: { ...EMPTY_PROGRESS, done: ['units', 'economy', 'building'] as const },
      sel: undefined,
    },
    'tutorial-charter-finished': {
      progress: {
        ...EMPTY_PROGRESS,
        done: ['units', 'economy', 'building', 'attack', 'defence', 'group-orders'] as const,
        firstMatch: true,
      },
      sel: undefined,
    },
    'tutorial-charter-locked': {
      progress: { ...EMPTY_PROGRESS, done: ['units', 'economy', 'building'] as const },
      sel: 'defence' as CharterSeat,
    },
  }[id as string];
</script>

{#if id === 'style'}
  <DevStyle part="sheet" />
{:else if id === 'style-overlay'}
  <DevPlay id="menu-account" {map} />
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
{:else if isPlayScene(id)}
  <DevPlay {id} {map} />
{:else if id === 'tutorial-offer'}
  <DevPlay id="menu-guest" {map} />
  <TutorialOffer onanswer={nothing} />
{:else if id === 'tutorial-sheet' || id === 'tutorial-sheet-advanced'}
  <ChapterSheet
    chapter={id === 'tutorial-sheet' ? 'units' : 'group-orders'}
    {map}
    onstart={() => Promise.resolve(null)}
    onchapters={nothing}
  />
{:else if charter !== undefined}
  <Charter
    progress={charter.progress}
    initial={charter.sel}
    nick="Ember"
    hasPassword={false}
    {map}
    onchapter={nothing}
    onmatch={() => Promise.resolve(null)}
    onrules={nothing}
    onprofile={nothing}
  />
{:else if id === 'rules'}
  <!-- The rules reference on the numbers of the main ruleset (mvp-7: CP 0.5 every 5 s in Balance,
       rally walks 0.5 CP, group orders); the server answers `GET /api/ruleset` with them. -->
  <RulesScreen
    nick="Ember"
    hasPassword={false}
    {map}
    load={() =>
      Promise.resolve({
        ...DEV_RULES,
        cp: { ...DEV_RULES.cp, per_period: 50 },
        stances: {
          ...DEV_RULES.stances,
          cp_period_ticks: { ...DEV_RULES.stances.cp_period_ticks, balance: 50 },
        },
        recruit: { ...DEV_RULES.recruit, rally_point: true, rally_cost: 50 },
        group_order: { max_groups: 16, rally_pct: 50 },
        combat: { ...DEV_RULES.combat, retreat: 'none' as const },
      })}
    onprofile={nothing}
    onback={nothing}
  />
{:else if id === 'password-set' || id === 'password-change'}
  <PasswordScreen
    nick="Ember"
    hasPassword={id === 'password-change'}
    {map}
    onsubmit={() => Promise.resolve(null)}
    onback={nothing}
  />
{:else if board !== null && board.mode === 'profile'}
  <ProfileScreen
    api={sceneApi(board)}
    token="dev"
    ownId={ME}
    nick="Ember"
    hasPassword={board.hasPassword}
    {map}
    onwatch={nothing}
    onbot={nothing}
    {colour}
    oncolour={pickColour}
    onsettings={nothing}
    onhelp={nothing}
    onback={nothing}
  />
{:else if board !== null}
  <SettingsScreen
    nick="Ember"
    hasPassword={board.hasPassword}
    {map}
    onprofile={nothing}
    onhowto={nothing}
    onpassword={nothing}
    onlogout={nothing}
    onback={nothing}
  />
{:else if result !== undefined}
  <ResultScreen
    me={0}
    end={result}
    summary={resultSummary}
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
{:else}
  <div class="stage">
    <ExitDialog open onforfeit={nothing} onstay={nothing} />
  </div>
{/if}

<style>
  /* The exit dialog is an overlay of the match screen: give it a page to cover. */
  .stage {
    position: fixed;
    inset: 0;
    background: var(--bg);
  }
</style>
