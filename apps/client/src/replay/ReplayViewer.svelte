<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Insets } from '../render/camera.ts';
  import { formatClock } from '../hud/format.ts';
  import Icon from '../hud/Icon.svelte';
  import { vpShare } from '../hud/topBar.ts';
  import { t, tf } from '../i18n/index.ts';
  import type { GeoFile } from '../map/geography.ts';
  import type { PlayerId } from '../protocol.gen.ts';
  import GameCanvas from '../render/GameCanvas.svelte';
  import { replayMarks } from './marks.ts';
  import { replayKey } from './replayKeys.ts';
  import { ReplayPlayer, SPEEDS } from './replayPlayer.ts';
  import { hasVision, type ReplayFile } from './replayFile.ts';
  import ReplayTimeline from './ReplayTimeline.svelte';
  import SideMark from './SideMark.svelte';
  import { blueSide, otherSide, type ReplayView } from './viewAs.ts';

  interface Props {
    file: ReplayFile;
    /** The server's baked background of the map, if the map is still in the pool. */
    backgroundUrl?: string | null;
    /** The vector file of the map as the replay played it (DEC-36), if it has a fitting one. */
    geo?: GeoFile | null;
    /** Whose eyes the replay opens with (the viewer's own side, if known); default both. */
    initialView?: ReplayView;
    /** Leave the viewer (back to the result screen). Without it there is no back button. */
    onback?: () => void;
  }

  let { file, backgroundUrl = null, geo = null, initialView = 'both', onback }: Props = $props();

  const player = $derived(new ReplayPlayer(file));

  // The controls read the player ten times a second (AGENTS.md 7.2); the map reads it per frame.
  let position = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let vp = $state.raw<readonly [number, number]>([0, 0]);

  function sync(): void {
    position = player.position;
    playing = player.playing;
    speed = player.speed;
    vp = player.current.view.vp;
  }

  onMount(() => {
    const timer = setInterval(sync, 100);
    return () => {
      clearInterval(timer);
    };
  });

  $effect(() => {
    // A new file: show its first frame right away.
    sync();
  });

  // The side the viewer watches as is drawn blue and stands on the left (ui-style 6, "Replay").
  let view = $state<ReplayView>(untrack(() => initialView));
  const blue = $derived(blueSide(view));

  // The fog of the chosen side (#600): what that player saw, copied from the file. "Both" never
  // has fog; a file from before #598 has no record of what the players saw.
  const vision = $derived(hasVision(file));
  let fog = $state(true);
  const fogAvailable = $derived(vision && view !== 'both');
  const fogOn = $derived(fogAvailable && fog);
  const fogReason = $derived(
    !vision ? t('replay.fog.noVision') : view === 'both' ? t('replay.fog.pickSide') : null,
  );

  $effect(() => {
    player.showFogOf(fogOn && view !== 'both' ? view : null);
  });

  function toggleFog(): void {
    if (fogAvailable) fog = !fog;
  }
  const red = $derived(otherSide(blue));
  const nickOf = (side: PlayerId): string =>
    file.nicks?.[side] ?? t(side === 0 ? 'replay.player1' : 'replay.player2');
  const names = $derived([nickOf(0), nickOf(1)] as const);
  const marks = $derived(replayMarks(file.events));

  const share = $derived(vpShare(vp[blue], vp[red]));
  const winner = $derived(file.outcome.winner);
  const finished = $derived(position >= player.duration);
  const result = $derived(
    winner === null ? t('replay.draw') : tf('replay.winner', { player: names[winner] }),
  );

  /** The names of the keys are not translated. */
  const KEY = { esc: 'Esc', space: 'Space', home: 'Home', fog: 'F' } as const;

  const VIEWS: readonly ReplayView[] = [0, 1, 'both'];
  const viewName = (option: ReplayView): string =>
    option === 'both' ? t('replay.view.both') : names[option];

  let rendererFailed = $state(false);
  // The part of the GameCanvas instance the viewer uses (spelled out: typescript-eslint cannot see
  // the types of .svelte imports).
  let canvas: { fitMap: () => void; setInsets: (insets: Insets) => void } | undefined =
    $state.raw();
  let barHeight = $state(0);
  let controlsHeight = $state(0);

  // "Fit map" keeps the map out from under the two bars.
  $effect(() => {
    canvas?.setInsets({ left: 0, right: 0, top: barHeight, bottom: controlsHeight });
  });

  function togglePlay(): void {
    // The click says what the label said, not what the player does by now: the label is up to
    // 100 ms old, and a toggle on a replay that has just ended would restart it (#476).
    if (playing) player.pause();
    else player.play();
    sync();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target;
    const action = replayKey({
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      onControl: target instanceof Element && target.closest('button, a, select') !== null,
    });
    if (action === null) return;
    switch (action.kind) {
      case 'toggle':
        togglePlay();
        break;
      case 'skip':
        player.seek(player.position + action.seconds * player.tickHz);
        sync();
        break;
      case 'speed':
        player.setSpeed(action.speed);
        sync();
        break;
      case 'fit':
        canvas?.fitMap();
        break;
      case 'fog':
        if (!fogAvailable) return;
        toggleFog();
        break;
      case 'back':
        if (onback === undefined) return;
        onback();
        break;
    }
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<main class="viewer" style:--bar-h="{barHeight}px">
  <GameCanvas
    bind:this={canvas}
    map={file.map}
    source={player}
    player={blue}
    {backgroundUrl}
    {geo}
    onerror={(error: unknown) => {
      console.error(error);
      rendererFailed = true;
    }}
  />

  <header class="bar" bind:clientHeight={barHeight}>
    {#if onback !== undefined}
      <button type="button" class="back" aria-keyshortcuts="Escape" onclick={onback}>
        <Icon name="chevronLeft" size={18} />
        <span class="back-label">{t('replay.back')}</span>
        <kbd aria-hidden="true">{KEY.esc}</kbd>
      </button>
    {:else}
      <span></span>
    {/if}

    <div
      class="score"
      role="img"
      aria-label={tf('replay.scoreLabel', {
        blue: names[blue],
        red: names[red],
        blueVp: vp[blue],
        redVp: vp[red],
      })}
    >
      <span class="side">
        <SideMark side="own" />
        <span class="nick">{names[blue]}</span>
      </span>
      <span class="vp blue-vp">{vp[blue]}</span>
      <span class="tug" aria-hidden="true">
        <span class="tug-blue" style:flex-basis="{share}%"></span>
        <span class="tug-red"></span>
      </span>
      <span class="vp red-vp">{vp[red]}</span>
      <span class="side">
        <span class="nick">{names[red]}</span>
        <SideMark side="enemy" />
      </span>
    </div>

    <div class="view" role="group" aria-label={t('replay.view')}>
      <span class="view-label"><Icon name="eye" size={16} />{t('replay.view')}</span>
      <div class="seg">
        {#each VIEWS as option (option)}
          <button
            type="button"
            aria-pressed={view === option}
            onclick={() => {
              view = option;
            }}>{viewName(option)}</button
          >
        {/each}
      </div>
      <button
        type="button"
        class="fog"
        aria-pressed={fogOn}
        aria-disabled={!fogAvailable}
        aria-keyshortcuts="F"
        aria-describedby={fogReason === null ? undefined : 'replay-fog-reason'}
        title={fogReason ?? undefined}
        onclick={toggleFog}
      >
        <Icon name="fog" size={16} />{t('replay.fog')}<kbd aria-hidden="true">{KEY.fog}</kbd>
      </button>
      {#if fogReason !== null}
        <span id="replay-fog-reason" class="sr-only">{fogReason}</span>
      {/if}
    </div>
  </header>

  {#if finished}
    <p class="result" class:draw={winner === null} role="status">
      {#if winner !== null}<SideMark side={winner === blue ? 'own' : 'enemy'} size={18} />{/if}
      {result}
    </p>
  {/if}

  {#if rendererFailed}
    <p class="failed" role="alert">
      <Icon name="alert" size={16} />
      {t('error.renderer')}
      <button
        type="button"
        onclick={() => {
          window.location.reload();
        }}>{t('match.reload')}</button
      >
    </p>
  {/if}

  <section class="controls" aria-label={t('replay.controls')} bind:clientHeight={controlsHeight}>
    <ReplayTimeline
      {position}
      duration={player.duration}
      tickHz={player.tickHz}
      {marks}
      {blue}
      onseek={(tick: number) => {
        player.seek(tick);
        sync();
      }}
    />
    <div class="row">
      <button
        type="button"
        class="play"
        aria-keyshortcuts="Space"
        onclick={togglePlay}
        aria-label={playing ? t('replay.pause') : t('replay.play')}
      >
        <Icon name={playing ? 'pause' : 'play'} size={20} />
        <span class="play-label" aria-hidden="true">
          {playing ? t('replay.pause') : t('replay.play')}
        </span>
        <kbd aria-hidden="true">{KEY.space}</kbd>
      </button>
      <div class="seg speeds" role="group" aria-label={t('replay.speed')}>
        {#each SPEEDS as option, index (option)}
          <button
            type="button"
            aria-pressed={speed === option}
            aria-keyshortcuts={String(index + 1)}
            onclick={() => {
              player.setSpeed(option);
              sync();
            }}>×{option}<kbd aria-hidden="true">{index + 1}</kbd></button
          >
        {/each}
      </div>
      <span class="time" role="timer" aria-label={t('replay.time')}>
        {formatClock(position / player.tickHz)}
        <span class="total">/ {formatClock(player.duration / player.tickHz)}</span>
      </span>
      <ul class="hints" aria-label={t('replay.keys')}>
        <li><kbd>←</kbd><kbd>→</kbd> {t('replay.keys.skip')}</li>
        <li><kbd>{KEY.home}</kbd> {t('replay.keys.fit')}</li>
        <li class="legend">
          <i class="lg-dot"></i>{t('replay.legend.fight')}
          <i class="lg-diamond"></i>{t('replay.legend.capture')}
        </li>
      </ul>
    </div>
  </section>
</main>

<style>
  .viewer {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
    color: var(--text);
    font-size: 14px;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid var(--neutral);
    border-radius: 4px;
    background: var(--surface-2);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--text);
  }

  button:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    line-height: 16px;
  }

  /* The top bar of the match (ui-style 10.2): back on the left, the sides and the VP tug of war in
     the middle, whose eyes the replay is watched through on the right. */
  .bar {
    position: absolute;
    inset: 0 0 auto;
    z-index: 2;
    box-sizing: border-box;
    min-height: 48px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .back {
    justify-self: start;
  }

  .score {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .side {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 16ch;
  }

  .nick {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 19px bold counts as large text: the red number on the bar is 4.4:1, the large-text bar is 3:1. */
  .vp {
    font-size: 19px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .blue-vp {
    color: var(--you);
  }

  .red-vp {
    color: var(--enemy);
  }

  .tug {
    display: flex;
    width: clamp(80px, 14vw, 200px);
    height: 10px;
    overflow: hidden;
    border: 1px solid var(--paper);
    border-radius: 3px;
  }

  .tug-blue {
    flex: 0 0 auto;
    background: var(--you);
  }

  .tug-red {
    flex: 1 1 0;
    background: var(--enemy);
  }

  .view {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .view-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }

  /* A segmented choice: the pressed one is filled (and bold), so it reads without the hue. */
  .seg {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .seg button {
    min-width: 0;
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .seg button[aria-pressed='true'] {
    border-color: var(--you);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .seg button[aria-pressed='true'] kbd {
    border-color: var(--bg);
    color: var(--bg);
  }

  /* The fog toggle: pressed is filled and bold like the choices; unavailable is dimmed and dashed,
     so the three states read without the hue. */
  .fog[aria-pressed='true'] {
    border-color: var(--you);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .fog[aria-pressed='true'] kbd {
    border-color: var(--bg);
    color: var(--bg);
  }

  .fog[aria-disabled='true'] {
    border-style: dashed;
    color: var(--text-dim);
    cursor: not-allowed;
  }

  .fog[aria-disabled='true']:hover {
    border-color: var(--neutral);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .result {
    position: absolute;
    inset: calc(var(--bar-h, 48px) + 12px) auto auto 50%;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 6px 14px;
    border: 1px solid var(--paper);
    border-radius: 16px;
    background: var(--surface);
    font-size: 16px;
    font-weight: 700;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .failed {
    position: absolute;
    inset: calc(var(--bar-h, 48px) + 12px) auto auto 12px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 6px 12px;
    border: 1px dashed var(--warn);
    border-radius: 6px;
    background: var(--surface);
    color: var(--warn);
  }

  .controls {
    position: absolute;
    inset: auto 0 0;
    z-index: 2;
    padding: 6px 16px 10px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .play {
    min-width: 112px;
    min-height: 40px;
    padding: 0 14px;
    border-color: var(--you);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .play kbd {
    border-color: var(--bg);
    color: var(--bg);
  }

  .play:hover {
    border-color: var(--paper);
  }

  .time {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .total {
    color: var(--text-dim);
    font-size: 14px;
  }

  .hints {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    margin: 0 0 0 auto;
    padding: 0;
    color: var(--text-dim);
    list-style: none;
  }

  .hints li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .lg-dot {
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    margin-left: 0;
    border: 2px solid var(--paper);
    border-radius: 50%;
    background: var(--bg);
  }

  .lg-diamond {
    width: 8px;
    height: 8px;
    margin: 0 2px 0 8px;
    border: 1px solid var(--paper);
    background: var(--you);
    transform: rotate(45deg);
  }

  @media (max-width: 900px) {
    .hints {
      display: none;
    }
  }

  /* A phone: the top bar is two tidy rows (back and score, then the view), the controls two rows
     (the timeline, then play, speeds and time), and keys are not shown (no keyboard). */
  @media (max-width: 640px) {
    .bar {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .view {
      grid-column: 1 / -1;
      justify-self: stretch;
    }

    .seg {
      flex: 1;
    }

    .seg button {
      flex: 1;
      max-width: none;
    }

    button {
      min-height: 44px;
    }

    .back {
      min-width: 44px;
    }

    .back-label,
    .nick,
    .view-label,
    kbd,
    .play-label {
      display: none;
    }

    .play {
      min-width: 44px;
      padding: 0;
    }

    .score {
      justify-self: end;
    }

    .controls {
      padding-inline: 12px;
    }

    .row {
      gap: 8px 12px;
    }
  }

  @media (pointer: coarse) {
    kbd {
      display: none;
    }
  }
</style>
