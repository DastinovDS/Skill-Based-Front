<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { DevControls } from './devControls.ts';

  interface Props {
    dev: DevControls;
  }

  let { dev }: Props = $props();
</script>

<!-- Only on the dev screen: the map and scene pickers and the frame rate. -->
<aside class="dev" aria-label={t('menu.dev')}>
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
</aside>

<style>
  .dev {
    position: absolute;
    top: 56px;
    left: 8px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    pointer-events: auto;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  select {
    font: inherit;
    color: inherit;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .hint {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
