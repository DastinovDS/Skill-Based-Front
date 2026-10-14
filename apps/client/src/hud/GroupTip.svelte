<script lang="ts">
  import type { GroupInfo } from './hudData.ts';
  import ChargeTip from './ChargeTip.svelte';

  interface Props {
    /** The group under the pointer; `null`: none. */
    group: GroupInfo | null;
  }

  let { group }: Props = $props();

  /** The pointer must rest on a group this long before the tip shows (ui-style U5). */
  const DELAY_MS = 300;
  const GAP = 14;

  let shown = $state(false);
  let box: HTMLElement | undefined = $state();
  // The pointer position is plain data: it moves the box through the CSSOM, not through state.
  let pointer = { x: 0, y: 0 };
  let overMap = false;

  // The same group while its id is: the numbers change under it every snapshot.
  const identity = $derived(group === null ? null : group.id);

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
    // Hide on every new group, show it after the rest.
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
    if (shown && group !== null) place();
  });
</script>

<svelte:window onpointermove={onMove} />

<!-- The only pop-up of the map: the charges of the group under the pointer. -->
{#if shown && group !== null}
  <div class="tip" role="tooltip" bind:this={box}>
    <ChargeTip units={group.units} charged={group.charged} />
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
