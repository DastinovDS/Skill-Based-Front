<script lang="ts">
  import { HudChrome } from '../hud/chrome.svelte.ts';
  import { hintsVisible, registerMatch } from '../hud/hints.ts';
  import Hud from '../hud/Hud.svelte';
  import { routeKey } from '../hud/hudKeys.ts';
  import { HudState } from '../hud/hudState.svelte.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { backgroundUrl } from '../map/bundledMaps.ts';
  import { forwardKey } from '../match/keyEvents.ts';
  import { OrderController } from '../match/orderController.ts';
  import { MatchSession } from '../match/session.ts';
  import type { ConnectionStatus } from '../net/matchConnection.ts';
  import type {
    MapFile,
    MatchEndMsg,
    PausedMsg,
    PlayerId,
    RulesetPublic,
    ServerMsg,
  } from '../protocol.gen.ts';
  import type { Anchor } from '../render/anchors.ts';
  import { NO_INSETS, type Insets } from '../render/camera.ts';
  import GameCanvas from '../render/GameCanvas.svelte';

  interface Props {
    matchId: string;
    token: string;
    map: MapFile;
    /** The server said the match is over. */
    onend: (me: PlayerId, end: MatchEndMsg) => void;
    onexit: () => void;
    /** Reloads the page after a protocol version mismatch (a test replaces it). */
    onreload?: () => void;
  }

  let {
    matchId,
    token,
    map,
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
  let session = $state.raw<MatchSession | null>(null);
  let status = $state<ConnectionStatus>('connecting');
  let paused = $state.raw<PausedMsg | null>(null);
  let notice = $state.raw<MessageKey | null>(null);
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
  // The key hints show in the first matches only; a match counts once, also after a reload.
  const hints = $derived(hintsVisible(registerMatch(matchId)));

  function handle(msg: ServerMsg): void {
    if (msg.type === 'paused') {
      paused = msg.paused ? msg : null;
      pauseLeft = msg.ends_in_s ?? 0;
      notice = null;
    } else if (msg.type === 'error') {
      notice = msg.code === 'PAUSE_DENIED' ? 'match.error.pauseDenied' : 'match.error.generic';
    } else if (msg.type === 'match_end') {
      onend(me, msg);
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
        rules = welcome.ruleset_public;
        hud = state;
        return {
          hud: state,
          tickHz: welcome.ruleset_public.tick_hz,
          orders: welcome.ruleset_public.orders,
          capacity: welcome.ruleset_public.capacity,
          roundTicks: welcome.ruleset_public.combat.round_ticks,
          recruitTicks: welcome.ruleset_public.recruit.unit_ticks,
          roadBuildTicks: welcome.ruleset_public.build.ticks_per_level,
          cityUpgrades: welcome.ruleset_public.city_upgrades.enabled
            ? {
                barracks: welcome.ruleset_public.city_upgrades.barracks_ticks,
                warehouse: welcome.ruleset_public.city_upgrades.warehouse_ticks,
                warehouseMaxLevel: welcome.ruleset_public.city_upgrades.warehouse_max_level,
                warehouseGainPerLevel:
                  welcome.ruleset_public.city_upgrades.warehouse_gain_per_level,
              }
            : null,
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

  function handleKey(event: KeyboardEvent): void {
    // The HUD's own keys and the open overlays first, then the keys of the orders.
    if (
      routeKey(chrome, event, {
        fit: () => canvas?.fitMap(),
        idle: () => orders?.isIdle() ?? true,
      })
    ) {
      return;
    }
    if (orders !== null && forwardKey(orders, event)) {
      event.preventDefault();
    }
  }

  const paused_by_me = $derived(paused !== null && paused.by === me);
</script>

<svelte:window
  onkeydown={handleKey}
  onkeyup={handleKey}
  onblur={() => {
    orders?.key({ type: 'keyup', code: '', shiftKey: false });
  }}
/>

<main class="match">
  {#if hud !== null && orders !== null}
    <GameCanvas
      bind:this={canvas}
      {map}
      source={session}
      interaction={orders}
      player={me}
      backgroundUrl={backgroundUrl(map.meta.name)}
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
      {hints}
      onpause={status === 'ready' && paused === null
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
  {:else if status === 'version_mismatch' || status === 'replaced' || status === 'gone' || status === 'failed'}
    <!-- The banner below says what happened. -->
  {:else}
    <p class="loading" role="status">{t('match.connecting')}</p>
  {/if}

  {#if status === 'reconnecting'}
    <div class="banner" role="status">
      {t('match.status.reconnecting')}
      <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
    </div>
  {:else if status === 'gone'}
    <div class="banner" role="alert">
      {t('match.status.gone')}
      <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
    </div>
  {:else if status === 'failed'}
    <div class="banner" role="alert">
      {t('match.status.failed')}
      <button
        type="button"
        onclick={() => {
          session?.retry();
        }}>{t('match.retry')}</button
      >
      <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
    </div>
  {:else if status === 'version_mismatch'}
    <div class="banner" role="alert">
      {t('match.status.versionMismatch')}
      <button type="button" onclick={onreload}>{t('match.reload')}</button>
    </div>
  {:else if status === 'replaced'}
    <div class="banner" role="alert">
      {t('match.status.replaced')}
      <button type="button" onclick={onexit}>{t('match.toMenu')}</button>
    </div>
  {:else if paused !== null}
    <div class="banner" role="status">
      {tf(paused_by_me ? 'match.paused.you' : 'match.paused.enemy', { seconds: pauseLeft })}
      {#if paused_by_me}
        <button
          type="button"
          onclick={() => {
            session?.resume();
          }}>{t('match.resume')}</button
        >
      {/if}
    </div>
  {:else if notice !== null}
    <div class="banner" role="alert">{t(notice)}</div>
  {/if}
</main>

<style>
  .match {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
  }

  .loading {
    margin: 0;
    padding: 24px;
  }
</style>
