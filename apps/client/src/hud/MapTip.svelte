<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** What the pointer rests on (a group id, a road id); `null`: nothing, no tip. */
    identity: string | number | null;
    /** The content of the tip. */
    children: Snippet;
  }

  let { identity, children }: Props = $props();

  /** The pointer must rest on the subject this long before the tip shows (ui-style U5). */
  const DELAY_MS = 300;
  const GAP = 14;

  let shown = $state(false);
  let box: HTMLElement | undefined = $state();
  // The pointer position is plain data: it moves the box through the CSSOM, not through state.
  let pointer = { x: 0, y: 0 };
  let overMap = false;

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
    // Hide on every new subject, show it after the rest.
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
    if (shown && identity !== null) place();
  });
</script>

<svelte:window onpointermove={onMove} />

<!-- A small pop-up by the pointer on the map: the charges of a group, what a road upgrade gives. -->
{#if shown && identity !== null}
  <div class="tip" role="tooltip" bind:this={box}>
    {@render children()}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 8;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    pointer-events: none;
  }
</style>
