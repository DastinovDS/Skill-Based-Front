<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLElement> {
    /** The element to render. */
    as?: 'div' | 'section' | 'aside' | 'article' | 'form' | 'nav' | 'header' | 'footer';
    /** A stone panel under the frame (`.stone-panel`); off for a frame round a picture. */
    stone?: boolean;
    children: Snippet;
  }

  let { as = 'div', stone = true, class: extra, children, ...rest }: Props = $props();
</script>

<!-- The Double rule frame (#841, ui-style 56 II): `.rule-frame` in src/theme/primitives.css. -->
<svelte:element this={as} class={['rule-frame', stone && 'stone-panel', extra]} {...rest}>
  {@render children()}
</svelte:element>
