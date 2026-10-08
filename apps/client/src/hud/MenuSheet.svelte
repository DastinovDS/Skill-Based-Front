<script lang="ts">
  import type { Snippet } from 'svelte';
  import LocaleSelect from '../app/LocaleSelect.svelte';
  import { t } from '../i18n/index.ts';
  import type { DevControls } from './devControls.ts';
  import Icon from './Icon.svelte';

  /** The key itself is not translated. */
  const HOME_KEY = 'Home';

  interface Props {
    open: boolean;
    onclose: () => void;
    onfit: () => void;
    dev?: DevControls | undefined;
    /** The place for the settings of package F (volume, interface scale, less motion). */
    settings?: Snippet;
  }

  let { open, onclose, onfit, dev, settings }: Props = $props();
</script>

{#if open}
  <aside class="sheet" aria-label={t('menu.title')}>
    <header>
      <h2>{t('menu.title')}</h2>
      <button type="button" class="close" aria-label={t('menu.close')} onclick={onclose}>
        <Icon name="x" />
      </button>
    </header>
    <button
      type="button"
      class="action"
      onclick={() => {
        onfit();
        onclose();
      }}
    >
      {t('hud.fitMap')} <kbd>{HOME_KEY}</kbd>
    </button>
    <LocaleSelect />
    <section class="settings" data-slot="settings" aria-label={t('menu.settings')}>
      {#if settings !== undefined}
        {@render settings()}
      {/if}
    </section>
    {#if dev !== undefined}
      <section class="dev" aria-label={t('menu.dev')}>
        <label>
          {t('hud.map')}
          <select
            value={dev.mapName}
            onchange={(event) => {
              dev.onselectmap(event.currentTarget.value);
            }}
          >
            {#each dev.maps as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </label>
        <label>
          {t('hud.scene')}
          <select
            value={dev.sceneId}
            onchange={(event) => {
              dev.onselectscene(event.currentTarget.value);
            }}
          >
            {#each dev.scenes as id (id)}
              <option value={id}>{id}</option>
            {/each}
          </select>
        </label>
        <p class="hint">{t('hud.fps')}: {Math.round(dev.fps)}</p>
      </section>
    {/if}
  </aside>
{/if}

<style>
  .sheet {
    position: absolute;
    top: 48px;
    left: 0;
    bottom: 0;
    z-index: 12;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(300px, 100%);
    overflow-y: auto;
    padding: 12px;
    border-right: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    pointer-events: auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  button,
  select {
    font: inherit;
    color: inherit;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  button:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    cursor: pointer;
  }

  .action {
    padding: 6px 10px;
    text-align: left;
    cursor: pointer;
  }

  kbd {
    float: right;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  select {
    padding: 4px 8px;
  }

  .dev {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
