<script lang="ts">
  interface Props {
    /**
     * `shot`: a real shot (a filled disc); `bonus`: a virtual one, from a bonus or the terrain (an
     * empty diamond); `spent`: charges that left the units (a bolt); `unit`: units killed (the
     * inverted triangle of ui-style 9.5). The shape says it, not the colour.
     */
    kind: 'shot' | 'bonus' | 'spent' | 'unit';
  }

  let { kind }: Props = $props();
</script>

<!-- Decorative: the numbers beside it and the label of the cell say it in words. -->
<svg class="glyph {kind}" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
  {#if kind === 'shot'}
    <circle cx="5" cy="5" r="3.6" fill="currentColor" />
  {:else if kind === 'bonus'}
    <path d="M5 1 9 5 5 9 1 5Z" fill="none" stroke="currentColor" stroke-width="1.5" />
  {:else if kind === 'spent'}
    <path d="M5.8 0.5 1.6 5.6H4.6L4.2 9.5 8.4 4.4H5.4Z" fill="currentColor" />
  {:else}
    <path d="M1 1.5h8L5 9z" fill="currentColor" />
  {/if}
</svg>

<style>
  .glyph {
    flex: none;
    display: block;
  }
</style>
