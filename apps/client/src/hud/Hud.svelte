<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { rejectMessageKey } from '../match/rejects.ts';
  import type { Insets } from '../render/camera.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import type { DevControls } from './devControls.ts';
  import AlertStack from './AlertStack.svelte';
  import EventLog from './EventLog.svelte';
  import ExitDialog from './ExitDialog.svelte';
  import HelpOverlay from './HelpOverlay.svelte';
  import type { HudState } from './hudState.svelte.ts';
  import KeyHints from './KeyHints.svelte';
  import MenuSheet from './MenuSheet.svelte';
  import OrdersPanel from './OrdersPanel.svelte';
  import type { HudPrefs } from './prefs.svelte.ts';
  import RadialMenu from './RadialMenu.svelte';
  import SelectionPanel from './SelectionPanel.svelte';
  import StartBanner from './StartBanner.svelte';
  import ToastStack from './ToastStack.svelte';
  import Tooltip from './Tooltip.svelte';
  import TopBar from './TopBar.svelte';

  interface Props {
    rendererFailed: boolean;
    /** The dev screen's pickers and frame rate; absent in a real match. */
    dev?: DevControls | undefined;
    /** The HUD numbers; replaced once per snapshot. */
    hud: HudState;
    /** Ordering with the mouse and keys; its selection is the HUD's. */
    orders: OrderController;
    /** Which overlay is open (menu, journal, help, exit dialog). */
    chrome: HudChrome;
    prefs: HudPrefs;
    /** Show the key-hint bar (the first matches only). */
    hints?: boolean;
    /** The pause of a private match; without it the button is not shown. */
    onpause?: () => void;
    onfit: () => void;
    /** The part of the screen the HUD covers, reported whenever it changes (for "fit map"). */
    oninsets?: (insets: Insets) => void;
  }

  let {
    rendererFailed,
    dev,
    hud,
    orders,
    chrome,
    prefs,
    hints = false,
    onpause,
    onfit,
    oninsets,
  }: Props = $props();

  let root: HTMLElement | undefined = $state();
  let top: HTMLElement | undefined = $state();
  let reported: Insets | null = null;

  const data = $derived(hud.current);
  const selected = $derived(data !== null && (data.group !== null || data.node !== null));

  // "Fit map" keeps the map out of the top bar: measure it, its height depends on the zoom of the
  // page and the window.
  function measure(): void {
    if (root === undefined || top === undefined) {
      return;
    }
    const frame = root.getBoundingClientRect();
    const insets: Insets = {
      left: 0,
      top: Math.ceil(top.getBoundingClientRect().bottom - frame.top),
      right: 0,
      bottom: 0,
    };
    if (reported?.top !== insets.top) {
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
    for (const element of [root, top]) {
      if (element !== undefined) {
        observer.observe(element);
      }
    }
    return () => {
      observer.disconnect();
    };
  });

  // A refused command is a toast (U6); the accepted ones show on the map.
  $effect(() => {
    return orders.ui.onFeedback((feedback) => {
      if (feedback.kind === 'accepted') return;
      const command = t(`cmd.${feedback.cmd.type}`);
      hud.toasts.push({
        tone: 'warn',
        icon: 'alert',
        text:
          feedback.kind === 'lost'
            ? t('orders.lost')
            : tf('orders.rejected', { command, reason: t(rejectMessageKey(feedback.code)) }),
      });
    });
  });
</script>

<!-- The overlay lets pointer events through to the canvas; only panels catch them. -->
<div class="hud" bind:this={root}>
  <div class="top" bind:this={top}>
    <TopBar {data} {orders} {chrome} {prefs} {onpause} />
  </div>
  <MenuSheet
    open={chrome.menuOpen}
    onclose={() => {
      chrome.menuOpen = false;
    }}
    {onfit}
    {dev}
  />
  <EventLog
    {data}
    open={chrome.journalOpen}
    onclose={() => {
      chrome.journalOpen = false;
    }}
  />
  <AlertStack alerts={hud.alerts} />
  <ToastStack toasts={hud.toasts} />
  <StartBanner {data} visible={hud.banner} />
  {#if data !== null && selected}
    <section class="card" aria-label={t('card.title')}>
      <SelectionPanel {data} tickHz={hud.context.rules.tick_hz} />
      <OrdersPanel {data} {orders} />
    </section>
  {/if}
  {#if hints}
    <KeyHints />
  {/if}
  <RadialMenu {orders} stance={data?.stance ?? null} passive={orders.passivePerMinute} />
  <Tooltip {data} ctx={hud.context} {orders} />
  <HelpOverlay
    open={chrome.helpOpen}
    onclose={() => {
      chrome.helpOpen = false;
    }}
  />
  <ExitDialog
    open={chrome.exitOpen}
    onforfeit={() => {
      chrome.exitOpen = false;
      orders.forfeit();
    }}
    onstay={() => {
      chrome.exitOpen = false;
    }}
  />
  {#if rendererFailed}
    <section class="error" role="alert">{t('error.renderer')}</section>
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

  /* The selection card appears only with a selection, bottom left (ui-style 10.3). */
  .card {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 3;
    pointer-events: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(340px, calc(100% - 24px));
    max-height: calc(100% - 72px);
    overflow-y: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
  }

  .error {
    pointer-events: auto;
    margin: 8px 16px;
    padding: 8px 12px;
    border: 1px solid var(--enemy);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
</style>
