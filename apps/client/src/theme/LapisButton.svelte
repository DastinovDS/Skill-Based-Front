<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    /** `primary`: the ivory tablet (one per screen); `secondary`: two rules, no fill. */
    variant?: 'primary' | 'secondary';
    /** `sm` 34 px, `md` 46 px (primary 50 px), `lg` the 96 px Play button. */
    size?: 'sm' | 'md' | 'lg';
    /** A destructive secondary action (forfeit, leave): the opponent red and its own outline. */
    danger?: boolean;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    danger = false,
    type = 'button',
    class: extra,
    children,
    ...rest
  }: Props = $props();
</script>

<!-- A Lapis button (#841): `.lapis-btn` in src/theme/primitives.css. -->
<button
  {type}
  class={[
    'lapis-btn',
    variant,
    size !== 'md' && size,
    danger && variant === 'secondary' && 'danger',
    extra,
  ]}
  {...rest}
>
  {@render children()}
</button>
