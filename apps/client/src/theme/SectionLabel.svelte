<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The heading level or plain text the label is. */
    as?: 'h2' | 'h3' | 'h4' | 'p' | 'span';
    /** The doubled rule after the label to the end of the line (a section head). */
    rule?: boolean;
    id?: string;
    class?: string;
    children: Snippet;
  }

  let { as = 'h3', rule = true, id, class: extra, children }: Props = $props();
</script>

<!-- A label in cut capitals (#841): `.lapis-label` and `.lapis-section` in src/theme/primitives.css. -->
<svelte:element this={as} {id} class={['lapis-label', rule && 'lapis-section', extra]}>
  {@render children()}
</svelte:element>
