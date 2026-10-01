<script lang="ts">
  import { getLocale, isLocale, LOCALES, setLocale, t, translate } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { Insets } from '../render/camera.ts';
  import EventLog from './EventLog.svelte';
  import OrdersPanel from './OrdersPanel.svelte';
  import SelectionPanel from './SelectionPanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import type { HudState } from './hudState.svelte.ts';

  interface Props {
    rendererFailed: boolean;
    /** Dev screen only: names of the maps it can show, and the selected one. */
    maps?: readonly string[];
    mapName?: string;
    /** Dev screen only: ids of the scenes (fixtures and the live demo), and the selected one. */
    scenes?: readonly string[];
    sceneId?: string;
    fps: number;
    /** The HUD numbers; replaced once per snapshot. */
    hud: HudState;
    /** Ordering with the mouse and keys; its selection is the HUD's. */
    orders: OrderController;
    onselectmap?: (name: string) => void;
    onselectscene?: (id: string) => void;
    onfit: () => void;
    /** The part of the screen the HUD covers, reported whenever it changes (for "fit map"). */
    oninsets?: (insets: Insets) => void;
  }

  let {
    rendererFailed,
    maps,
    mapName,
    scenes,
    sceneId,
    fps,
    hud,
    orders,
    onselectmap,
    onselectscene,
    onfit,
    oninsets,
  }: Props = $props();

  let panelOpen = $state(true);
  let root: HTMLElement | undefined = $state();
  let top: HTMLElement | undefined = $state();
  let dock: HTMLElement | undefined = $state();
  let reported: Insets | null = null;

  // "Fit map" must keep the map out of the status bar and the side panel: measure them, the
  // sizes depend on the language and on the window (the panel can also be collapsed).
  function measure(): void {
    if (root === undefined || top === undefined) {
      return;
    }
    const frame = root.getBoundingClientRect();
    const insets: Insets = {
      left:
        !panelOpen || dock === undefined
          ? 0
          : Math.ceil(dock.getBoundingClientRect().right - frame.left),
      top: Math.ceil(top.getBoundingClientRect().bottom - frame.top),
      right: 0,
      bottom: 0,
    };
    if (reported?.left !== insets.left || reported.top !== insets.top) {
      reported = insets;
      oninsets?.(insets);
    }
  }

  $effect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    // `bind:this` leaves null in `dock` once the panel is gone (the type does not say so).
    for (const element of [root, top, panelOpen ? dock : undefined]) {
      if (element !== undefined) {
        observer.observe(element);
      }
    }
    return () => {
      observer.disconnect();
    };
  });
</script>

<!-- The overlay lets pointer events through to the canvas; only panels catch them. -->
<div class="hud" bind:this={root}>
  <div class="top" bind:this={top}>
    <StatusBar
      data={hud.current}
      {panelOpen}
      ontogglepanel={() => {
        panelOpen = !panelOpen;
      }}
    />
  </div>
  {#if panelOpen}
    <aside class="dock" bind:this={dock}>
      <section class="section">
        <h1>{t('app.title')}</h1>
        {#if maps !== undefined}
          <div class="row">
            <label>
              {t('hud.map')}
              <select
                value={mapName}
                onchange={(event) => {
                  onselectmap?.(event.currentTarget.value);
                }}
              >
                {#each maps as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
            </label>
            <button type="button" class="fit" onclick={onfit}>{t('hud.fitMap')}</button>
          </div>
        {:else}
          <div class="row">
            <button type="button" class="fit" onclick={onfit}>{t('hud.fitMap')}</button>
          </div>
        {/if}
        {#if scenes !== undefined}
          <div class="row">
            <label>
              {t('hud.scene')}
              <select
                value={sceneId}
                onchange={(event) => {
                  onselectscene?.(event.currentTarget.value);
                }}
              >
                {#each scenes as id (id)}
                  <option value={id}>{id}</option>
                {/each}
              </select>
            </label>
          </div>
        {/if}
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
        <details>
          <summary>{t('hud.help')}</summary>
          <p class="hint">{t('hud.cameraHint')}</p>
          <p class="hint">{t('hud.ordersHint')}</p>
          <p class="hint">{t('hud.keysHint')}</p>
          <p class="hint">{t('hud.legend')}</p>
        </details>
        <p class="hint">{t('hud.fps')}: {Math.round(fps)}</p>
      </section>
      <div class="section"><SelectionPanel data={hud.current} /></div>
      <div class="section"><OrdersPanel data={hud.current} {orders} /></div>
      <div class="section"><EventLog data={hud.current} /></div>
    </aside>
  {/if}
  {#if rendererFailed}
    <section class="section error" role="alert">{t('error.renderer')}</section>
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
  }

  .top {
    align-self: stretch;
  }

  /* Only as tall as its content, and scrolls when the window is lower than that. */
  .dock {
    pointer-events: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
    max-width: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px;
    border-right: 1px solid #30363d;
    border-bottom: 1px solid #30363d;
    background: rgb(22 27 34 / 90%);
    color: #e6edf3;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid #30363d;
  }

  .section:last-child {
    border-bottom: none;
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

  summary {
    cursor: pointer;
    font-size: 13px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: #8b949e;
  }

  .error {
    pointer-events: auto;
    margin: 8px 16px;
    padding: 8px 12px;
    border: 1px solid #f85149;
    border-radius: 6px;
    background: rgb(22 27 34 / 90%);
    color: #e6edf3;
  }
</style>
