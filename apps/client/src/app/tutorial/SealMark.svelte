<script lang="ts">
  import { t } from '../../i18n/index.ts';

  interface Props {
    /** The chapter numeral (I to V, or I to III on the Advanced road). */
    n: string;
    /** An Advanced chapter: "ADV" over the numeral. */
    advanced?: boolean;
  }

  let { n, advanced = false }: Props = $props();
  const uid = $props.id();

  const loz = (r: number): string =>
    `M46 ${String(46 - r)}L${String(46 + r)} 46L46 ${String(46 + r)}L${String(46 - r)} 46Z`;
</script>

<!-- The seal of a chapter result (Seal): a dark lozenge with an ivory inner rule and the numeral. -->
<svg class="seal" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
  <defs>
    <radialGradient id="{uid}-g" cx=".38" cy=".32" r=".8">
      <stop offset="0" stop-color="#2b261e" />
      <stop offset="1" stop-color="#14110d" />
    </radialGradient>
  </defs>
  <path d={loz(44)} fill="url(#{uid}-g)" class="rim" />
  <path d={loz(41)} class="lit" />
  <path d={loz(34)} class="ink" />
  <path d={loz(30)} class="faint" />
  {#if advanced}
    <text x="46" y="40" class="adv">{t('tutorial.sealAdv')}</text>
    <path d="M37 44.5H55" class="faint" />
    <text x="46" y="61" class="num small">{n}</text>
  {:else}
    <text x="46" y={n.length > 2 ? 53.5 : 54} class="num" class:long={n.length > 2}>{n}</text>
  {/if}
</svg>

<style>
  .rim {
    stroke: #050403;
    stroke-width: 2;
  }

  .lit {
    fill: none;
    stroke: rgb(214 200 172 / 38%);
    stroke-width: 1;
  }

  .ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.6;
  }

  .faint {
    fill: none;
    stroke: rgb(236 228 209 / 25%);
    stroke-width: 1;
  }

  text {
    text-anchor: middle;
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 1px;
  }

  .num {
    fill: var(--ink);
    font-size: 23px;
  }

  .num.long {
    font-size: 20px;
  }

  .num.small {
    font-size: 19px;
  }

  .adv {
    fill: var(--ink-soft);
    font-size: 8.5px;
    letter-spacing: 2.2px;
  }
</style>
