<script lang="ts">
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { ARENA_GAP_EDGE, ARENA_GAP_NODE, ARENA_REACH, PLATE } from '../render/fightFx.ts';
  import { reducedMotion } from '../render/motion.ts';
  import type { HintCoach } from '../tutorial/hintCoach.svelte.ts';
  import type { HintShow } from '../tutorial/hints.ts';
  import {
    centreOf,
    leaderLine,
    placeCard,
    targetRect,
    type Placement,
    type Rect,
    type Target,
  } from '../tutorial/leader.ts';
  import { richText, type Segment } from '../tutorial/rich.ts';
  import RichText from './RichText.svelte';

  interface Props {
    coach: HintCoach;
    map: MapFile;
    anchors: MapAnchors;
  }

  let { coach, map, anchors }: Props = $props();

  /** The room kept under the last notice for the next one, px. */
  const TOAST_ROOM = 52;
  /** The card stands at most this far from its target, px: on a crowded map it may then lie over a far place. */
  const REACH_PX = 260;

  const hint = $derived(coach.current);

  /** The dictionary key of a hint's texts (the CP version of H3 has its own). */
  function keyOf(h: HintShow): string {
    return h.id === 'H3' && h.variant === 'cp' ? 'hint.H3cp' : `hint.${h.id}`;
  }

  const keys = $derived({
    label: (action: Parameters<typeof keyBindings.label>[0]) => keyBindings.label(action),
    shift: t('tutorial.shift'),
  });
  const title = $derived(hint === null ? '' : t(`${keyOf(hint)}.title` as MessageKey));
  const say = $derived<Segment[]>(
    hint === null
      ? []
      : richText(
          tf(keyOf(hint) as MessageKey, {
            node: hint.node === null ? '' : (map.nodes[hint.node]?.name ?? ''),
          }),
          keys,
        ),
  );
  const act = $derived<Segment[]>(
    hint === null || (hint.id !== 'H4' && hint.id !== 'H5')
      ? []
      : richText(t(`hint.${hint.id}.act`), keys),
  );

  // --- Where the card stands (the chapter card's placement, tutorial/leader.ts) ---------------

  let plate: HTMLElement | null = $state(null);
  let host: HTMLElement | null = $state(null);
  let place = $state.raw<Placement | null>(null);
  let leader = $state.raw<{ from: Placement; to: Placement } | null>(null);
  let hudBox = $state.raw<{ x: number; y: number; w: number; h: number } | null>(null);

  function hudRect(piece: string): DOMRect | null {
    const el = document.querySelector(`[data-coach="${piece}"]`);
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function targetNow(h: HintShow): Target | null {
    if (h.hud !== null) {
      const rect = hudRect(h.hud);
      return rect === null
        ? null
        : { kind: 'box', x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    }
    if (h.road !== null) {
      const a = anchors.node(h.road[0]);
      const b = anchors.node(h.road[1]);
      if (a === null || b === null) return null;
      return { kind: 'circle', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 6 };
    }
    const a = h.node === null ? null : anchors.node(h.node);
    if (a === null) return null;
    const wide = h.id === 'H2' || h.id === 'H4';
    return { kind: 'circle', x: a.x, y: a.y, r: a.r + (wide ? 13 : 8) };
  }

  /**
   * The arena of the fight a hint points at (H4): it floats over its place (`render/fightFx.ts`), a
   * part of the place the card must not cover.
   */
  function arenaRect(h: HintShow, target: Target | null): Rect | null {
    if (h.id !== 'H4' || target === null || target.kind !== 'circle') return null;
    const gap = h.road === null ? target.r + ARENA_GAP_NODE : ARENA_GAP_EDGE;
    const x = target.x;
    const y = target.y - gap;
    const w = PLATE.halfWidth + 12;
    const up = PLATE.halfHeight + ARENA_REACH + 12;
    return [x - w, y - up, x + w, y + PLATE.halfHeight + 12];
  }

  /** What the card keeps clear of: every place and its name, the arena, the HUD, open menus. */
  function obstacles(h: HintShow, target: Target | null): Rect[] {
    const out: Rect[] = [];
    for (const node of map.nodes) {
      const a = anchors.node(node.id);
      if (a === null) continue;
      // The place, its badges, the warehouse row and its name under it.
      const r = Math.max(a.r, 16);
      out.push([a.x - r - 26, a.y - r - 16, a.x + r + 26, a.y + r + 46]);
    }
    if (target !== null) out.push(targetRect(target));
    const arena = arenaRect(h, target);
    if (arena !== null) out.push(arena, arena);
    for (const el of document.querySelectorAll(
      '.radial svg, .hud .bar, [data-coach="alerts"] > *, .toasts > *',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push([r.x - 8, r.y - 8, r.right + 8, r.bottom + 8]);
    }
    // The notices and room for the next one (a hint stays 12 s).
    const toasts = document.querySelector('.toasts')?.getBoundingClientRect();
    if (toasts !== undefined && toasts.width > 0) {
      out.push([toasts.x - 8, toasts.y - 8, toasts.right + 8, toasts.bottom + TOAST_ROOM]);
    }
    return out;
  }

  let placedFor = '';
  let lastTarget: Target | null = null;

  function moved(a: Target | null, b: Target | null): boolean {
    if (a === null || b === null) return a !== b;
    const ca = centreOf(a);
    const cb = centreOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y) > 14;
  }

  function frame(): void {
    const h = coach.current;
    if (h === null || plate === null) {
      place = null;
      leader = null;
      hudBox = null;
      return;
    }
    const target = targetNow(h);
    hudBox = target?.kind === 'box' ? { x: target.x, y: target.y, w: target.w, h: target.h } : null;
    const size = { w: plate.offsetWidth, h: plate.offsetHeight };
    // A notice that comes in under the card moves it.
    const notices = document.querySelectorAll('.toasts > *').length;
    const key = `${String(coach.seq)}:${String(notices)}:${String(size.h)}:${String(window.innerWidth)}x${String(window.innerHeight)}`;
    if (key !== placedFor || moved(target, lastTarget) || place === null) {
      placedFor = key;
      lastTarget = target;
      const top = document.querySelector('.hud .bar')?.getBoundingClientRect().bottom ?? 56;
      // The match ends above the legal footer.
      const bottom = host?.getBoundingClientRect().bottom ?? window.innerHeight;
      // Near the target: the least covered spot there, not a free one across the map.
      const c = target === null ? null : centreOf(target);
      const area: Rect =
        c === null
          ? [0, top + 8, window.innerWidth, bottom]
          : [
              Math.max(0, c.x - REACH_PX - size.w),
              Math.max(top + 8, c.y - REACH_PX - size.h),
              Math.min(window.innerWidth, c.x + REACH_PX + size.w),
              Math.min(bottom, c.y + REACH_PX + size.h),
            ];
      place =
        target === null
          ? { x: window.innerWidth - size.w - 24, y: top + 24 }
          : placeCard(target, size, area, obstacles(h, target));
    }
    leader = target === null ? null : leaderLine(target, place, size);
  }

  // The card, its leader and its HUD outline follow the map and the HUD every frame.
  $effect(() => {
    let id = requestAnimationFrame(function loop(): void {
      frame();
      id = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  });

  const leaderLen = $derived(
    leader === null ? 0 : Math.hypot(leader.to.x - leader.from.x, leader.to.y - leader.from.y),
  );
  const lozenge = (x: number, y: number, r: number): string =>
    `M${String(x)} ${String(y - r)}L${String(x + r)} ${String(y)}L${String(x)} ${String(y + r)}L${String(x - r)} ${String(y)}Z`;
</script>

<!-- A hint of the first match (#806, section 5): the chapter card (Leader) without the step
     lozenges, with a close button and "Turn off hints". It never pauses the match; the map rings
     its place (render/coachMarkView.ts), an outline marks a HUD piece. -->
{#if hint !== null}
  <div class="hints" class:still={reducedMotion()} bind:this={host}>
    <svg class="marks" aria-hidden="true">
      {#key coach.seq}
        {#if hudBox !== null}
          {@const x = hudBox.x - 7}
          {@const y = hudBox.y - 7}
          {@const w = hudBox.w + 14}
          {@const h = hudBox.h + 14}
          <g class="hudmark">
            <rect class="glow" x={x - 3} y={y - 3} width={w + 6} height={h + 6} />
            <rect class="casing" {x} {y} width={w} height={h} />
            <rect class="ink" {x} {y} width={w} height={h} />
            {#each [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [cx, cy], k (k)}
              <path class="corner" d={lozenge(cx ?? 0, cy ?? 0, 5)} />
            {/each}
          </g>
        {/if}
        {#if leader !== null && place !== null}
          <path
            class="leadcase"
            style:--len={leaderLen}
            d="M{leader.to.x} {leader.to.y}L{leader.from.x} {leader.from.y}"
          />
          <path
            class="leadline"
            style:--len={leaderLen}
            d="M{leader.to.x} {leader.to.y}L{leader.from.x} {leader.from.y}"
          />
          <path class="leadfoot" d={lozenge(leader.to.x, leader.to.y, 4)} />
        {/if}
      {/key}
    </svg>

    {#key coach.seq}
      <section
        class="plate"
        class:placed={place !== null}
        style:left="{place?.x ?? -9999}px"
        style:top="{place?.y ?? -9999}px"
        aria-live="polite"
        aria-label={tf('hint.kicker', { title })}
        bind:this={plate}
        onpointerenter={() => {
          coach.hold(true);
        }}
        onpointerleave={() => {
          coach.hold(plate?.contains(document.activeElement) ?? false);
        }}
        onfocusin={() => {
          coach.hold(true);
        }}
        onfocusout={(event: FocusEvent) => {
          if (!(plate?.contains(event.relatedTarget as Node | null) ?? false)) coach.hold(false);
        }}
      >
        <span class="pt u"></span><span class="pt d"></span>
        <div class="head">
          <span class="lab">{tf('hint.kicker', { title })}</span>
          <button
            type="button"
            class="x"
            aria-label={t('hint.close')}
            onclick={() => {
              coach.close();
            }}
            ><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
              ><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg
            ></button
          >
        </div>
        <p class="say"><RichText segments={say} /></p>
        {#if act.length > 0}
          <p class="act"><RichText segments={act} /></p>
        {/if}
        <div class="row">
          <button
            type="button"
            class="linkish"
            onclick={() => {
              coach.turnOff();
            }}>{t('hint.off')}</button
          >
        </div>
      </section>
    {/key}
  </div>
{/if}

<style>
  /* Over the radial menus (21), like the chapter coach; under the result (25). */
  .hints {
    position: absolute;
    inset: 0;
    z-index: 22;
    pointer-events: none;
    color: var(--ink);
    font-family: var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  .marks {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  /* --- The HUD outline (Compass on the HUD) ---------------------------------------------------- */
  .hudmark .glow {
    fill: none;
    stroke: rgb(236 228 209 / 45%);
    stroke-width: 6;
    filter: blur(4px);
    animation: breathe 2.4s var(--ease-engrave) 4 alternate both;
  }

  .hudmark .casing {
    fill: none;
    stroke: var(--casing);
    stroke-width: 4;
  }

  .hudmark .ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }

  .corner {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1.2;
  }

  @keyframes breathe {
    from {
      opacity: 0.25;
    }
    to {
      opacity: 0.85;
    }
  }

  /* --- The leader ------------------------------------------------------------------------------ */
  .leadline {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.2;
    stroke-dasharray: var(--len);
    stroke-dashoffset: var(--len);
    animation: rule-in 0.16s linear 0.05s forwards;
  }

  .leadcase {
    fill: none;
    stroke: var(--casing);
    stroke-width: 3.4;
    opacity: 0.85;
    stroke-dasharray: var(--len);
    stroke-dashoffset: var(--len);
    animation: rule-in 0.16s linear 0.05s forwards;
  }

  .leadfoot {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
    opacity: 0;
    animation: ink 0.1s linear 0.05s forwards;
  }

  @keyframes rule-in {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes ink {
    to {
      opacity: 1;
    }
  }

  /* --- The plate (Leader) ---------------------------------------------------------------------- */
  .plate {
    position: absolute;
    box-sizing: border-box;
    width: 330px;
    max-width: calc(100vw - 32px);
    padding: 12px 15px;
    border: 1px solid rgb(236 228 209 / 60%);
    background: rgb(14 12 9 / 95%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 95%),
      inset 0 0 0 4px rgb(236 228 209 / 25%),
      0 14px 34px rgb(0 0 0 / 55%);
    color: var(--ink);
    pointer-events: auto;
    visibility: hidden;
  }

  .plate.placed {
    visibility: visible;
    /* The burin cuts it in from the left. */
    mask-image: linear-gradient(90deg, #000 0 63.3%, transparent 70%);
    mask-size: 300% 100%;
    mask-position: 100% 0;
    mask-repeat: no-repeat;
    animation: burin 0.55s var(--ease-engrave) 0.2s forwards;
  }

  @keyframes burin {
    to {
      mask-position: 45% 0;
    }
  }

  .pt {
    position: absolute;
    left: 0;
    width: 5px;
    height: 5px;
    margin-left: -3px;
    background: var(--ink);
    box-shadow: 0 0 0 1px var(--casing);
    transform: rotate(45deg);
    opacity: 0;
  }

  .placed .pt {
    animation: point 0.55s var(--ease-engrave) 0.2s both;
  }

  .pt.u {
    top: -3px;
  }

  .pt.d {
    bottom: -3px;
  }

  @keyframes point {
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

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 7px;
  }

  .lab {
    margin: 0;
    font: 500 10.5px/1.3 var(--font-display);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-dim);
    white-space: nowrap;
  }

  .x {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: -4px -6px -4px 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-dim);
    cursor: pointer;
  }

  .x path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .x:hover {
    color: var(--ink);
  }

  .say {
    margin: 0;
    font: 500 17.5px/1.32 var(--font-text);
    text-wrap: pretty;
  }

  .act {
    margin: 8px 0 0;
    font: italic 500 15.5px/1.45 var(--font-text);
    color: var(--ink-soft);
    text-wrap: pretty;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid var(--line);
  }

  .linkish {
    border: 0;
    background: none;
    padding: 0;
    color: var(--ink-soft);
    font: italic 500 15px/1.2 var(--font-text);
    text-decoration: underline;
    text-decoration-color: var(--rule);
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .linkish:hover {
    color: var(--ink);
  }

  .x:focus-visible,
  .linkish:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* "Less motion" (#871): the card is there at once, the outline holds still. */
  .still .plate.placed,
  .still .placed .pt,
  .still .leadline,
  .still .leadcase,
  .still .leadfoot,
  .still .hudmark .glow {
    animation: none;
    mask-image: none;
    stroke-dashoffset: 0;
    opacity: 1;
  }

  .still .hudmark .glow {
    opacity: 0.6;
  }

  .still .placed .pt {
    opacity: 0;
  }
</style>
