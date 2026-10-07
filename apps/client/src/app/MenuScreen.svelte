<script lang="ts">
  import { tf, t, type MessageKey } from '../i18n/index.ts';
  import LocaleSelect from './LocaleSelect.svelte';

  interface Props {
    nick: string;
    notice: MessageKey | null;
    oncreate: () => void;
    onlobby: () => void;
    onbot: () => void;
    onchangenick: () => void;
  }

  let { nick, notice, oncreate, onlobby, onbot, onchangenick }: Props = $props();
</script>

<main class="screen">
  <div class="card">
    <h1>{t('app.title')}</h1>
    <p>{tf('menu.greeting', { nick })}</p>
    {#if notice !== null}
      <p class="error" role="alert">{t(notice)}</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={oncreate}>{t('menu.create')}</button>
      <button type="button" class="primary" onclick={onlobby}>{t('menu.lobby')}</button>
      <button type="button" class="primary" onclick={onbot}>{t('menu.bot')}</button>
    </div>
    <div class="actions">
      <button type="button" onclick={onchangenick}>{t('menu.changeNick')}</button>
    </div>
    <LocaleSelect />
  </div>
</main>
