<script lang="ts">
  import { untrack } from 'svelte';
  import { MatchAudio } from '../audio/matchAudio.ts';
  import { sound } from '../audio/soundState.svelte.ts';
  import { HudChrome } from '../hud/chrome.svelte.ts';
  import Hud from '../hud/Hud.svelte';
  import { routeKey } from '../hud/hudKeys.ts';
  import { markProblem } from '../hud/markProblem.ts';
  import { diagnostics, watchFrames } from '../diagnostics.ts';
  import { HudState } from '../hud/hudState.svelte.ts';
  import { forwardKey } from '../match/keyEvents.ts';
  import { OrderController } from '../match/orderController.ts';
  import { PauseState } from '../match/pauseState.svelte.ts';
  import { MatchSession } from '../match/session.ts';
  import { resultDelayMs } from '../match/resultDelay.ts';
  import type { GeoFile } from '../map/geography.ts';
  import type { ConnectionStatus } from '../net/matchConnection.ts';
  import type {
    ChapterId,
    MapFile,
    MatchEndMsg,
    PausedMsg,
    PlayerId,
    RulesetPublic,
    ServerMsg,
  } from '../protocol.gen.ts';
  import ChapterSeal from '../hud/ChapterSeal.svelte';
  import TutorialCoachView from '../hud/TutorialCoach.svelte';
  import { CAPITAL_RESULT_DELAY_MS } from '../render/style.ts';
  import type { RenderSource } from '../render/source.ts';
  import { chapterOf } from '../tutorial/chapters.ts';
  import { TutorialCoach } from '../tutorial/coach.svelte.ts';
  import { FULL_GATE } from '../tutorial/gate.ts';
  import { TutorialSource } from '../tutorial/tutorialSource.ts';
  import { cardKicker } from './tutorial/texts.ts';
  import type { Anchor } from '../render/anchors.ts';
  import { NO_INSETS, type Insets } from '../render/camera.ts';
  import GameCanvas from '../render/GameCanvas.svelte';
  import { renderRules } from '../render/renderRules.ts';
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
    /**
     * A tutorial chapter (#806): the coach draws its beats, the HUD shows what they unlock, and the
     * goal ends on the chapter's result (Seal) instead of the result screen.
     */
    chapter?: ChapterId | null;
    /** A chapter: "All chapters" on its result, or the chapter left. */
    onchapters?: () => void;
    /** A chapter: "Replay chapter" on its result. */
    onreplay?: () => void;
    /** A chapter's goal was reached (its progress is kept). */
    onchapterdone?: (chapter: ChapterId) => void;
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
    chapter = null,
    onchapters = () => undefined,
    onreplay = () => undefined,
    onchapterdone = () => undefined,
  }: Props = $props();

  // The chapter file of a tutorial chapter (#806), bundled at build time.
  const chapterFile = $derived(chapter === null ? null : chapterOf(chapter));
  // The coach exists once `welcome` gave the side and the HUD (its locks read the own groups).
  let coach = $state.raw<TutorialCoach | null>(null);

  // `welcome` brings the ruleset and the side, so the HUD exists only after it.
  let hud = $state.raw<HudState | null>(null);
  let rules = $state.raw<RulesetPublic | null>(null);
  let me = $state<PlayerId>(0);
  // Both players' colours by player id (DEC-49), from `welcome` (the same again on a reconnect).
  let colours = $state.raw<ColourIds | null>(null);
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
    if (msg.type === 'tutorial') {
      coach?.onMessage(msg);
      return;
    }
    if (msg.type === 'match_end' && chapterFile !== null) {
      endChapter(msg);
      return;
    }
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

  /**
   * The end of a chapter: the goal (the scripted side forfeits, or chapter IV's capital) shows the
   * result over the last frame once the capture is seen; leaving it (the player's own forfeit) goes
   * to the chapter select.
   */
  function endChapter(end: MatchEndMsg): void {
    const file = chapterFile;
    if (file === null) return;
    clearTimeout(endTimer);
    if (end.winner !== me) {
      onchapters();
      return;
    }
    onchapterdone(file.id);
    const wait = Math.max(resultDelayMs(end), CAPITAL_RESULT_DELAY_MS);
    endTimer = setTimeout(() => {
      endTimer = undefined;
      coach?.finish();
    }, wait);
  }

  $effect(() => {
    const file = untrack(() => chapterFile);
    const current = new MatchSession({
      matchId,
      token,
      context: (welcome) => {
        const state = new HudState(
          {
            me: welcome.player,
            nicks: welcome.nicks,
            rules: welcome.ruleset_public,
            map,
          },
          { startBanner: file === null },
        );
        if (file !== null) {
          coach = new TutorialCoach(file, {
            resume: () => {
              current.resume();
            },
            context: {
              map,
              groupNode: (id: string) => {
                const at = state.ownGroup(id)?.location;
                return at?.kind === 'node' ? at.node : null;
              },
            },
          });
        }
        me = welcome.player;
        colours = welcome.colours;
        rules = welcome.ruleset_public;
        hud = state;
        return {
          hud: state,
          rules: renderRules(welcome.ruleset_public),
          audio: new MatchAudio({
            me: welcome.player,
            play: (id) => {
              sound.play(id);
            },
          }),
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
      coach = null;
      drawn = false;
      hud?.destroy();
      hud = null;
      chrome.closeAll();
    };
  });

  $effect(() => {
    canvas?.setInsets(insets);
  });

  // The diagnostics name this match, and count its frames for stalls (#810).
  $effect(() => {
    diagnostics.setMatch(matchId);
    const stop = watchFrames(diagnostics);
    return () => {
      stop();
      diagnostics.setMatch(null);
    };
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
    const tutor = coach;
    return new OrderController({
      hud,
      map,
      rules,
      locks: tutor,
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

  // A UI beat of the chapter begins on a selection (I.2, IV.3, A1.2): the coach looks at each one.
  $effect(() => {
    const tutor = coach;
    const state = hud;
    if (tutor === null || state === null) return undefined;
    const look = (): void => {
      const selection = state.selection;
      if (selection?.kind !== 'group') {
        tutor.onSelection(null);
        return;
      }
      const at = state.ownGroup(selection.id)?.location;
      tutor.onSelection({ node: at?.kind === 'node' ? at.node : null });
    };
    look();
    return state.listen(look);
  });

  // In a chapter the map draws what the beat shows, and the goal marks of its card (#806).
  const source = $derived.by<RenderSource | null>(() => {
    const live = session;
    const tutor = coach;
    if (live === null || tutor === null) return live;
    const ordersNow = orders;
    return new TutorialSource(live, tutor, map, () => {
      const menu = ordersNow?.cityMenu.current;
      return menu?.open === true ? menu.target : null;
    });
  });
  const gate = $derived(coach?.current.gate ?? FULL_GATE);
  const kicker = $derived(chapterFile === null ? null : cardKicker(chapterFile));

  function doStatusAction(action: StatusAction): void {
    if (action === 'retry') session?.retry();
    else if (action === 'reload') onreload();
    else if (action === 'resume') session?.resume();
    else onexit();
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.type === 'keydown') {
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
        mark: () => {
          void markProblem(hud?.toasts ?? null);
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

  const bar = $derived(statusView({ status, paused, me, pauseLeft }));
  // Joining: before `welcome` the socket is still opening; after it the first snapshot is awaited.
  // Once drawn it stays drawn: a reconnect empties the HUD data for a moment, the map stays.
  let drawn = $state(false);
  $effect(() => {
    if (hud?.current != null) drawn = true;
  });
  const loadingStage = $derived(drawn ? null : hud === null ? 'connect' : 'frame');
</script>

<svelte:window
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
      {source}
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
      colour={colours?.[me] ?? null}
      paused={paused !== null}
      {gate}
      chapter={kicker}
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

  {#if coach !== null && orders !== null && chapterFile !== null && kicker !== null}
    <!-- The coach stands over the menus it marks; a dialog of the HUD hides it (#806). -->
    {#if !coach.sealed && !chrome.exitOpen && !chrome.settingsOpen}
      <TutorialCoachView
        {coach}
        {kicker}
        {map}
        {orders}
        anchors={{
          node: (id: number) => canvas?.nodeAnchor(id) ?? null,
          group: (id: string) => canvas?.groupAnchor(id) ?? null,
        }}
      />
    {:else if coach.sealed}
      <ChapterSeal chapter={chapterFile} {onchapters} {onreplay} />
    {/if}
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
