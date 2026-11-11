<script lang="ts">
  import { reducedMotion } from '../render/motion.ts';
  import { DRAW_NODES, DRAW_TRAIL, drawTimes } from './play.ts';

  interface Props {
    /** Width in px; the sketch keeps its 220 x 124 proportions. */
    width: number;
    /** The finished sketch, no burin (the map is there, or a dialog shows it as a picture). */
    still?: boolean;
    /**
     * The finished sketch waits for somebody (the invite's friend): the empty seat's capital breathes
     * slowly, the one quiet motion of the wait (#945). Only with `still`; the drawing has its own.
     */
    waiting?: boolean;
  }

  let { width, still = false, waiting = false }: Props = $props();

  /** One loop of the drawing, ms: the burin draws for 78 % of it, the sketch holds, then fades. */
  const LOOP_MS = 3600;
  const DRAW = 0.78;
  const path = `M${DRAW_TRAIL.map((i) => (DRAW_NODES[i] ?? [0, 0]).join(' ')).join(' L')}`;
  /** The two capitals: the own at the first node, the opponent's at the last (#919 mockup). */
  const CAPITALS = new Map([
    [0, 'own'],
    [9, 'enemy'],
  ]);

  let svg: SVGSVGElement | undefined = $state();

  // The burin runs along the trail, the roads ink in behind it and every place sets (a small
  // overshoot) when the burin first reaches it; each place grows round its own node
  // (`transform-box: view-box`, the origin at the node), so a dot never leaves its node.
  // `still` can turn on while the sketch is up (the map came): the effect then cancels the loop and
  // the finished sketch, the plain drawing without any animation, stays (#945).
  $effect(() => {
    // No Web Animations (a test DOM): the sketch stands still.
    if (still || svg === undefined || typeof svg.animate !== 'function' || reducedMotion()) {
      return undefined;
    }
    const loop: KeyframeAnimationOptions = {
      duration: LOOP_MS,
      iterations: Infinity,
      easing: 'linear',
    };
    const running: Animation[] = [];
    for (const road of svg.querySelectorAll('.rc, .ri')) {
      running.push(
        road.animate(
          [
            { strokeDasharray: '1 1', strokeDashoffset: 1, opacity: 1 },
            { strokeDashoffset: 0, opacity: 1, offset: DRAW },
            { strokeDashoffset: 0, opacity: 1, offset: 0.9 },
            { strokeDasharray: '1 1', strokeDashoffset: 0, opacity: 0 },
          ],
          loop,
        ),
      );
    }
    const burin = svg.querySelector('.bu');
    if (burin !== null) {
      running.push(
        burin.animate(
          [
            { offsetDistance: '0%', opacity: 1 },
            { offsetDistance: '100%', opacity: 1, offset: DRAW },
            { offsetDistance: '100%', opacity: 0, offset: 0.86 },
            { offsetDistance: '100%', opacity: 0 },
          ],
          loop,
        ),
      );
    }
    const times = drawTimes(DRAW);
    for (const place of svg.querySelectorAll<SVGElement>('[data-n]')) {
      const at = times[Number(place.dataset['n'])] ?? 0;
      const frames: Keyframe[] = [{ transform: 'scale(0)', offset: 0 }];
      if (at > 0) frames.push({ transform: 'scale(0)', offset: at });
      frames.push(
        { transform: 'scale(1.35)', offset: Math.min(0.95, at + 0.03) },
        { transform: 'scale(1)', opacity: 1, offset: Math.min(0.96, at + 0.07) },
        { transform: 'scale(1)', opacity: 1, offset: 0.9 },
        { transform: 'scale(1)', opacity: 0, offset: 1 },
      );
      running.push(place.animate(frames, loop));
    }
    return () => {
      for (const animation of running) animation.cancel();
    };
  });
</script>

<!-- "Drawing the map..." (#919): a burin draws the roads of a new map, the places set as it reaches
     them. Decorative: the words beside it say what happens. -->
<svg
  bind:this={svg}
  class="draw"
  class:still
  class:waiting={still && waiting}
  {width}
  height={Math.round((width * 124) / 220)}
  viewBox="0 0 220 124"
  aria-hidden="true"
  focusable="false"
>
  <path class="rc" pathLength="1" d={path} />
  <path class="ri" pathLength="1" d={path} />
  {#each DRAW_NODES as [x, y], n (n)}
    {@const capital = CAPITALS.get(n)}
    {#if capital !== undefined}
      <g class="capn {capital}" data-n={n} style:transform-origin="{x}px {y}px">
        <circle cx={x} cy={y} r="7" class="cas" />
        <circle cx={x} cy={y} r="5.4" class="dot" />
      </g>
    {:else}
      <circle
        class="nd"
        data-n={n}
        style:transform-origin="{x}px {y}px"
        cx={x}
        cy={y}
        r={n === 3 || n === 6 ? 4 : 3}
      />
    {/if}
  {/each}
  {#if !still}
    <path class="bu" d="M0 -4 4 0 0 4 -4 0Z" style:offset-path="path('{path}')" />
  {/if}
</svg>

<style>
  .draw {
    display: block;
    flex: none;
    overflow: visible;
  }

  .rc {
    fill: none;
    stroke: var(--casing);
    stroke-width: 4.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.9;
  }

  .ri {
    fill: none;
    stroke: #ccc0a6;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nd {
    fill: var(--plate);
    stroke: #ccc0a6;
    stroke-width: 1.3;
  }

  /* Every place grows round its own node: the box is the view box, the origin the node. */
  [data-n] {
    transform-box: view-box;
  }

  .cas {
    fill: var(--casing);
  }

  .dot {
    stroke: #ccc0a6;
    stroke-width: 1;
  }

  .own .dot {
    fill: var(--own);
  }

  .enemy .dot {
    fill: var(--enemy);
  }

  /* The wait for a friend (#945): the empty seat's capital breathes, slowly, in step with the
     dashed helmet of the versus line (VersusLine, the same 3.2 s). The motion setting of the page
     decides (#871). */
  .waiting .capn.enemy .dot {
    animation: seat-wait 3.2s ease-in-out infinite;
  }

  @keyframes seat-wait {
    0%,
    100% {
      opacity: 0.4;
    }

    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .waiting .capn.enemy .dot {
      animation: none;
    }
  }

  :global(:root[data-motion='reduced']) .waiting .capn.enemy .dot {
    animation: none;
  }

  .bu {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
    offset-rotate: 0deg;
  }
</style>
