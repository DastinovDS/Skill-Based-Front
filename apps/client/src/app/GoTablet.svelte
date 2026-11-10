<script lang="ts">
  import { untrack } from 'svelte';
  import { reducedMotion } from '../render/motion.ts';

  interface Props {
    /** The word on the tablet (Search, Start, Get the link, Play, Ready, Return). */
    word: string;
    disabled?: boolean;
    /** The narrower tablet of a found pair and a joined invite (two thirds wide). */
    short?: boolean;
    onclick?: () => void;
    keys?: string;
  }

  let { word, disabled = false, short = false, onclick, keys }: Props = $props();

  // A new word rolls in from below while the old one rolls out above (#919, item 8); under
  // reduced motion it is simply replaced. The tablet is sized for the longest word, so its
  // width never changes.
  let shown = $state(untrack(() => word));
  let next = $state<string | null>(null);

  $effect(() => {
    const want = word;
    untrack(() => {
      if (want === shown && next === null) return;
      if (reducedMotion()) {
        shown = want;
        next = null;
      } else {
        next = want;
      }
    });
  });

  function settle(): void {
    if (next === null) return;
    shown = next;
    next = null;
  }
</script>

<!-- The one main button of the plinth: the ivory tablet with its inner rule. -->
<button
  type="button"
  class="lapis-btn primary go"
  class:short
  aria-keyshortcuts={keys}
  {disabled}
  {onclick}
>
  <span class="roll" class:rolling={next !== null}>
    <span class="r0" aria-hidden={next !== null}>{shown}</span>
    {#if next !== null}
      {#key next}
        <span class="r1" onanimationend={settle}>{next}</span>
      {/key}
    {/if}
  </span>
</button>

<style>
  .go.lapis-btn {
    flex: none;
    width: var(--gow);
    height: var(--goh);
    padding: 0 24px;
    font-size: var(--gof);
    letter-spacing: 0.2em;
  }

  .go.lapis-btn.short {
    width: calc(var(--gow) * 0.66);
  }

  .roll {
    position: relative;
    display: inline-block;
    height: 1.2em;
    overflow: hidden;
    vertical-align: middle;
  }

  .roll span {
    display: block;
    line-height: 1.2em;
    white-space: nowrap;
  }

  .r1 {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
  }

  .rolling .r0 {
    animation: roll-out 0.42s var(--ease-travel) forwards;
  }

  .rolling .r1 {
    animation: roll-in 0.42s var(--ease-travel) forwards;
  }

  @keyframes roll-out {
    to {
      transform: translateY(-100%);
      opacity: 0;
    }
  }

  @keyframes roll-in {
    from {
      opacity: 0;
    }

    to {
      transform: translate(-50%, -100%);
      opacity: 1;
    }
  }
</style>
