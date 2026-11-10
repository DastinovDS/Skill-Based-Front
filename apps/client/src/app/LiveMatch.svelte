<script lang="ts">
  import { MatchAudio } from '../audio/matchAudio.ts';
  import { sound } from '../audio/soundState.svelte.ts';
  import { HudChrome } from '../hud/chrome.svelte.ts';
  import Hud from '../hud/Hud.svelte';
  import { routeKey } from '../hud/hudKeys.ts';
  import { HudState } from '../hud/hudState.svelte.ts';
  import { forwardKey } from '../match/keyEvents.ts';
  import { OrderController } from '../match/orderController.ts';
  import { PauseState } from '../match/pauseState.svelte.ts';
  import { MatchSession } from '../match/session.ts';
  import { resultDelayMs } from '../match/resultDelay.ts';
  import type { GeoFile } from '../map/geography.ts';
  import type { ConnectionStatus } from '../net/matchConnection.ts';
  import type {
    MapFile,
    MatchEndMsg,
    PausedMsg,
    PlayerId,
    RulesetPublic,
    ServerMsg,
  } from '../protocol.gen.ts';
  import { forfeitCountsTowardBan } from '../match/forfeitBan.ts';
  import type { Anchor } from '../render/anchors.ts';
  import { NO_INSETS, type Insets } from '../render/camera.ts';
  import GameCanvas from '../render/GameCanvas.svelte';
  import type { ColourIds } from '../render/style.ts';
  import { colourVar } from '../theme/tokens.ts';
  import type { MatchSummary } from './matchSummary.ts';
  import MatchLoading from './MatchLoading.svelte';
  import MatchStatus from './MatchStatus.svelte';
  import { statusKeyAction, statusView, type StatusAction } from './matchStatus.ts';

  interface Props {
    matchId: string;
    token: string;
    map: MapFile;
    /** The server's baked background of the map (`MapSummary.background_url`), if it has one. */
    backgroundUrl?: string | null;
    /** The vector file of the map (DEC-36), if the map has one: the areas of the territory. */
    geo?: GeoFile | null;
    /** The server said the match is over. */
    onend: (me: PlayerId, end: MatchEndMsg, summary: MatchSummary | null) => void;
    onexit: () => void;
    /** Reloads the page after a protocol version mismatch (a test replaces it). */
    onreload?: () => void;
  }

  let {
    matchId,
    token,
    map,
    backgroundUrl = null,
    geo = null,
    onend,
    onexit,
    onreload = () => {
      window.location.reload();
    },
  }: Props = $props();

  // `welcome` brings the ruleset and the side, so the HUD exists only after it.
  let hud = $state.raw<HudState | null>(null);
  let rules = $state.raw<RulesetPublic | null>(null);
  let me = $state<PlayerId>(0);
  // Both players' colours by player id (DEC-49), from `welcome` (the same again on a reconnect).
  let colours = $state.raw<ColourIds | null>(null);
  // A forfeit counts toward the queue ban (DEC-34: a ranked or calibration match, also when only the
  // opponent is rated): leaving it warns about the queue lock.
  let rated = $state(false);
  let forfeitBanS = $state(0);
  let session = $state.raw<MatchSession | null>(null);
  let status = $state<ConnectionStatus>('connecting');
  let paused = $state.raw<PausedMsg | null>(null);
  const pauseState = new PauseState();
  let rendererFailed = $state(false);
  let canvas:
    | {
        fitMap: () => void;
        setInsets: (insets: Insets) => void;
        focusNode: (node: number) => void;
        nodeAnchor: (node: number) => Anchor | null;
        groupAnchor: (group: string) => Anchor | null;
      }
    | undefined = $state.raw();
  let insets: Insets = $state.raw(NO_INSETS);
  let pauseLeft = $state(0);
  const chrome = new HudChrome();

  // The result screen after a capital capture waits for its flood (#819).
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => {
    clearTimeout(endTimer);
  });

  function handle(msg: ServerMsg): void {
    pauseState.onMessage(msg, me);
    if (msg.type === 'paused') {
      paused = msg.paused ? msg : null;
      pauseLeft = msg.ends_in_s ?? 0;
    } else if (msg.type === 'match_end') {
      // The capture of a capital is seen before the result screen (#819); other ends go at once.
      const nicks = hud?.summary() ?? null;
      const summary = nicks === null || colours === null ? nicks : { ...nicks, colours };
      const player = me;
      const wait = resultDelayMs(msg);
      if (wait <= 0) onend(player, msg, summary);
      else {
        clearTimeout(endTimer);
        endTimer = setTimeout(() => {
          endTimer = undefined;
          onend(player, msg, summary);
        }, wait);
      }
    } else if (msg.type === 'reach') {
      orders?.onReach(msg);
    }
  }

  $effect(() => {
    const current = new MatchSession({
      matchId,
      token,
      context: (welcome) => {
        const state = new HudState({
          me: welcome.player,
          nicks: welcome.nicks,
          rules: welcome.ruleset_public,
          map,
        });
        me = welcome.player;
        colours = welcome.colours;
        rated = forfeitCountsTowardBan(welcome);
        forfeitBanS = welcome.forfeit_ban_s;
        rules = welcome.ruleset_public;
        hud = state;
        return {
          hud: state,
          tickHz: welcome.ruleset_public.tick_hz,
          // A plan has no delay, it gathers its bonus instead (DEC-41, item 10).
          orders: welcome.ruleset_public.orders,
          capacity: welcome.ruleset_public.capacity,
          roundTicks: welcome.ruleset_public.combat.round_ticks,
          recruitTicks: welcome.ruleset_public.recruit.unit_ticks,
          recruitQueueMax: welcome.ruleset_public.recruit.queue_max,
          rallyCost: welcome.ruleset_public.recruit.rally_point
            ? welcome.ruleset_public.recruit.rally_cost
            : 0,
          provinceWarehouse: welcome.ruleset_public.city_upgrades.warehouse_province,
          fortBuildTicks: welcome.ruleset_public.fort.build_ticks,
          audio: new MatchAudio({
            me: welcome.player,
            play: (id) => {
              sound.play(id);
            },
          }),
          cityUpgrades: {
            barracks: welcome.ruleset_public.city_upgrades.barracks_ticks,
            barracksCharges: welcome.ruleset_public.city_upgrades.barracks_charges,
            factory: welcome.ruleset_public.factory.build_ticks,
            factoryCharges: welcome.ruleset_public.factory.cost,
          },
        };
      },
      onStatus: (next) => {
        status = next;
      },
      onServerMessage: handle,
    });
    session = current;
    current.start();
    return () => {
      current.stop();
      session = null;
      drawn = false;
      hud?.destroy();
      hud = null;
      chrome.closeAll();
    };
  });

  $effect(() => {
    canvas?.setInsets(insets);
  });

  // Counts the pause down between server messages (the server sends whole seconds once).
  $effect(() => {
    if (paused === null) {
      return undefined;
    }
    const timer = setInterval(() => {
      pauseLeft = Math.max(0, pauseLeft - 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  });

  const orders = $derived.by(() => {
    const live = session;
    if (live === null || hud === null || rules === null) {
      return null;
    }
    return new OrderController({
      hud,
      map,
      rules,
      book: live.orders,
      send: (cmd) => live.send(cmd),
      alerts: hud.alerts,
      focusNode: (node) => canvas?.focusNode(node),
      queryReach: (group) => {
        live.queryReach(group);
      },
    });
  });

  $effect(() => {
    const current = orders;
    return () => {
      current?.destroy();
    };
  });

  function doStatusAction(action: StatusAction): void {
    if (action === 'retry') session?.retry();
    else if (action === 'reload') onreload();
    else if (action === 'resume') session?.resume();
    else onexit();
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.type === 'keydown') {
      pauseState.dismiss();
      // The bar's own keys first (`Enter` the main action, `Esc` out of a dead match); `Enter` on a
      // focused button presses that button.
      const action = statusKeyAction(bar, event.key);
      if (
        action !== null &&
        !(event.key === 'Enter' && event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        doStatusAction(action);
        return;
      }
    }
    // The HUD's own keys and the open overlays first, then the keys of the orders.
    if (
      routeKey(chrome, event, {
        fit: () => canvas?.fitMap(),
        mute: () => {
          sound.toggleMute();
        },
        idle: () => orders?.isIdle() ?? true,
      })
    ) {
      return;
    }
    if (orders !== null && forwardKey(orders, event)) {
      event.preventDefault();
    }
  }

  const bar = $derived(statusView({ status, paused, me, notice: pauseState.notice, pauseLeft }));
  // Joining: before `welcome` the socket is still opening; after it the first snapshot is awaited.
  // Once drawn it stays drawn: a reconnect empties the HUD data for a moment, the map stays.
  let drawn = $state(false);
  $effect(() => {
    if (hud?.current != null) drawn = true;
  });
  const loadingStage = $derived(drawn ? null : hud === null ? 'connect' : 'frame');
</script>

<svelte:window
  onpointerdown={() => {
    pauseState.dismiss();
  }}
  onkeydown={handleKey}
  onkeyup={handleKey}
  onblur={() => {
    orders?.key({ type: 'keyup', code: '', shiftKey: false });
  }}
/>

<main
  class="match"
  class:player-sides={colours !== null}
  style:--own={colours === null ? undefined : colourVar(colours[me])}
  style:--enemy={colours === null ? undefined : colourVar(colours[me === 0 ? 1 : 0])}
>
  {#if hud !== null && orders !== null}
    <GameCanvas
      bind:this={canvas}
      {map}
      source={session}
      interaction={orders}
      player={me}
      {colours}
      {backgroundUrl}
      {geo}
      onerror={(error: unknown) => {
        console.error(error);
        rendererFailed = true;
      }}
    />
    <Hud
      {rendererFailed}
      {onreload}
      {hud}
      {orders}
      {chrome}
      {rated}
      {forfeitBanS}
      onpause={pauseState.available && status === 'ready' && paused === null
        ? () => {
            session?.pause();
          }
        : undefined}
      oninsets={(next: Insets) => {
        insets = next;
      }}
      anchors={{
        node: (id: number) => canvas?.nodeAnchor(id) ?? null,
        group: (id: string) => canvas?.groupAnchor(id) ?? null,
      }}
    />
  {/if}

  {#if loadingStage !== null}
    <MatchLoading stage={loadingStage} stalled={bar?.tone === 'alert'} />
  {/if}

  {#if bar !== null}
    <MatchStatus view={bar} lifted={rendererFailed} onaction={doStatusAction} />
  {/if}
</main>

<style>
  .match {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
  }
</style>
