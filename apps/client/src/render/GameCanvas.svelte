<script lang="ts">
  import { Application } from 'pixi.js';
  import { onMount } from 'svelte';
  import type { MapJson } from '../map/mapJson.ts';
  import { MapScene } from './mapScene.ts';
  import { CANVAS_BACKGROUND } from './style.ts';

  interface Props {
    map: MapJson;
    /** Called when the renderer cannot start (for example, no WebGL). */
    onerror?: (error: unknown) => void;
    /** Frames per second, reported twice a second (not every frame) for the dev HUD. */
    onfps?: (fps: number) => void;
  }

  let { map, onerror, onfps }: Props = $props();

  const FPS_REPORT_MS = 500;

  // PixiJS objects live outside Svelte reactivity (AGENTS.md §7.2): plain locals, no $state.
  // The canvas element belongs to Svelte markup, so PixiJS never inserts or removes DOM nodes.
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let app: Application | null = null;
  let scene: MapScene | null = null;

  /** "Fit map": show the whole map. Called by the HUD button through `bind:this`. */
  export function fitMap(): void {
    scene?.fit();
  }

  function show(next: MapJson): void {
    if (app === null) {
      return;
    }
    scene?.destroy();
    scene = new MapScene(app, next);
  }

  // Rebuild the scene when the map changes; the first build happens once init() resolves.
  $effect(() => {
    show(map);
  });

  onMount(() => {
    const pending = new Application();
    let disposed = false;
    let stopWatchingDpr = (): void => undefined;
    let fpsTimer: ReturnType<typeof setInterval> | undefined;

    // A window moved to a screen with another pixel ratio: re-render at the new density.
    const watchDpr = (): void => {
      const query = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      const onChange = (): void => {
        pending.renderer.resolution = window.devicePixelRatio;
        pending.resize();
        watchDpr();
      };
      query.addEventListener('change', onChange, { once: true });
      stopWatchingDpr = () => {
        query.removeEventListener('change', onChange);
      };
    };

    pending
      .init({
        canvas,
        resizeTo: host,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        background: CANVAS_BACKGROUND,
      })
      .then(() => {
        // init() is async: the component may already be unmounted when it resolves.
        if (disposed) {
          pending.destroy({ removeView: false }, { children: true });
          return;
        }
        app = pending;
        show(map);
        if (typeof window.matchMedia === 'function') {
          watchDpr();
        }
        fpsTimer = setInterval(() => {
          onfps?.(pending.ticker.FPS);
        }, FPS_REPORT_MS);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onerror?.(error);
        }
      });

    return () => {
      disposed = true;
      clearInterval(fpsTimer);
      stopWatchingDpr();
      scene?.destroy();
      scene = null;
      if (app !== null) {
        app.destroy({ removeView: false }, { children: true });
        app = null;
      }
    };
  });
</script>

<div class="game-canvas" bind:this={host}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .game-canvas {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    /* The canvas handles drag and wheel itself: no browser panning or pinch zoom on touch. */
    touch-action: none;
  }
</style>
