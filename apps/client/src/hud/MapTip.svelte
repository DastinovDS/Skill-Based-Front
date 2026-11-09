<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { reducedMotion } from '../render/motion.ts';
  import { DURATION } from '../theme/tokens.ts';
  import { tipPlacement } from './tipPlace.ts';

  interface Props {
    /** What the pointer rests on (a group id, a road id); `null`: nothing, no tip. */
    identity: string | number | null;
    /** The content of the tip. */
    children: Snippet;
  }

  let { identity, children }: Props = $props();

  // The pointer must rest on the subject this long before the tip shows (the unit card of
  // ui-style 55r and 57r: 120 ms).
  const DELAY_MS = DURATION.revealHover;

  let shown = $state(false);
  // `bind:this` sets `null` when the tip unmounts, and a pointer move can still arrive before the next effect.
  let box: HTMLElement | null | undefined = $state();
  let leader: SVGLineElement | null | undefined = $state();
  let foot: SVGPathElement | null | undefined = $state();
  // The pointer position is plain data: it moves the box through the CSSOM, not through state.
  let pointer = { x: 0, y: 0 };
  let overMap = false;

  /**
   * Leader (ui-style 54q): the tag stands off the object and a ruled leader ties it to the point
   * the pointer rests on; the box and the leader move through the CSSOM.
   */
  function place(): void {
    if (box === undefined || box === null) return;
    const spot = tipPlacement(
      pointer,
      { width: box.offsetWidth, height: box.offsetHeight },
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    box.style.left = `${String(spot.left)}px`;
    box.style.top = `${String(spot.top)}px`;
    // The leader runs in the box's own coordinates, from its foot to the object.
    const ax = pointer.x - spot.left;
    const ay = pointer.y - spot.top;
    leader?.setAttribute('x1', String(spot.foot.x));
    leader?.setAttribute('y1', String(spot.foot.y));
    leader?.setAttribute('x2', String(ax));
    leader?.setAttribute('y2', String(ay));
    foot?.setAttribute('transform', `translate(${String(ax)} ${String(ay)})`);
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

  const still = reducedMotion();
</script>

<svelte:window onpointermove={onMove} />

<!-- A tag by the object under the pointer on the map: the charges of a group, what a click gives.
     It comes in by the Burin reveal (ui-style 57r) and fades out (160 ms; 100 ms with less motion). -->
{#if shown && identity !== null}
  <div
    class="tip"
    class:burin={!still}
    class:still
    role="tooltip"
    bind:this={box}
    out:fade={{ duration: still ? DURATION.revealReduced : DURATION.revealOut }}
  >
    <svg class="leader" aria-hidden="true">
      <line class="leader-casing" bind:this={leader} pathLength="1" />
      <path class="leader-foot" d="M0 -2.5L2.5 0L0 2.5L-2.5 0Z" bind:this={foot} />
    </svg>
    <div class="plate">
      {@render children()}
    </div>
    <span class="point upper" aria-hidden="true"></span>
    <span class="point lower" aria-hidden="true"></span>
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 8;
    pointer-events: none;
  }

  /* The ruled leader from the tag's foot to the object, on a dark casing. */
  .leader {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
  }

  .leader-casing {
    stroke: var(--ink);
    stroke-width: 1;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }

  .leader-foot {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
  }

  /* The tag: a dark plate in a double rule (one rule, a dark gap, a faint inner rule). */
  .plate {
    position: relative;
    padding: 6px 10px;
    border: 1px solid rgb(236 228 209 / 60%);
    background: rgb(14 12 9 / 94%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 94%),
      inset 0 0 0 4px rgb(236 228 209 / 25%);
    color: var(--ink);
    font: 500 15px/1.3 var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  /* Burin (ui-style 57r, slowed by the owner to about 550 ms): the leader is ruled out first, then
     a burin point runs along the top and bottom rules from left to right and the plate and its
     items ink in just behind it (a soft edge about a quarter of the tag wide). */
  .burin .leader-casing {
    animation: rule-leader var(--t-reveal-leader) linear both;
  }

  .burin .leader-foot {
    animation: ink-in var(--t-reveal-leader) linear both;
  }

  .burin .plate {
    /* The mask is twice the tag wide, its soft edge at its middle: from 100 % to -10 % the edge
       runs from the tag's left to just past its right, in step with the points (0 to 110 %). */
    mask-image: linear-gradient(90deg, #000 0 45%, transparent 55%);
    mask-size: 200% 100%;
    mask-position: -10% 0;
    mask-repeat: no-repeat;
    animation: burin-cut calc(var(--t-reveal-in) - var(--t-reveal-leader)) var(--ease-engrave)
      var(--t-reveal-leader) both;
  }

  .point {
    display: none;
  }

  .burin .point {
    position: absolute;
    left: 0;
    display: block;
    width: 5px;
    height: 5px;
    margin-left: -3px;
    background: var(--ink);
    box-shadow: 0 0 0 1px var(--casing);
    transform: rotate(45deg);
    animation: burin-point calc(var(--t-reveal-in) - var(--t-reveal-leader)) var(--ease-engrave)
      var(--t-reveal-leader) both;
  }

  .point.upper {
    top: -3px;
  }

  .point.lower {
    bottom: -3px;
  }

  .still {
    animation: ink-in var(--t-reveal-reduced) linear both;
  }

  @keyframes rule-leader {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes ink-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes burin-cut {
    from {
      mask-position: 100% 0;
    }
    to {
      mask-position: -10% 0;
    }
  }

  /* The point rides the cut and lifts off at the right end. */
  @keyframes burin-point {
    0% {
      left: 0;
      opacity: 1;
    }
    88% {
      opacity: 1;
    }
    100% {
      left: 110%;
      opacity: 0;
    }
  }
</style>
