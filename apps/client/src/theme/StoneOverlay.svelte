<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The name of the overlay for assistive technology. */
    label: string;
    /**
     * `window`: a framed stone window in the middle (a dialog); `sheet`: the content stands on the
     * blurred stone itself, as Profile and Replays do.
     */
    kind?: 'window' | 'sheet';
    role?: 'dialog' | 'alertdialog';
    /** Escape closes it; without a handler the overlay ignores the key. */
    onclose?: () => void;
    children: Snippet;
  }

  let { label, kind = 'window', role = 'dialog', onclose, children }: Props = $props();

  let panel: HTMLElement | undefined = $state();

  // A dialog takes the focus when it opens, so the keys go to it and not to the screen behind.
  $effect(() => {
    if (kind === 'window') panel?.focus();
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || onclose === undefined) return;
    event.preventDefault();
    onclose();
  }
</script>

<svelte:window {onkeydown} />

<!-- The blurred stone overlay (#841, ui-style 51): `.stone-overlay` and `.stone-window` in
     src/theme/primitives.css. The blur is the overlay's backdrop, nothing behind is filtered. -->
<div class="stone-overlay">
  {#if kind === 'window'}
    <div
      bind:this={panel}
      class="stone-window rule-frame"
      {role}
      aria-modal="true"
      aria-label={label}
      tabindex="-1"
    >
      {@render children()}
    </div>
  {:else}
    <section class="stone-sheet" aria-label={label}>
      {@render children()}
    </section>
  {/if}
</div>

<style>
  .stone-sheet {
    box-sizing: border-box;
    width: min(1024px, 100%);
    align-self: start;
  }
</style>
