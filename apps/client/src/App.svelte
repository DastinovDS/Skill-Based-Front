<script lang="ts">
  import Hud from './hud/Hud.svelte';
  import GameCanvas from './render/GameCanvas.svelte';

  let rendererFailed = $state(false);

  function handleRendererError(error: unknown): void {
    console.error(error);
    rendererFailed = true;
  }
</script>

<main class="app">
  <GameCanvas onerror={handleRendererError} />
  <Hud {rendererFailed} />
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
</style>
