<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { MenuTab, MenuTabActions } from './menuTabs.ts';

  interface Props extends MenuTabActions {
    /** The tab that is open: underlined and bold, not only brighter. */
    current: MenuTab;
    /**
     * The Play tab of the menu itself is no way anywhere (it is open); under it a Dock screen
     * (bot, friend, lobby) is, and the tab leads back to the menu.
     */
    playOpen?: boolean;
    /** A waiting room: the tabs are off, leaving drops the invite (#473). */
    locked?: boolean;
  }

  let {
    current,
    playOpen = false,
    locked = false,
    onplay,
    onreplays,
    onboard,
    onhowto,
  }: Props = $props();

  const tabs = $derived([
    { id: 'play', label: t('menu.play'), go: onplay },
    { id: 'replays', label: t('menu.replays'), go: onreplays },
    { id: 'board', label: t('menu.leaderboard'), go: onboard },
    { id: 'howto', label: t('help.howTo'), go: onhowto },
  ] as const);
</script>

<!-- The menu as tabs at the top (#629, M5): Play, Replays, Leaderboard, How to play. -->
<nav class="tabs" aria-label={t('menu.nav')}>
  {#each tabs as tab (tab.id)}
    {@const here = tab.id === current}
    {#if here && (tab.id !== 'play' || playOpen)}
      <span class="tab cur" aria-current="page">{tab.label}</span>
    {:else}
      <button
        type="button"
        class="tab"
        class:cur={here}
        aria-current={here ? 'page' : undefined}
        disabled={locked}
        onclick={tab.go}>{tab.label}</button
      >
    {/if}
  {/each}
</nav>
