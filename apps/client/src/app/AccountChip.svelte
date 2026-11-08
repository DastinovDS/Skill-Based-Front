<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import type { Calibration } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';
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

  // A guest without a password loses the account by logging out: a dialog on the stone asks once
  // before that (Lapis, #845).
  let confirmingLogout = $state(false);

  function close(): void {
    open = false;
  }

  // While the dialog shows, `open` stays true: the screen behind keeps its keys quiet.
  function logout(): void {
    if (hasPassword) onlogout();
    else confirmingLogout = true;
  }

  function stay(): void {
    confirmingLogout = false;
    open = false;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open && !confirmingLogout) {
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
  {#if open && !confirmingLogout}
    <div class="pop rule-frame" id="account-menu" role="menu">
      <button type="button" role="menuitem" onclick={onpassword}>
        <Icon name="key" size={18} />
        {hasPassword ? t('menu.changePassword') : t('menu.setPassword')}
      </button>
      <button type="button" role="menuitem" onclick={logout}>
        <Icon name="logout" size={18} />
        {t('menu.logout')}
      </button>
    </div>
  {/if}
  {#if confirmingLogout}
    <StoneOverlay label={t('menu.logoutTitle')} role="alertdialog" onclose={stay}>
      <p class="kicker">{t('account.eyebrow')}</p>
      <h2 class="dlg-h">{t('menu.logoutTitle')}</h2>
      <p class="dlg-p">{t('menu.logoutWarning')}</p>
      <div class="dlg-acts">
        <LapisButton
          variant="primary"
          onclick={() => {
            confirmingLogout = false;
            onpassword();
          }}>{t('menu.setPassword')}</LapisButton
        >
      </div>
      <div class="dlg-acts">
        <LapisButton danger onclick={onlogout}>{t('menu.logoutConfirm')}</LapisButton>
        <button type="button" class="lnk" onclick={stay}>{t('menu.logoutCancel')}</button>
      </div>
    </StoneOverlay>
  {/if}
</div>
