<script lang="ts">
  import { t, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { failureText, passwordLengthOk, type AccountFailure } from './account.ts';
  import LocaleSelect from './LocaleSelect.svelte';
  import PasswordFields from './PasswordFields.svelte';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';

  type Mode = 'guest' | 'login' | 'register';

  interface Props {
    /** An invite link was opened: the nick form leads straight into that match. */
    invited: boolean;
    notice: MessageKey | null;
    /** The map drawn behind the form (null: the plain dark page). */
    map?: MapFile | null;
    /** Play as a guest: a nick and nothing else. */
    onsubmit: (nick: string) => Promise<void>;
    /** Log in to an account (#374); why it failed, or null. */
    onlogin: (nick: string, password: string) => Promise<AccountFailure | null>;
    /** A new account: nick and password in one go (#374); why it failed, or null. */
    onregister: (nick: string, password: string) => Promise<AccountFailure | null>;
  }

  let { invited, notice, map = null, onsubmit, onlogin, onregister }: Props = $props();

  let mode = $state<Mode>('guest');
  let nick = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let busy = $state(false);

  function choose(next: Mode): void {
    mode = next;
    password = '';
    repeat = '';
    failure = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    failure = null;
    if (mode === 'register') {
      if (!passwordLengthOk(password)) {
        failure = { key: 'error.account.passwordLength' };
        return;
      }
      if (password !== repeat) {
        failure = { key: 'error.account.mismatch' };
        return;
      }
    }
    busy = true;
    try {
      if (mode === 'guest') await onsubmit(nick.trim());
      else if (mode === 'login') failure = await onlogin(nick.trim(), password);
      else failure = await onregister(nick.trim(), password);
    } finally {
      busy = false;
    }
  }

  const intro = $derived(
    mode === 'login'
      ? t('welcome.introLogin')
      : mode === 'register'
        ? t('welcome.introRegister')
        : invited
          ? t('welcome.invited')
          : t('welcome.intro'),
  );
</script>

<ScreenFrame {map} label={t('welcome.eyebrow')}>
  <form onsubmit={submit}>
    <div class="eyebrow">{t('welcome.eyebrow')}</div>
    <p class="sub">{intro}</p>
    <div class="form">
      <label>
        {t('welcome.nick')}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={nick}
          autofocus
          required
          minlength="3"
          maxlength="16"
          name="username"
          autocomplete={mode === 'guest' ? 'nickname' : 'username'}
          spellcheck="false"
        />
      </label>
      {#if mode === 'login'}
        <label>
          {t('account.password')}
          <input
            type="password"
            name="password"
            bind:value={password}
            required
            maxlength="1024"
            autocomplete="current-password"
          />
        </label>
      {:else}
        <p class="hint">{t('welcome.nickHint')}</p>
        {#if mode === 'register'}
          <PasswordFields bind:password bind:repeat />
        {/if}
      {/if}
      {#if failure !== null}
        <p class="error" role="alert">{failureText(failure)}</p>
      {:else if notice !== null}
        <p class="error" role="alert">{t(notice)}</p>
      {/if}
    </div>
    <button type="submit" class="big sm" disabled={busy}>
      <UnitMark side="own" size={36} />
      {#if mode === 'login'}
        {t('welcome.login')}
      {:else if mode === 'register'}
        {t('welcome.register')}
      {:else}
        {invited ? t('welcome.join') : t('welcome.start')}
      {/if}
      <kbd class="k" aria-hidden="true">↵</kbd>
    </button>
    <div class="links">
      {#if mode !== 'guest'}
        <button
          type="button"
          onclick={() => {
            choose('guest');
          }}>{t('welcome.toGuest')}</button
        >
      {/if}
      {#if mode !== 'login'}
        <button
          type="button"
          onclick={() => {
            choose('login');
          }}>{t('welcome.toLogin')}</button
        >
      {/if}
      {#if mode !== 'register'}
        <button
          type="button"
          onclick={() => {
            choose('register');
          }}>{t('welcome.toRegister')}</button
        >
      {/if}
    </div>
    <div class="locale"><LocaleSelect /></div>
  </form>
</ScreenFrame>
