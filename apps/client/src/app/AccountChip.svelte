<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import type { Calibration } from '../protocol.gen.ts';
  import LogoutDialog from './LogoutDialog.svelte';
  import PlayerChip from './PlayerChip.svelte';

  interface Props {
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    /** The displayed rating of a ranked account (#78), null while unknown. */
    rating?: number | null;
    /** The own profile and the settings (#871); absent: the menu has no such item. */
    onprofile?: () => void;
    onsettings?: () => void;
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
    onprofile,
    onsettings,
    onpassword,
    onlogout,
    open = $bindable(false),
    inert = false,
  }: Props = $props();

  // A guest without a password loses the account by logging out: the dialog asks once before that.
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
      {#if onprofile !== undefined}
        <button type="button" role="menuitem" onclick={onprofile}>
          <Icon name="user" size={18} />
          {t('profile.title')}
        </button>
      {/if}
      {#if onsettings !== undefined}
        <button type="button" role="menuitem" onclick={onsettings}>
          <Icon name="settings" size={18} />
          {t('settings.title')}
        </button>
      {/if}
      {#if onprofile !== undefined || onsettings !== undefined}
        <div class="sep" role="separator"></div>
      {/if}
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
    <LogoutDialog
      onpassword={() => {
        confirmingLogout = false;
        onpassword();
      }}
      {onlogout}
      onstay={stay}
    />
  {/if}
</div>
