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
  import RadialMenu from './RadialMenu.svelte';
  import SplitMenu from './SplitMenu.svelte';
  import StackRadial from './StackRadial.svelte';
  import StartBanner from './StartBanner.svelte';
  import SupplyBanner from './SupplyBanner.svelte';
  import SupplyMenu from './SupplyMenu.svelte';
  import TransferDialog from './TransferDialog.svelte';
  import ToastStack from './ToastStack.svelte';
  import GroupTip from './GroupTip.svelte';
  import RoadBanner from './RoadBanner.svelte';
  import TerrainBanner from './TerrainBanner.svelte';
  import SplitTip from './SplitTip.svelte';
  import RoadTip from './RoadTip.svelte';
  import TopBar from './TopBar.svelte';

  interface Props {
    rendererFailed: boolean;
    /** Reloads the page: offered next to the failed-renderer notice. */
    onreload?: (() => void) | undefined;
    /** The dev screen's pickers and frame rate; absent in a real match. */
    dev?: DevControls | undefined;
    /** The HUD numbers; replaced once per snapshot. */
    hud: HudState;
    /** Ordering with the mouse and keys; its selection is the HUD's. */
    orders: OrderController;
    /** Which overlay is open (help, exit dialog). */
    chrome: HudChrome;
    /** A ranked match (DEC-34): leaving it warns about the queue lock. */
    rated?: boolean;
    /** Queue lock in seconds a forfeit would bring now (DEC-34); shown in the ranked forfeit dialog. */
    forfeitBanS?: number;
    /** Show the key-hint bar (the first matches only). */
    hints?: boolean;
    /** Where cities and groups are on screen: the radial menus of a city and a group sit on them. */
    anchors?: MapAnchors;
    /** The pause of a private match; without it (none left, or a rated match) the button is not shown. */
    onpause?: () => void;
    /** The part of the screen the HUD covers, reported whenever it changes (for "fit map"). */
    oninsets?: (insets: Insets) => void;
  }

  let {
    rendererFailed,
    onreload,
    dev,
    hud,
    orders,
    chrome,
    rated = false,
    forfeitBanS = 0,
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
  // The own road a click would raise, under the pointer (DEC-28, item 7).
  const roadHover = $derived.by(() => {
    const id = orders.ui.current.roadHover;
    return id === null ? null : (data?.roads[id] ?? null);
  });
  const mergeable = $derived(data === null ? 0 : orders.mergeCandidates().length);

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
              node: hud.nodeName(cmd.to_node),
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
    <TopBar {data} {orders} {chrome} {onpause} />
  </div>
  {#if dev !== undefined}
    <DevPanel {dev} />
  {/if}
  <EdgeAlerts threats={hud.threats} {anchors} top={topInset} />
  <AlertStack alerts={hud.alerts} names={hud.nodeName} />
  <ToastStack toasts={hud.toasts} />
  <StartBanner {data} visible={hud.banner} />
  {#if hints}
    <KeyHints />
  {/if}
  <RadialMenu {orders} stance={data?.stance ?? null} />
  <SupplyBanner {orders} names={hud.nodeName} />
  <SupplyMenu {orders} names={hud.nodeName} />
  <TransferDialog {orders} names={hud.nodeName} />
  <SplitMenu {orders} {anchors} />
  <CityRadial
    {orders}
    {anchors}
    names={hud.nodeName}
    queue={data?.node?.recruitQueue ?? null}
    city={data?.node ?? null}
  />
  <GroupRadial {orders} {anchors} group={data?.group ?? null} {mergeable} />
  <StackRadial {orders} {anchors} names={hud.nodeName} />
  <GroupTip group={data?.hovered ?? null} rules={hud.context.rules} />
  <RoadBanner {orders} />
  <TerrainBanner {orders} />
  <RoadTip {orders} road={roadHover} />
  <SplitTip {orders} names={hud.nodeName} />
  <HelpOverlay
    open={chrome.helpOpen}
    onclose={() => {
      chrome.helpOpen = false;
    }}
  />
  <ExitDialog
    open={chrome.exitOpen}
    {rated}
    banSeconds={forfeitBanS}
    onforfeit={() => {
      chrome.exitOpen = false;
      orders.forfeit();
    }}
    onstay={() => {
      chrome.exitOpen = false;
    }}
  />
  {#if rendererFailed}
    <section class="error" role="alert">
      {t('error.renderer')}
      {#if onreload !== undefined}
        <button type="button" onclick={onreload}>{t('match.reload')}</button>
      {/if}
    </section>
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
