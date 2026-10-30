<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import type { IconName } from '../hud/icons.ts';

  interface Props {
    /** `alert` is amber (never red: red is the enemy), `info` is the quiet state that passes by itself. */
    tone: 'info' | 'alert';
    icon: IconName;
    title: string;
    text?: string | null;
    /** `status` is read politely, `alert` at once. */
    role?: 'status' | 'alert';
    /** `title`: only the title is read out when it shows (a countdown in the text must not be read every second). */
    live?: 'all' | 'title';
    /** The buttons (`StatusButton`s), if any. */
    actions?: Snippet;
  }

  let { tone, icon, title, text = null, role = 'status', live = 'all', actions }: Props = $props();
</script>

<!-- The bar over the map for a state of the connection, a pause or a failure: an icon in a badge
     (the shape tells the tone, the hue only backs it), the title, one plain line, the buttons with
     their keys. The amber edge is the one of the alert stack. -->
<section class="bar {tone}" role={live === 'all' ? role : undefined}>
  <span class="badge" class:spin={icon === 'refresh'}><Icon name={icon} size={18} /></span>
  <div class="words">
    <strong role={live === 'title' ? role : undefined}>{title}</strong>
    {#if text !== null}<span class="text">{text}</span>{/if}
  </div>
  {#if actions !== undefined}
    <div class="actions">{@render actions()}</div>
  {/if}
</section>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    max-width: min(640px, calc(100vw - 32px));
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    pointer-events: auto;
  }

  .bar.alert {
    border-left-color: var(--warn);
  }

  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1.5px solid var(--text-dim);
    color: var(--text);
  }

  .alert .badge {
    border-color: var(--warn);
    background: var(--warn);
    color: var(--bg);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  strong {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .text {
    font-size: 14px;
    line-height: 1.35;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: 6px;
  }

  @media (width <= 560px) {
    .bar {
      flex-wrap: wrap;
    }

    .words {
      flex: 1 1 0;
    }

    .actions {
      flex-basis: 100%;
      margin-left: 44px;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .spin :global(svg) {
      animation: bar-spin 1.4s linear infinite;
    }
  }

  @keyframes bar-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
