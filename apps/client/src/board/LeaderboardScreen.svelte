<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Api } from '../api/http.ts';
  import AccountChip from '../app/AccountChip.svelte';
  import MenuTabs from '../app/MenuTabs.svelte';
  import type { MenuTabActions } from '../app/menuTabs.ts';
  import { t } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import BoardTable from './BoardTable.svelte';
  import { BoardState } from './boardState.svelte.ts';
  import SheetFrame from './SheetFrame.svelte';

  interface Props extends MenuTabActions {
    api: Pick<Api, 'leaderboard' | 'player' | 'me'>;
    token: string;
    /** The own player id, if the app knows it (otherwise the screen asks the server). */
    ownId: number | null;
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    /** The displayed rating of the account for the corner chip, if known. */
    rating: number | null;
    map: MapFile | null;
    onpassword: () => void;
    onlogout: () => void;
  }

  let {
    api,
    token,
    ownId,
    nick,
    hasPassword,
    calibration,
    rating,
    map,
    onpassword,
    onlogout,
    onplay,
    onreplays,
    onboard,
    onhowto,
  }: Props = $props();

  // The data is asked once when the screen opens; the props that feed it do not change here.
  const data = untrack(() => new BoardState(api, token, ownId));

  onMount(() => {
    void data.start();
  });
  onDestroy(() => {
    data.stop();
  });

  let accountOpen = $state(false);

  const ownProfile = $derived(data.own.status === 'ready' ? data.own.value : null);

  // Esc goes back to the menu.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    // The account menu keeps its own keys while it is open.
    if (accountOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onplay();
    }
  }
</script>

<svelte:window {onkeydown} />

<SheetFrame {map} label={t('menu.leaderboard')}>
  {#snippet tabs()}
    <MenuTabs current="board" {onplay} {onreplays} {onboard} {onhowto} />
  {/snippet}
  {#snippet corner()}
    <AccountChip
      {nick}
      {hasPassword}
      {calibration}
      {rating}
      {onpassword}
      {onlogout}
      bind:open={accountOpen}
    />
  {/snippet}

  <BoardTable
    board={data.board}
    own={ownProfile}
    ownId={data.ownId}
    onretry={() => data.loadBoard()}
    {onpassword}
    {onplay}
  />
</SheetFrame>
