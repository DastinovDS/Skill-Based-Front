<script lang="ts">
  import { t, type MessageKey } from '../i18n/index.ts';
  import LocaleSelect from './LocaleSelect.svelte';

  interface Props {
    /** An invite link was opened: the nick form leads straight into that match. */
    invited: boolean;
    notice: MessageKey | null;
    onsubmit: (nick: string) => Promise<void>;
  }

  let { invited, notice, onsubmit }: Props = $props();

  let nick = $state('');
  let busy = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    try {
      await onsubmit(nick.trim());
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <form class="card" onsubmit={submit}>
    <h1>{t('app.title')}</h1>
    <p>{invited ? t('welcome.invited') : t('welcome.intro')}</p>
    <label>
      {t('welcome.nick')}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={nick}
        autofocus
        required
        minlength="3"
        maxlength="16"
        autocomplete="nickname"
        spellcheck="false"
      />
    </label>
    <p class="hint">{t('welcome.nickHint')}</p>
    {#if notice !== null}
      <p class="error" role="alert">{t(notice)}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>
        {invited ? t('welcome.join') : t('welcome.start')}
      </button>
    </div>
    <LocaleSelect />
  </form>
</main>
