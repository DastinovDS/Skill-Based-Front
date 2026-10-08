<script lang="ts">
  import type { OrderController } from '../match/orderController.ts';
  import type { HudData } from './hudData.ts';
  import { tipText } from './tipText.ts';
  import type { HudContext } from './hudData.ts';

  interface Props {
    data: HudData | null;
    ctx: HudContext;
    orders: OrderController;
  }

  let { data, ctx, orders }: Props = $props();

  /** The pointer must rest on a thing this long before the tooltip shows (ui-style U5). */
  const DELAY_MS = 300;
  const GAP = 14;

  let shown = $state(false);
  let box: HTMLElement | undefined = $state();
  // The pointer position is plain data: it moves the box through the CSSOM, not through state.
  let pointer = { x: 0, y: 0 };
  let overMap = false;

  const tip = $derived(data?.tip ?? null);
  const text = $derived(
    tip === null
      ? null
      : tipText(tip, {
          rules: ctx.rules,
          pickable:
            orders.ui.current.roadPick !== null && orders.ui.current.road?.pickable === true,
        }),
  );
  // A tip is the same thing while its kind and id are: the numbers change under it every snapshot.
  const identity = $derived(tip === null ? null : `${tip.kind}:${identityOf(tip)}`);

  function identityOf(value: NonNullable<typeof tip>): string {
    switch (value.kind) {
      case 'node':
        return String(value.node.id);
      case 'edge':
        return String(value.road.id);
      case 'group':
        return value.group.id;
      case 'intent':
        return value.intent.id;
    }
  }

  function place(): void {
    if (box === undefined) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const x =
      pointer.x + GAP + width > window.innerWidth ? pointer.x - GAP - width : pointer.x + GAP;
    const y =
      pointer.y + GAP + height > window.innerHeight ? pointer.y - GAP - height : pointer.y + GAP;
    box.style.left = `${String(Math.max(4, x))}px`;
    box.style.top = `${String(Math.max(4, y))}px`;
  }

  function onMove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
    overMap = event.target instanceof Element && event.target.closest('.game-canvas') !== null;
    // Dragging the map or a click hides it; it comes back after the delay on the next rest.
    if (event.buttons !== 0 || !overMap) shown = false;
    else place();
  }

  $effect(() => {
    // Hide on every new thing, show it after the rest.
    const current = identity;
    shown = false;
    if (current === null) return undefined;
    const timer = setTimeout(() => {
      shown = overMap;
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  });

  $effect(() => {
    if (shown && text !== null) place();
  });
</script>

<svelte:window onpointermove={onMove} />

{#if shown && text !== null}
  <div class="tip" role="tooltip" bind:this={box}>
    <p class="title">{text.title}</p>
    {#each text.rows as row (row.label)}
      <p class="row">
        <span class="label">{row.label}</span>
        <span class="value">{row.value}</span>
      </p>
      {#if row.hint !== undefined}
        <p class="term">{row.hint}</p>
      {/if}
    {/each}
    {#if text.note !== undefined}
      <p class="note">{text.note}</p>
    {/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 8;
    max-width: 300px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    pointer-events: none;
  }

  p {
    margin: 0;
  }

  .title {
    margin-bottom: 4px;
    font-weight: 700;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .label {
    color: var(--text-dim);
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .term {
    margin-bottom: 2px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .note {
    margin-top: 4px;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
