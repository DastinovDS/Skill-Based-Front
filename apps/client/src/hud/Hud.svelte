<script lang="ts">
  import { t } from '../i18n/index.ts';

  interface Props {
    rendererFailed: boolean;
  }

  let { rendererFailed }: Props = $props();
</script>

<!-- The overlay lets pointer events through to the canvas; only panels catch them. -->
<div class="hud">
  <section class="panel">
    <h1>{t('app.title')}</h1>
    <p>{t('hud.testScene')}</p>
  </section>
  {#if rendererFailed}
    <section class="panel error" role="alert">{t('error.renderer')}</section>
  {/if}
</div>

<style>
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 16px;
  }

  .panel {
    pointer-events: auto;
    padding: 8px 12px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: rgb(22 27 34 / 85%);
    color: #e6edf3;
  }

  h1 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  p {
    margin: 0;
    font-size: 14px;
  }

  .error {
    border-color: #f85149;
  }
</style>
