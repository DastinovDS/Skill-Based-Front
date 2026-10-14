<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { rejectMessageKey } from '../match/rejects.ts';
  import { NO_ANCHORS, type MapAnchors } from '../render/anchors.ts';
  import type { Insets } from '../render/camera.ts';
  import type { HudChrome } from './chrome.svelte.ts';
  import type { DevControls } from './devControls.ts';
  import AlertStack from './AlertStack.svelte';
  import CityRadial from './CityRadial.svelte';
  import DevPanel from './DevPanel.svelte';
  import EdgeAlerts from './EdgeAlerts.svelte';
  import ExitDialog from './ExitDialog.svelte';
  import GroupRadial from './GroupRadial.svelte';
  import HelpOverlay from './HelpOverlay.svelte';
  import type { HudState } from './hudState.svelte.ts';
  import KeyHints from './KeyHints.svelte';
  import OrderHint from './OrderHint.svelte';
  import type { HudPrefs } from './prefs.svelte.ts';
  import RadialMenu from './RadialMenu.svelte';
  import RoadTypeMenu from './RoadTypeMenu.svelte';
  import SplitMenu from './SplitMenu.svelte';
  import StartBanner from './StartBanner.svelte';
  import SupplyBanner from './SupplyBanner.svelte';
  import SupplyMenu from './SupplyMenu.svelte';
  import TransferDialog from './TransferDialog.svelte';
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
    /** Which overlay is open (help, exit dialog). */
    chrome: HudChrome;
    prefs: HudPrefs;
    /** Show the key-hint bar (the first matches only). */
    hints?: boolean;
    /** Where cities and groups are on screen: the radial menus of a city and a group sit on them. */
    anchors?: MapAnchors;
    /** The pause of a private match; without it the button is not shown. */
    onpause?: () => void;
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
    anchors = NO_ANCHORS,
    onpause,
    oninsets,
  }: Props = $props();

  let root: HTMLElement | undefined = $state();
  let top: HTMLElement | undefined = $state();
  let reported: Insets | null = null;
  // The height of the top bar: the arcs at the screen edge keep below it.
  let topInset = $state(48);

  const data = $derived(hud.current);
  // What is selected, as a plain attribute (end-to-end tests wait for it).
  const selection = $derived(
    data?.group != null
      ? `group:${data.group.id}`
      : data?.node != null
        ? `node:${String(data.node.id)}`
        : 'none',
  );
  const mergeable = $derived(data === null ? 0 : orders.mergeCandidates().length);
  const building = $derived(
    data?.node?.owner === 'mine' ? (data.node.build?.secondsLeft ?? null) : null,
  );

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
      topInset = insets.top;
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

  // A refused command is a toast (U6); the accepted ones show on the map, except a transfer: its
  // arrival is the server's answer (DEC-18), told in a toast.
  $effect(() => {
    return orders.ui.onFeedback((feedback) => {
      if (feedback.kind === 'accepted') {
        const { cmd, arriveTick } = feedback;
        const now = hud.current?.tick;
        if (cmd.type === 'transfer' && arriveTick != null && now !== undefined) {
          hud.toasts.push({
            tone: 'mine',
            icon: 'road',
            text: tf('transfer.accepted', {
              n: cmd.n,
              node: cmd.to_node,
              seconds: Math.ceil(Math.max(0, arriveTick - now) / hud.context.rules.tick_hz),
            }),
          });
        }
        return;
      }
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
<div class="hud" bind:this={root} data-selection={selection}>
  <div class="top" bind:this={top}>
    <TopBar {data} {orders} {chrome} {prefs} {onpause} />
  </div>
  {#if dev !== undefined}
    <DevPanel {dev} />
  {/if}
  <EdgeAlerts threats={hud.threats} {anchors} top={topInset} />
  <AlertStack alerts={hud.alerts} />
  <ToastStack toasts={hud.toasts} />
  <StartBanner {data} visible={hud.banner} />
  <OrderHint {data} {orders} />
  {#if hints}
    <KeyHints />
  {/if}
  <RadialMenu {orders} stance={data?.stance ?? null} />
  <RoadTypeMenu {orders} />
  <SupplyBanner {orders} />
  <SupplyMenu {orders} />
  <TransferDialog {orders} />
  <SplitMenu {orders} {anchors} />
  <CityRadial {orders} {anchors} {building} />
  <GroupRadial {orders} {anchors} group={data?.group ?? null} {mergeable} />
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
