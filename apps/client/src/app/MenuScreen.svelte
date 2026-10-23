<script lang="ts">
  import { tf, t, type MessageKey } from '../i18n/index.ts';
  import LocaleSelect from './LocaleSelect.svelte';

  interface Props {
    nick: string;
    notice: MessageKey | null;
    oncreate: () => void;
    onqueue: () => void;
    onlobby: () => void;
    onbot: () => void;
    /** The account has a password; without one the way out warns that the account is lost. */
    hasPassword: boolean;
    onpassword: () => void;
    onlogout: () => void;
    /** A match of this guest is running: the way back into it. */
    hasActiveMatch?: boolean;
    onresume?: () => void;
  }

  let {
    nick,
    notice,
    oncreate,
    onqueue,
    onlobby,
    onbot,
    hasPassword,
    onpassword,
    onlogout,
    hasActiveMatch = false,
    onresume = () => undefined,
  }: Props = $props();

  // A guest without a password loses the account by logging out: ask once before that.
  let confirmingLogout = $state(false);

  function logout(): void {
    if (hasPassword || confirmingLogout) onlogout();
    else confirmingLogout = true;
  }
</script>

<main class="screen">
  <div class="card">
    <h1>{t('app.title')}</h1>
    <p>{tf('menu.greeting', { nick })}</p>
    {#if notice !== null}
      <p class="error" role="alert">{t(notice)}</p>
    {/if}
    {#if hasActiveMatch}
      <p role="status">{t('menu.activeMatch')}</p>
      <div class="actions">
        <button type="button" class="primary" onclick={onresume}>{t('menu.resume')}</button>
      </div>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={onqueue}>{t('menu.queue')}</button>
      <button type="button" class="primary" onclick={oncreate}>{t('menu.create')}</button>
      <button type="button" class="primary" onclick={onlobby}>{t('menu.lobby')}</button>
      <button type="button" class="primary" onclick={onbot}>{t('menu.bot')}</button>
    </div>
    {#if confirmingLogout}
      <p class="error" role="alert">{t('menu.logoutWarning')}</p>
    {/if}
    <div class="actions">
      <button type="button" onclick={onpassword}>
        {hasPassword ? t('menu.changePassword') : t('menu.setPassword')}
      </button>
      <button type="button" onclick={logout}>
        {confirmingLogout ? t('menu.logoutConfirm') : t('menu.logout')}
      </button>
      {#if confirmingLogout}
        <button
          type="button"
          onclick={() => {
            confirmingLogout = false;
          }}>{t('menu.logoutCancel')}</button
        >
      {/if}
    </div>
    <LocaleSelect />
  </div>
</main>
