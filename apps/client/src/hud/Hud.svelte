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
  import RadialMenu from './RadialMenu.svelte';
  import SelectionCard from './SelectionCard.svelte';
  import SplitMenu from './SplitMenu.svelte';
  import StackRadial from './StackRadial.svelte';
  import StartBanner from './StartBanner.svelte';
  import ToastStack from './ToastStack.svelte';
  import GroupTip from './GroupTip.svelte';
  import TerrainBanner from './TerrainBanner.svelte';
  import SplitTip from './SplitTip.svelte';
  import type { PlayerColour } from '../protocol.gen.ts';
  import StatusBar from '../app/StatusBar.svelte';
  import StatusButton from '../app/StatusButton.svelte';
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
    /** The player's colour in this match (DEC-49): the start banner names it. */
    colour?: PlayerColour | null;
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
    colour = null,
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

  // A refused command is a toast (U6); the accepted ones show on the map.
  $effect(() => {
    return orders.ui.onFeedback((feedback) => {
      if (feedback.kind === 'accepted') return;
      if (feedback.kind === 'split') {
        // DEC-48, item B4 (#913): the server split a group too big for the road; its part went.
        hud.toasts.push({
          tone: 'neutral',
          icon: 'info',
          text: tf('orders.split', { units: feedback.units, of: feedback.of }),
        });
        return;
      }
      const command = t(`cmd.${feedback.cmd.type}`);
      const reason = (code: string): string =>
        t(
          rejectMessageKey(
            code,
            feedback.cmd.type,
            hud.context.rules.combat.retreat,
            (feedback.cmd.type === 'move' || feedback.cmd.type === 'group_move') &&
              feedback.cmd.planned,
          ),
        );
      hud.toasts.push({
        tone: 'warn',
        icon: 'alert',
        text:
          feedback.kind === 'lost'
            ? t('orders.lost')
            : feedback.kind === 'dropped'
              ? // DEC-48, item B3: the groups a group order went without, by their code.
                tf('orders.dropped', { count: feedback.count, reason: reason(feedback.code) })
              : tf('orders.rejected', { command, reason: reason(feedback.code) }),
      });
    });
  });
</script>

<!-- The overlay lets pointer events through to the canvas; only panels catch them. -->
<div class="hud" bind:this={root} data-selection={selection}>
  <div class="top" bind:this={top}>
    <TopBar {data} {orders} {chrome} {onpause} {anchors} names={hud.nodeName} />
  </div>
  {#if dev !== undefined}
    <DevPanel {dev} />
  {/if}
  <EdgeAlerts threats={hud.threats} {anchors} top={topInset} />
  <AlertStack alerts={hud.alerts} names={hud.nodeName} />
  <ToastStack toasts={hud.toasts} />
  <StartBanner {data} visible={hud.banner} {colour} />
  <RadialMenu {orders} stance={data?.stance ?? null} />
  <SplitMenu {orders} {anchors} names={hud.nodeName} />
  <CityRadial
    {orders}
    {anchors}
    names={hud.nodeName}
    queue={data?.node?.recruitQueue ?? null}
    city={data?.node ?? null}
  />
  <GroupRadial {orders} {anchors} group={data?.group ?? null} {mergeable} />
  <SelectionCard {orders} groups={data?.groups ?? []} />
  <StackRadial {orders} {anchors} names={hud.nodeName} />
  <GroupTip group={data?.hovered ?? null} />
  <TerrainBanner {orders} />
  <SplitTip {orders} names={hud.nodeName} />
  <HelpOverlay
    open={chrome.helpOpen}
    captureCost={hud.context.rules.capture.charge_cost}
    groupOrder={hud.context.rules.group_order !== null}
    rallyPoint={hud.context.rules.recruit.rally_point}
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
    <div class="renderer">
      <StatusBar tone="alert" icon="alert" title={t('error.renderer')} role="alert">
        {#snippet actions()}
          {#if onreload !== undefined}
            <StatusButton primary onclick={onreload}>{t('match.reload')}</StatusButton>
          {/if}
        {/snippet}
      </StatusBar>
    </div>
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

  /* Bottom centre like the match status bar, which stands above it when both show. */
  .renderer {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    justify-content: center;
    width: max-content;
    max-width: calc(100% - 32px);
  }
</style>
