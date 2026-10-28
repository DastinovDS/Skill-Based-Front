<script lang="ts">
  import { Application } from 'pixi.js';
  import { onMount, untrack } from 'svelte';
  import type { MapFile, PlayerId } from '../protocol.gen.ts';
  import type { Anchor } from './anchors.ts';
  import { NO_INSETS, type Insets } from './camera.ts';
  import type { MapInteraction } from './interaction.ts';
  import { createSceneSprites, MapScene, type SceneSprites } from './mapScene.ts';
  import type { RenderSource } from './source.ts';
  import { CANVAS_BACKGROUND } from './style.ts';

  interface Props {
    map: MapFile;
    /** Frames and events to draw on the map; without it only the static map is shown. */
    source?: RenderSource | null;
    /** Selection, ghost orders and preview to draw, and where clicks go. */
    interaction?: MapInteraction | null;
    /** The viewing player (own groups and packets). Default 0. */
    player?: PlayerId;
    /** URL of the baked background (WebP) of the map, if it has one. */
    backgroundUrl?: string | null;
    /** The part of the map (world units) to look at at the start; default: the whole map. */
    viewRect?: { x: number; y: number; width: number; height: number } | null;
    /** Called when the renderer cannot start (for example, no WebGL). */
    onerror?: (error: unknown) => void;
    /** Frames per second, reported twice a second (not every frame) for the dev HUD. */
    onfps?: (fps: number) => void;
  }

  let {
    map,
    source = null,
    interaction = null,
    player = 0,
    backgroundUrl = null,
    viewRect = null,
    onerror,
    onfps,
  }: Props = $props();

  const FPS_REPORT_MS = 500;

  // PixiJS objects live outside Svelte reactivity (AGENTS.md §7.2): plain locals, no $state.
  // The canvas element belongs to Svelte markup, so PixiJS never inserts or removes DOM nodes.
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let app: Application | null = null;
  let scene: MapScene | null = null;
  // The baked shapes live as long as the renderer: a scene that replaces another finds them made.
  let sprites: SceneSprites | null = null;
  let insets: Insets = NO_INSETS;

  /** "Fit map": show the whole map. Called by the HUD button through `bind:this`. */
  export function fitMap(): void {
    scene?.fit();
  }

  /** Moves the camera to a city (`Space`: the next alert). */
  export function focusNode(node: number): void {
    scene?.focusNode(node);
  }

  /** Where a city is on screen (client px) with the radius of its circle; `null` before the map is up. */
  export function nodeAnchor(node: number): Anchor | null {
    return scene?.nodeAnchor(node) ?? null;
  }

  /** Where an own group's token is on screen; `null`: not drawn. */
  export function groupAnchor(group: string): Anchor | null {
    return scene?.groupAnchor(group) ?? null;
  }

  /** The screen margins the HUD covers: "fit map" keeps the map out of them. */
  export function setInsets(next: Insets): void {
    insets = next;
    scene?.setInsets(next);
  }

  function show(next: MapFile): void {
    const current = app;
    if (current === null) {
      return;
    }
    scene?.destroy();
    // `data-background`: none, pending, loaded or failed; end-to-end tests wait for a baked
    // background before a screenshot.
    host.dataset.background = backgroundUrl === null ? 'none' : 'pending';
    // Only the map rebuilds the scene; a new source is handed to the running one below.
    scene = untrack(
      () =>
        new MapScene(current, next, insets, {
          sprites: sprites ?? undefined,
          source,
          interaction,
          player,
          backgroundUrl,
          onbackground: (state: 'loaded' | 'failed') => {
            host.dataset.background = state;
          },
          onsnapshot: (tick: number) => {
            // A plain attribute: end-to-end tests wait for it before taking a screenshot.
            host.dataset.tick = String(tick);
          },
        }),
    );
    if (viewRect !== null) scene.showRect(viewRect);
  }

  // Rebuild the scene when the map changes; the first build happens once init() resolves.
  $effect(() => {
    show(map);
  });

  $effect(() => {
    scene?.setSource(source);
  });

  $effect(() => {
    scene?.setInteraction(interaction);
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
        sprites = createSceneSprites(pending.renderer);
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
      // After the renderer: no frame has the textures bound any more.
      sprites?.world.destroy();
      sprites?.screen.destroy();
      sprites = null;
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
