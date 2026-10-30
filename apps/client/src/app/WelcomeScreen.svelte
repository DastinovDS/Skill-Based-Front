<script lang="ts">
  import Icon from '../hud/Icon.svelte';
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
    /** The map drawn behind the form, blurred (null: the plain dark page). */
    map?: MapFile | null;
    /** Play as a guest: a nick and nothing else. */
    onsubmit: (nick: string) => Promise<void>;
    /** Log in to an account (#374); why it failed, or null. */
    onlogin: (nick: string, password: string) => Promise<AccountFailure | null>;
    /** A new account: nick and password in one go (#374); why it failed, or null. */
    onregister: (nick: string, password: string) => Promise<AccountFailure | null>;
  }

  let { invited, notice, map = null, onsubmit, onlogin, onregister }: Props = $props();

  /** The nick rule of the server (3 to 16 characters: letters, digits, _ and -), told inline. */
  const NICK_MIN = 3;
  const NICK_CHARS = /^[\p{L}\p{N}_-]*$/u;

  /** The server's refusals of a nick, said shortly on this screen (#629). */
  const NOTICES: Partial<Record<MessageKey, MessageKey>> = {
    'error.api.conflict': 'welcome.error.taken',
    'error.api.invalid': 'welcome.error.invalid',
  };

  let mode = $state<Mode>('guest');
  let nick = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let busy = $state(false);
  /** The field was left or submitted once: a short nick is told only then, not while typing. */
  let touched = $state(false);

  const typed = $derived(nick.trim());
  const nickError = $derived<MessageKey | null>(
    !NICK_CHARS.test(typed)
      ? 'welcome.error.chars'
      : typed.length > 0 && typed.length < NICK_MIN
        ? 'welcome.error.short'
        : null,
  );
  // A guest nick is checked here first; login and registration ask the server as they did.
  const blocked = $derived(mode === 'guest' && (typed.length < NICK_MIN || nickError !== null));
  const shownError = $derived<string | null>(
    failure !== null
      ? failureText(failure)
      : mode === 'guest' && nickError !== null && (touched || nickError === 'welcome.error.chars')
        ? t(nickError)
        : notice !== null
          ? t(NOTICES[notice] ?? notice)
          : null,
  );

  function choose(next: Mode): void {
    mode = next;
    password = '';
    repeat = '';
    failure = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    touched = true;
    failure = null;
    if (blocked) return;
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
      if (mode === 'guest') await onsubmit(typed);
      else if (mode === 'login') failure = await onlogin(typed, password);
      else failure = await onregister(typed, password);
    } finally {
      busy = false;
    }
  }

  const cta = $derived(
    mode === 'login'
      ? t('welcome.login')
      : mode === 'register'
        ? t('welcome.register')
        : invited
          ? t('welcome.join')
          : t('welcome.start'),
  );
</script>

<!-- The entry screen (#629, N5 "Title"): the game's title, the nick field under it, the map
     blurred behind. The rule of the nick shows only as an inline error. -->
<ScreenFrame {map} label={t('app.title')} entry>
  <form class="title" class:wide={mode !== 'guest'} onsubmit={submit}>
    <div class="pair" aria-hidden="true">
      <UnitMark side="own" size={54} />
      <UnitMark side="enemy" size={54} />
    </div>
    <h1>{t('app.title')}</h1>
    {#if invited}
      <p class="chip inv"><Icon name="link" size={14} />{t('welcome.invitedChip')}</p>
    {/if}
    <div class="line">
      <label class="nick">
        <span class="sr">{t('welcome.nick')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={nick}
          class:err={shownError !== null}
          autofocus
          required
          maxlength="16"
          name="username"
          placeholder={t('welcome.nickPlaceholder')}
          autocomplete={mode === 'guest' ? 'nickname' : 'username'}
          spellcheck="false"
          aria-invalid={shownError !== null}
          aria-describedby={shownError === null ? undefined : 'welcome-error'}
          onblur={() => {
            if (typed.length > 0) touched = true;
          }}
        />
      </label>
      {#if mode === 'guest'}
        <button type="submit" class="go" disabled={busy || blocked}>{cta}</button>
      {/if}
    </div>
    {#if mode === 'login'}
      <label class="pw">
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
    {:else if mode === 'register'}
      <div class="pw"><PasswordFields bind:password bind:repeat /></div>
    {/if}
    {#if shownError !== null}
      <p class="err" id="welcome-error" role="alert">
        <Icon name="alert" size={15} />{shownError}
      </p>
    {/if}
    {#if mode !== 'guest'}
      <button type="submit" class="go" disabled={busy}>{cta}</button>
    {/if}
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

<style>
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(460px, 100%);
    margin: 0 auto;
    text-align: center;
  }

  .pair {
    display: flex;
    gap: 16px;
  }

  h1 {
    margin: 12px 0 36px;
    font-size: 56px;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }

  .inv {
    gap: 6px;
    height: 26px;
    margin: -18px 0 14px;
    border-color: var(--you);
    color: var(--text);
    font-size: 13px;
  }

  .line {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  .nick {
    flex: 1;
    min-width: 0;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    height: 52px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-bottom: 2px solid var(--you);
    border-radius: 0;
    background: #111a27;
    color: var(--text);
    font: inherit;
    font-size: 20px;
  }

  input::placeholder {
    color: var(--neutral);
  }

  input.err {
    border-bottom-color: var(--warn);
  }

  input:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .go {
    flex: none;
    height: 52px;
    padding: 0 22px;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--you);
    color: var(--bg);
    font: inherit;
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
  }

  .go:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .wide .go {
    align-self: stretch;
    margin-top: 14px;
  }

  .pw {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-top: 12px;
    color: var(--text-dim);
    font-size: 14px;
    text-align: left;
  }

  .pw :global(label) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .pw :global(.hint) {
    margin: 0;
    font-size: 13px;
  }

  .err {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 0;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgb(13 17 23 / 90%);
    color: var(--warn);
    font-size: 14px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 18px;
    margin-top: 22px;
  }

  .links button {
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 15px;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .links button:hover {
    color: var(--paper);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
