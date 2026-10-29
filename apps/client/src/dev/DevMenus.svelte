<script lang="ts">
  import LeaderboardScreen from '../board/LeaderboardScreen.svelte';
  import MenuScreen from '../app/MenuScreen.svelte';
  import DevDock from './DevDock.svelte';
  import ResultScreen from '../app/ResultScreen.svelte';
  import QueueView from '../app/QueueView.svelte';
  import WelcomeScreen from '../app/WelcomeScreen.svelte';
  import ExitDialog from '../hud/ExitDialog.svelte';
  import { MENU_MAP } from '../app/menuMap.ts';
  import { isSeason, setSeasonOverride } from '../app/menuSeason.ts';
  import { BOARD_NOW, BOARD_SCENES, isBoardScene, ME, sceneApi } from './boardScenes.ts';
  import {
    BAN_SECONDS,
    CALIBRATION,
    QUEUE_SCENES,
    RESULT_SCENES,
    isDockScene,
    isMenuScene,
  } from './menuScenes.ts';

  // `?menu=<id>`: one screen before a match with fixed data (see menuScenes.ts).
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('menu');
  // `&season=winter`: the picture in another season than the date's (#474).
  const season = params.get('season');
  setSeasonOverride(isSeason(season) ? season : null);
  const id = isMenuScene(requested) ? requested : 'menu-guest';
  const map = MENU_MAP;
  const nothing = (): void => undefined;
  const handlers = {
    oncreate: nothing,
    onqueue: nothing,
    onlobby: nothing,
    onbot: nothing,
    onpassword: nothing,
    onlogout: nothing,
  };
  const board = isBoardScene(id) ? BOARD_SCENES[id] : null;
  const queue = QUEUE_SCENES[id];
  const result = RESULT_SCENES[id];
</script>

{#if id === 'welcome' || id === 'welcome-notice'}
  <WelcomeScreen
    {map}
    invited={false}
    notice={id === 'welcome-notice' ? 'error.api.unauthorized' : null}
    onsubmit={() => Promise.resolve()}
    onlogin={() => Promise.resolve(null)}
    onregister={() => Promise.resolve(null)}
  />
{:else if isDockScene(id)}
  <DevDock {id} {map} />
{:else if board !== null}
  <LeaderboardScreen
    api={sceneApi(board)}
    token="dev"
    ownId={ME}
    nick="Danya"
    hasPassword={board.hasPassword}
    calibration={board.calibration}
    rating={board.rating}
    {map}
    mode={board.mode}
    player={board.player}
    now={() => BOARD_NOW}
    onselect={nothing}
    onwatch={nothing}
    onmenu={nothing}
    onbot={nothing}
    oncreate={nothing}
    onlobby={nothing}
    onreplays={nothing}
    onboard={nothing}
    onpassword={nothing}
  />
{:else if result !== undefined}
  <ResultScreen me={0} end={result} onreplay={nothing} onmenu={nothing} />
{:else if id === 'exit-rated'}
  <div class="stage">
    <ExitDialog open rated onforfeit={nothing} onstay={nothing} />
  </div>
{:else if queue !== undefined}
  <QueueView
    {map}
    status={queue}
    failure={null}
    busy={false}
    {...{ onconfirm: nothing, onleave: nothing, onbot: nothing }}
  />
{:else if id === 'menu-resume'}
  <MenuScreen
    {map}
    nick="Danya"
    notice={null}
    hasPassword
    calibration={CALIBRATION}
    hasActiveMatch
    {...handlers}
  />
{:else if id === 'menu-banned'}
  <MenuScreen
    {map}
    nick="Danya"
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
    nick="Danya"
    notice="error.api.network"
    hasPassword
    calibration={null}
    {...handlers}
  />
{:else}
  <MenuScreen
    {map}
    nick="Danya"
    notice={null}
    hasPassword={id !== 'menu-guest'}
    calibration={id === 'menu-calibration' ? CALIBRATION : null}
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
