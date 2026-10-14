<script lang="ts">
  import type { ThreatKind, ThreatLog } from '../match/threats.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { reducedMotion } from '../render/motion.ts';
  import { arcPath, arcRadius, arrowPoints, centreOf, offscreenAngle } from './edgeLayout.ts';

  interface Props {
    threats: ThreatLog;
    /** Where the cities are on screen (client px). */
    anchors: MapAnchors;
    /** The height the top bar covers: the arcs keep to the map below it. */
    top: number;
  }

  let { threats, anchors, top }: Props = $props();

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Most arcs at once. */
  const MAX_ARCS = 6;
  /** An arc of an event fades out over its last ms. */
  const FADE_MS = 1500;
  const PULSE_MS = 900;
  /** The kinds in the order of importance: one arc per city, the worst news wins. */
  const RANK: Record<ThreatKind, number> = { captured: 0, attack: 1, incoming: 2 };

  let svg: SVGSVGElement | undefined = $state();

  interface ArcShape {
    readonly group: SVGGElement;
    readonly path: SVGPathElement;
    readonly head: SVGPolygonElement;
  }

  $effect(() => {
    const root = svg;
    if (root === undefined) return undefined;
    // The arcs are made once and moved every frame through attributes: the camera moves per
    // frame, and a reactive list would be rebuilt 60 times a second.
    const pool: ArcShape[] = [];
    for (let i = 0; i < MAX_ARCS; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      const path = document.createElementNS(SVG_NS, 'path');
      const head = document.createElementNS(SVG_NS, 'polygon');
      group.append(path, head);
      group.setAttribute('visibility', 'hidden');
      root.append(group);
      pool.push({ group, path, head });
    }

    function frame(now: number): void {
      const box = root?.getBoundingClientRect();
      if (box === undefined) return;
      const view = { left: box.left, top: box.top + top, right: box.right, bottom: box.bottom };
      const middle = centreOf(view);
      const radius = arcRadius(view);
      // One arc per city: the worst kind of news about it.
      const worst: { node: number; kind: ThreatKind; left: number | null }[] = [];
      for (const { threat, left } of threats.active()) {
        const known = worst.find((w) => w.node === threat.node);
        if (known === undefined) worst.push({ node: threat.node, kind: threat.kind, left });
        else if (RANK[threat.kind] < RANK[known.kind]) {
          known.kind = threat.kind;
          known.left = left;
        }
      }
      const reduced = reducedMotion();
      let used = 0;
      for (const { node, kind, left } of worst) {
        const shape = pool[used];
        const spot = anchors.node(node);
        if (shape === undefined || spot === null) continue;
        const angle = offscreenAngle(view, spot);
        if (angle === null) continue;
        used++;
        shape.path.setAttribute('d', arcPath(middle, radius, angle));
        shape.head.setAttribute('points', arrowPoints(middle, radius, angle));
        shape.group.setAttribute('class', `arc ${kind}`);
        const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin((2 * Math.PI * now) / PULSE_MS);
        const fade = left === null ? 1 : Math.min(1, left / FADE_MS);
        shape.group.setAttribute('opacity', String((kind === 'incoming' ? 0.9 : pulse) * fade));
        shape.group.setAttribute('visibility', 'visible');
      }
      for (let i = used; i < pool.length; i++) pool[i]?.group.setAttribute('visibility', 'hidden');
    }

    let handle = 0;
    const loop = (now: number): void => {
      frame(now);
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(handle);
      for (const { group } of pool) group.remove();
    };
  });
</script>

<!-- Arcs at the edge of the screen: a city of mine outside the view is taken, fought in, or marched
     on (UI round 2). Decoration for the eyes; the words are the toasts and the alert rows. -->
<svg class="edge-alerts" bind:this={svg} aria-hidden="true"></svg>

<style>
  .edge-alerts {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    overflow: visible;
    pointer-events: none;
  }

  /* The shapes are made in the script: no scope class on them. A solid arc is news (taken, fought
     in), a dashed one a threat (a planned order aims at the city): the kind reads without colour. */
  .edge-alerts :global(.arc path) {
    fill: none;
    stroke: var(--warn);
    stroke-width: 8;
    stroke-linecap: round;
  }

  .edge-alerts :global(.arc polygon) {
    fill: var(--warn);
    stroke: var(--bg);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .edge-alerts :global(.arc.captured path) {
    stroke-width: 11;
  }

  .edge-alerts :global(.arc.incoming path) {
    stroke-dasharray: 3 9;
    stroke-linecap: butt;
  }
</style>
