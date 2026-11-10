<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import SheetFrame from '../board/SheetFrame.svelte';
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { failureText, passwordLengthOk, type AccountFailure } from './account.ts';
  import PasswordFields from './PasswordFields.svelte';

  interface Props {
    nick: string;
    /** The account already has a password: the old one is asked, and this is a change. */
    hasPassword: boolean;
    map?: MapFile | null;
    /** Why it failed, or null: the new token is already saved by then. */
    onsubmit: (password: string, oldPassword: string) => Promise<AccountFailure | null>;
    onback: () => void;
    /** The bar: the nick opens the profile, the "?" How to play (#919). */
    onprofile?: () => void;
    onhowto?: () => void;
  }

  let {
    nick,
    hasPassword,
    map = null,
    onsubmit,
    onback,
    onprofile = () => undefined,
    onhowto = () => undefined,
  }: Props = $props();

  // The form is for one purpose: after a save only the message and "Back" remain.
  const changing = untrack(() => hasPassword);
  let oldPassword = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let saved = $state(false);
  let busy = $state(false);
  let form = $state<HTMLFormElement>();

  // The first field takes the focus, like the nick of the welcome screen: typing starts at once.
  onMount(() => {
    form?.querySelector('input')?.focus();
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!passwordLengthOk(password)) {
      failure = { key: 'error.account.passwordLength' };
      return;
    }
    if (password !== repeat) {
      failure = { key: 'error.account.mismatch' };
      return;
    }
    busy = true;
    try {
      failure = await onsubmit(password, oldPassword);
      saved = failure === null;
      if (saved) {
        oldPassword = '';
        password = '';
        repeat = '';
      }
    } finally {
      busy = false;
    }
  }

  // Esc goes back (not while a save is on its way); Enter after a save goes back too.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onback();
      return;
    }
    const target = event.target;
    const onControl = target instanceof Element && target.closest('input, button, a') !== null;
    if (event.key === 'Enter' && saved && !onControl) {
      event.preventDefault();
      onback();
    }
  }
</script>

<svelte:window {onkeydown} />

<!-- Set or change the password (#374): a framed stone panel on the sheet of the pages (#919). -->
<SheetFrame
  {map}
  label={t('account.eyebrow')}
  player={{ nick, guest: !hasPassword, onprofile }}
  onhelp={onhowto}
>
  <section class="pw rule-frame stone-panel">
    <p class="kicker">{t('account.eyebrow')}</p>
    <h2>{changing ? t('account.changeTitle') : t('account.setTitle')}</h2>
    {#if !saved}
      <p class="sub">{changing ? t('account.changeIntro') : t('account.setIntro')}</p>
    {/if}
    {#if saved}
      <p class="ok" role="status">
        <Icon name="check" size={18} /><span>{t('account.saved')}</span>
      </p>
    {:else}
      <form id="password-form" class="fields" bind:this={form} onsubmit={submit}>
        {#if changing}
          <label>
            {t('account.passwordOld')}
            <input
              type="password"
              name="current-password"
              bind:value={oldPassword}
              required
              maxlength="1024"
              autocomplete="current-password"
            />
          </label>
        {/if}
        <PasswordFields bind:password bind:repeat />
      </form>
    {/if}
    {#if failure !== null}
      <p class="wl" role="alert">
        <Icon name="alert" size={16} /><span>{failureText(failure)}</span>
      </p>
    {/if}
    <div class="acts">
      {#if saved}
        <LapisButton variant="primary" aria-keyshortcuts="Enter Escape" onclick={onback}
          >{t('common.back')}</LapisButton
        >
      {:else}
        <LapisButton variant="primary" type="submit" form="password-form" disabled={busy}
          >{t('account.save')}</LapisButton
        >
        <button type="button" class="lnk" aria-keyshortcuts="Escape" onclick={onback}>
          {t('common.back')}
        </button>
      {/if}
    </div>
  </section>
</SheetFrame>

<style>
  .pw {
    box-sizing: border-box;
    width: min(620px, 100%);
    margin: 12px auto 0;
    padding: 38px 46px 36px;
  }

  h2 {
    margin: 6px 0 0;
    font: 400 32px / 1.15 var(--font-display);
    letter-spacing: 0.1em;
  }

  .fields {
    display: grid;
    gap: 18px;
    width: min(440px, 100%);
    margin-top: 22px;
  }

  .fields :global(label) {
    display: grid;
    gap: 6px;
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .fields :global(input) {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 0 10px;
    border: 0;
    border-bottom: 1px solid var(--cut);
    border-radius: 0;
    box-shadow: 0 1px 0 var(--line);
    background: none;
    color: var(--ink);
    font: 400 20px / 1.2 var(--font-text);
    letter-spacing: 0.02em;
    text-transform: none;
  }

  .fields :global(input:focus-visible) {
    outline: none;
    border-bottom-color: var(--ink);
    box-shadow: 0 1px 0 var(--ink);
  }

  .fields :global(.hint) {
    margin: 0;
    font: italic 400 15px / 1.3 var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }

  .ok {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0 0;
    font-size: 18px;
  }

  .acts {
    margin-top: 26px;
  }
</style>
