<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../i18n/index.ts';
  import { failureText, passwordLengthOk, type AccountFailure } from './account.ts';
  import PasswordFields from './PasswordFields.svelte';

  interface Props {
    /** The account already has a password: the old one is asked, and this is a change. */
    hasPassword: boolean;
    /** Why it failed, or null: the new token is already saved by then. */
    onsubmit: (password: string, oldPassword: string) => Promise<AccountFailure | null>;
    onback: () => void;
  }

  let { hasPassword, onsubmit, onback }: Props = $props();

  // The form is for one purpose: after a save only the message and "Back" remain.
  const changing = untrack(() => hasPassword);
  let oldPassword = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let saved = $state(false);
  let busy = $state(false);

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
</script>

<main class="screen">
  <form class="card" onsubmit={submit}>
    <h2>{changing ? t('account.changeTitle') : t('account.setTitle')}</h2>
    {#if saved}
      <p role="status">{t('account.saved')}</p>
    {:else}
      <p>{changing ? t('account.changeIntro') : t('account.setIntro')}</p>
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
      {#if failure !== null}
        <p class="error" role="alert">{failureText(failure)}</p>
      {/if}
    {/if}
    <div class="actions">
      {#if !saved}
        <button type="submit" class="primary" disabled={busy}>{t('account.save')}</button>
      {/if}
      <button type="button" onclick={onback}>{t('common.back')}</button>
    </div>
  </form>
</main>
