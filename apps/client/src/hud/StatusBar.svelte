<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import { formatCentis, formatClock } from './format.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    panelOpen: boolean;
    ontogglepanel: () => void;
  }

  let { data, panelOpen, ontogglepanel }: Props = $props();
</script>

<header class="bar">
  <button type="button" aria-expanded={panelOpen} onclick={ontogglepanel}>{t('hud.panel')}</button>
  {#if data !== null}
    <dl class="stats">
      <div>
        <dt>{t('status.cp')}</dt>
        <dd>
          {formatCentis(data.cp.value, getLocale())} / {formatCentis(data.cp.cap, getLocale())}
          <span class="dim"
            >({tf('status.cpRegen', {
              rate: formatCentis(data.cp.regenPerSecond, getLocale()),
            })})</span
          >
        </dd>
      </div>
      <div>
        <dt>{t('status.stance')}</dt>
        <dd>{t(`stance.${data.stance}`)}</dd>
      </div>
      <div>
        <dt>{t('status.vp')}</dt>
        <dd>
          {t('status.you')}
          {data.vp.mine} : {data.vp.enemy}
          {t('status.enemy')}
        </dd>
      </div>
      <div>
        <dt>{t('status.time')}</dt>
        <dd>{formatClock(data.secondsLeft)}</dd>
      </div>
    </dl>
  {/if}
</header>

<style>
  .bar {
    pointer-events: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    padding: 6px 16px;
    border-bottom: 1px solid #30363d;
    background: rgb(22 27 34 / 90%);
    font-size: 14px;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    margin: 0;
  }

  .stats div {
    display: flex;
    gap: 6px;
  }

  dt {
    color: #8b949e;
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: #8b949e;
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
</style>
