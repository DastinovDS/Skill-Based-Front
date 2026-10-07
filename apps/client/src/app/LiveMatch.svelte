<script lang="ts">
  import Hud from '../hud/Hud.svelte';
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
  let fps = $state(0);
  let canvas: { fitMap: () => void; setInsets: (insets: Insets) => void } | undefined =
    $state.raw();
  let insets: Insets = $state.raw(NO_INSETS);
  let pauseLeft = $state(0);

  function handle(msg: ServerMsg): void {
    if (msg.type === 'paused') {
      paused = msg.paused ? msg : null;
      pauseLeft = msg.ends_in_s ?? 0;
      notice = null;
    } else if (msg.type === 'error') {
      notice = msg.code === 'PAUSE_DENIED' ? 'match.error.pauseDenied' : 'match.error.generic';
    } else if (msg.type === 'match_end') {
      onend(me, msg);
    }
  }

  $effect(() => {
    const current = new MatchSession({
      matchId,
      token,
      context: (welcome) => {
        const state = new HudState({
          me: welcome.player,
          rules: welcome.ruleset_public,
          map,
        });
        me = welcome.player;
        rules = welcome.ruleset_public;
        hud = state;
        return { hud: state, tickHz: welcome.ruleset_public.tick_hz };
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
      hud = null;
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
    });
  });

  $effect(() => {
    const current = orders;
    return () => {
      current?.destroy();
    };
  });

  function handleKey(event: KeyboardEvent): void {
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
      onfps={(value: number) => {
        fps = value;
      }}
    />
    <Hud
      {rendererFailed}
      {fps}
      {hud}
      {orders}
      oninsets={(next: Insets) => {
        insets = next;
      }}
      onfit={() => canvas?.fitMap()}
    />
    {#if status === 'ready' && paused === null}
      <button
        type="button"
        class="pause"
        onclick={() => {
          session?.pause();
        }}>{t('match.pause')}</button
      >
    {/if}
  {:else if status === 'version_mismatch' || status === 'replaced'}
    <!-- The banner below says what happened. -->
  {:else}
    <p class="loading" role="status">{t('match.connecting')}</p>
  {/if}

  {#if status === 'reconnecting'}
    <div class="banner" role="status">{t('match.status.reconnecting')}</div>
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

  .pause {
    position: fixed;
    right: 12px;
    top: 48px;
    z-index: 5;
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
  }
</style>
