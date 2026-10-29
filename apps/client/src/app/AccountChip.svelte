<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import type { Calibration } from '../protocol.gen.ts';
  import PlayerChip from './PlayerChip.svelte';

  interface Props {
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    /** The displayed rating of a ranked account (#78), null while unknown. */
    rating?: number | null;
    onpassword: () => void;
    onlogout: () => void;
    /** Whether the account menu is open; the screen reads it to keep its own keys quiet. */
    open?: boolean;
    /** The chip shows the player but opens nothing (a waiting room: leaving would drop the invite). */
    inert?: boolean;
  }

  let {
    nick,
    hasPassword,
    calibration,
    rating = null,
    onpassword,
    onlogout,
    open = $bindable(false),
    inert = false,
  }: Props = $props();

  // A guest without a password loses the account by logging out: ask once before that.
  let confirmingLogout = $state(false);

  function close(): void {
    open = false;
    confirmingLogout = false;
  }

  function logout(): void {
    if (hasPassword || confirmingLogout) onlogout();
    else confirmingLogout = true;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) {
      close();
      event.preventDefault();
    }
  }

  function onclick(event: MouseEvent): void {
    if (open && event.target instanceof Element && !event.target.closest('.acct')) close();
  }
</script>

<svelte:window {onkeydown} {onclick} />

<div class="acct">
  <PlayerChip
    {nick}
    {hasPassword}
    {calibration}
    {rating}
    {open}
    disabled={inert}
    ontoggle={() => {
      if (open) close();
      else open = true;
    }}
  />
  {#if open}
    <div class="pop" id="account-menu" role="menu">
      {#if confirmingLogout}
        <p class="wl" role="alert">
          <Icon name="alert" size={16} />{t('menu.logoutWarning')}
        </p>
      {/if}
      <button type="button" role="menuitem" onclick={onpassword}>
        <Icon name="key" size={18} />
        {hasPassword ? t('menu.changePassword') : t('menu.setPassword')}
      </button>
      <button type="button" role="menuitem" onclick={logout}>
        <Icon name="logout" size={18} />
        {confirmingLogout ? t('menu.logoutConfirm') : t('menu.logout')}
      </button>
      {#if confirmingLogout}
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            confirmingLogout = false;
          }}>{t('menu.logoutCancel')}</button
        >
      {/if}
    </div>
  {/if}
</div>
