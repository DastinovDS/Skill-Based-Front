<script lang="ts">
  import MenuScreen from '../app/MenuScreen.svelte';
  import QueueView from '../app/QueueView.svelte';
  import WelcomeScreen from '../app/WelcomeScreen.svelte';
  import { DEFAULT_MAP, BUNDLED_MAPS } from '../map/bundledMaps.ts';
  import { BAN_SECONDS, CALIBRATION, QUEUE_SCENES, isMenuScene } from './menuScenes.ts';

  // `?menu=<id>`: one screen before a match with fixed data (see menuScenes.ts).
  const requested = new URLSearchParams(window.location.search).get('menu');
  const id = isMenuScene(requested) ? requested : 'menu-guest';
  const map = BUNDLED_MAPS.find((m) => m.meta.name === 'crossroads') ?? DEFAULT_MAP;
  const nothing = (): void => undefined;
  const handlers = {
    oncreate: nothing,
    onqueue: nothing,
    onlobby: nothing,
    onbot: nothing,
    onpassword: nothing,
    onlogout: nothing,
  };
  const queue = QUEUE_SCENES[id];
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
