<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import { failureText, passwordLengthOk, type AccountFailure } from './account.ts';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import PasswordFields from './PasswordFields.svelte';

  interface Props {
    /** The frame of the screens before a match: the rail, the corner chip, the map. */
    dock: DockContext;
    /** The account already has a password: the old one is asked, and this is a change. */
    hasPassword: boolean;
    /** Why it failed, or null: the new token is already saved by then. */
    onsubmit: (password: string, oldPassword: string) => Promise<AccountFailure | null>;
    onback: () => void;
  }

  let { dock, hasPassword, onsubmit, onback }: Props = $props();

  // The form is for one purpose: after a save only the message and "Back" remain.
  const changing = untrack(() => hasPassword);
  let oldPassword = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let saved = $state(false);
  let busy = $state(false);
  let form = $state<HTMLFormElement>();

  const KEY_BACK = 'Esc';

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
</script>

<DockFrame
  {dock}
  mode={null}
  pause={null}
  eyebrow={t('account.eyebrow')}
  head={changing ? t('account.changeTitle') : t('account.setTitle')}
  sub={saved ? null : changing ? t('account.changeIntro') : t('account.setIntro')}
  alert={failure === null ? null : failureText(failure)}
  onback={busy ? undefined : onback}
  onenter={saved ? onback : undefined}
>
  {#if saved}
    <p class="ok" role="status"><Icon name="check" size={18} /><span>{t('account.saved')}</span></p>
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
  {#snippet actions()}
    {#if saved}
      <button type="button" class="btn pri" aria-keyshortcuts="Enter Escape" onclick={onback}>
        {t('common.back')}<kbd class="k" aria-hidden="true">↵</kbd>
      </button>
    {:else}
      <button type="submit" form="password-form" class="btn pri" disabled={busy}>
        {t('account.save')}<kbd class="k" aria-hidden="true">↵</kbd>
      </button>
      <button type="button" class="btn link" aria-keyshortcuts="Escape" onclick={onback}>
        {t('common.back')}<kbd class="k" aria-hidden="true">{KEY_BACK}</kbd>
      </button>
    {/if}
  {/snippet}
</DockFrame>
