<script lang="ts">
  import { Application } from 'pixi.js';
  import { onMount } from 'svelte';
  import { createTestScene } from './testScene.ts';

  interface Props {
    /** Called when the renderer cannot start (for example, no WebGL). */
    onerror?: (error: unknown) => void;
  }

  let { onerror }: Props = $props();

  // PixiJS objects live outside Svelte reactivity (AGENTS.md §7.2): plain locals, no $state.
  // The canvas element belongs to Svelte markup, so PixiJS never inserts or removes DOM nodes.
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  onMount(() => {
    const app = new Application();
    let disposed = false;
    let ready = false;

    app
      .init({
        canvas,
        resizeTo: host,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        background: 0x0d1117,
      })
      .then(() => {
        // init() is async: the component may already be unmounted when it resolves.
        if (disposed) {
          app.destroy({ removeView: false }, { children: true });
          return;
        }
        ready = true;

        const scene = createTestScene();
        app.stage.addChild(scene);
        const center = (): void => {
          scene.position.set(app.screen.width / 2, app.screen.height / 2);
        };
        center();
        app.renderer.on('resize', center);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onerror?.(error);
        }
      });

    return () => {
      disposed = true;
      if (ready) {
        app.destroy({ removeView: false }, { children: true });
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
  }
</style>
