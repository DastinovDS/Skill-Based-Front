<script lang="ts">
  import { getLocale, isLocale, LOCALES, setLocale, t, translate } from '../i18n/index.ts';

  interface Props {
    rendererFailed: boolean;
    /** Names of the maps the dev screen can show. */
    maps: readonly string[];
    mapName: string;
    fps: number;
    onselectmap: (name: string) => void;
    onfit: () => void;
  }

  let { rendererFailed, maps, mapName, fps, onselectmap, onfit }: Props = $props();
</script>

<!-- The overlay lets pointer events through to the canvas; only panels catch them. -->
<div class="hud">
  <section class="panel">
    <h1>{t('app.title')}</h1>
    <div class="row">
      <label>
        {t('hud.map')}
        <select
          value={mapName}
          onchange={(event) => {
            onselectmap(event.currentTarget.value);
          }}
        >
          {#each maps as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>
      <button type="button" onclick={onfit}>{t('hud.fitMap')}</button>
    </div>
    <div class="row">
      <label>
        {t('hud.language')}
        <select
          value={getLocale()}
          onchange={(event) => {
            const next = event.currentTarget.value;
            if (isLocale(next)) {
              setLocale(next);
            }
          }}
        >
          {#each LOCALES as locale (locale)}
            <!-- Each language is named in itself, so a viewer finds theirs in any UI language. -->
            <option value={locale} lang={locale}>{translate(locale, 'language.self')}</option>
          {/each}
        </select>
      </label>
    </div>
    <p class="hint">{t('hud.cameraHint')}</p>
    <p class="hint">{t('hud.legend')}</p>
    <p class="hint">{t('hud.fps')}: {Math.round(fps)}</p>
  </section>
  {#if rendererFailed}
    <section class="panel error" role="alert">{t('error.renderer')}</section>
  {/if}
</div>

<style>
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 16px;
  }

  .panel {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 320px;
    padding: 8px 12px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: rgb(22 27 34 / 85%);
    color: #e6edf3;
  }

  h1 {
    margin: 0;
    font-size: 16px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  select,
  button {
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 8px;
  }

  button {
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: #8b949e;
  }

  .error {
    border-color: #f85149;
  }
</style>
