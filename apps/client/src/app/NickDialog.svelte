<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n/index.ts';
  import Icon from '../hud/Icon.svelte';
  import LapisButton from '../theme/LapisButton.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';
  import { failureText, NICK_MAX, nickProblem, type AccountFailure } from './account.ts';

  interface Props {
    /** The nick now: the field starts with it. */
    nick: string;
    /** Asks the server (`PUT /api/me/nick`); the answer is why it failed, or null. */
    onsubmit: (nick: string) => Promise<AccountFailure | null>;
    onclose: () => void;
  }

  let { nick, onsubmit, onclose }: Props = $props();

  // The field starts with the nick of the moment the dialog opened.
  // svelte-ignore state_referenced_locally
  let typed = $state(nick);
  let busy = $state(false);
  let failure = $state.raw<AccountFailure | null>(null);
  let touched = $state(false);
  let field: HTMLInputElement | undefined = $state();

  // The overlay focuses its window when it opens; the field takes the focus right after.
  $effect(() => {
    const input = field;
    if (input === undefined) return;
    void tick().then(() => {
      input.focus();
      input.select();
    });
  });

  const problem = $derived(nickProblem(typed));
  const unchanged = $derived(typed === nick);
  const shown = $derived(
    failure !== null
      ? failureText(failure)
      : problem !== null && (touched || problem === 'welcome.error.chars')
        ? t(problem)
        : null,
  );

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    touched = true;
    if (busy || problem !== null || unchanged) return;
    busy = true;
    failure = await onsubmit(typed);
    busy = false;
    if (failure === null) onclose();
  }
</script>

<!-- The nick change (#871) on the blurred stone, like the password dialog of the mockup: the field
     on its incised line, the server's rules told inline (taken, not allowed, the daily limit). -->
<StoneOverlay label={t('profile.nick.change')} onclose={busy ? undefined : onclose}>
  <form class="nick-form" onsubmit={submit} novalidate>
    <p class="kicker">{t('account.eyebrow')}</p>
    <h2 class="dlg-h">{t('profile.nick.change')}</h2>
    <label class="field" class:bad={shown !== null}>
      <span class="label">{t('profile.nick.label')}</span>
      <span class="box">
        <input
          bind:this={field}
          bind:value={typed}
          oninput={() => {
            failure = null;
          }}
          onblur={() => {
            touched = true;
          }}
          name="nick"
          maxlength={NICK_MAX}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={shown !== null}
          aria-describedby="nick-dialog-msg"
        />
      </span>
      {#if shown !== null}
        <span class="wl" id="nick-dialog-msg" role="alert"
          ><Icon name="alert" size={16} /><span>{shown}</span></span
        >
      {:else}
        <span class="hint" id="nick-dialog-msg">{t('profile.nick.hint')}</span>
      {/if}
    </label>
    <div class="dlg-acts">
      <LapisButton variant="primary" type="submit" disabled={busy || unchanged}
        >{t('account.save')}</LapisButton
      >
      <button type="button" class="lnk" disabled={busy} onclick={onclose}
        >{t('group.cancel')}</button
      >
    </div>
  </form>
</StoneOverlay>

<style>
  .nick-form {
    display: grid;
    gap: 0;
    min-width: min(440px, 80vw);
  }

  .nick-form .field {
    margin-top: 18px;
  }

  .nick-form .wl {
    margin: 0;
  }
</style>
