<script lang="ts">
  import { onMount } from 'svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf } from '../i18n/index.ts';
  import { backgroundUrl } from '../map/bundledMaps.ts';
  import GameCanvas from '../render/GameCanvas.svelte';
  import { ReplayPlayer, SPEEDS } from './replayPlayer.ts';
  import type { ReplayFile } from './replayFile.ts';

  interface Props {
    file: ReplayFile;
    /** Leave the viewer (back to the result screen). Without it there is no back button. */
    onback?: () => void;
  }

  let { file, onback }: Props = $props();

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

  const winner = $derived(file.outcome.winner);
  const finished = $derived(position >= player.duration);
  const result = $derived(
    winner === null
      ? t('replay.draw')
      : tf('replay.winner', { player: t(winner === 0 ? 'replay.player1' : 'replay.player2') }),
  );
  let rendererFailed = $state(false);
</script>

<main class="viewer">
  <GameCanvas
    map={file.map}
    source={player}
    backgroundUrl={backgroundUrl(file.map.meta.name)}
    onerror={(error: unknown) => {
      console.error(error);
      rendererFailed = true;
    }}
  />
  {#if rendererFailed}
    <p class="failed" role="alert">{t('error.renderer')}</p>
  {/if}
  <section class="controls" aria-label={t('replay.controls')}>
    {#if onback !== undefined}
      <button type="button" onclick={onback}>{t('replay.back')}</button>
    {/if}
    <button
      type="button"
      class="play"
      onclick={() => {
        player.toggle();
        sync();
      }}
    >
      {playing ? t('replay.pause') : t('replay.play')}
    </button>
    <div class="speeds" role="group" aria-label={t('replay.speed')}>
      {#each SPEEDS as option (option)}
        <button
          type="button"
          aria-pressed={speed === option}
          onclick={() => {
            player.setSpeed(option);
            sync();
          }}>×{option}</button
        >
      {/each}
    </div>
    <input
      class="seek"
      type="range"
      min="0"
      max={player.duration}
      step="1"
      value={position}
      aria-label={t('replay.seek')}
      oninput={(event) => {
        player.seek(event.currentTarget.valueAsNumber);
        sync();
      }}
    />
    <span class="time">
      {formatClock(position / player.tickHz)} / {formatClock(player.duration / player.tickHz)}
    </span>
    <span class="score">
      {t('replay.player1')}
      {vp[0]} : {vp[1]}
      {t('replay.player2')}
    </span>
    {#if finished}
      <strong class="result">{result}</strong>
    {/if}
  </section>
</main>

<style>
  .viewer {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
  }

  .controls {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 8px 16px;
    border-top: 1px solid #30363d;
    background: rgb(22 27 34 / 90%);
    font-size: 14px;
  }

  .speeds {
    display: flex;
    gap: 4px;
  }

  .seek {
    flex: 1 1 240px;
    min-width: 160px;
  }

  .time,
  .score {
    font-variant-numeric: tabular-nums;
  }

  .failed {
    position: absolute;
    inset: 16px auto auto 16px;
    margin: 0;
  }

  button {
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
  }

  button[aria-pressed='true'] {
    background: #388bfd;
    border-color: #58a6ff;
    font-weight: 600;
  }
</style>
