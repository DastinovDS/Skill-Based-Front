<script lang="ts">
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';
  import { DICTIONARIES, getLocale, t, tf, type MessageKey } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { HudPiece, MapFile } from '../protocol.gen.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { reducedMotion } from '../render/motion.ts';
  import { turnPhase } from '../render/coachMarks.ts';
  import { nodeNamed } from '../tutorial/chapters.ts';
  import type { TutorialCoach } from '../tutorial/coach.svelte.ts';
  import {
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
    coach: TutorialCoach;
    /** The chapter's kicker in the card's head ("I · Units and movement"). */
    kicker: string;
    map: MapFile;
    orders: OrderController;
    anchors: MapAnchors;
  }

  let { coach, kicker, map, orders, anchors }: Props = $props();

  const view = $derived(coach.current);
  const card = $derived(view.card);
  const slide = $derived(coach.slide);
  const lastSlide = $derived(card === null || slide >= card.slides - 1);

  /** A dictionary key that may be missing (an optional action line). */
  function has(key: string): key is MessageKey {
    return Object.hasOwn(DICTIONARIES[getLocale()], key);
  }

  const keys = $derived({
    label: (action: Parameters<typeof keyBindings.label>[0]) => keyBindings.label(action),
    shift: t('tutorial.shift'),
  });

  const sayKey = $derived(
    card === null ? null : card.slides > 1 ? `${card.key}.${String(slide + 1)}` : card.key,
  );
  const say = $derived<Segment[]>(sayKey !== null && has(sayKey) ? richText(t(sayKey), keys) : []);
  const actKey = $derived(card === null ? null : `${card.key}.act`);
  const act = $derived<Segment[]>(
    actKey !== null && lastSlide && has(actKey) ? richText(t(actKey), keys) : [],
  );

  // The marks in turn (I.7): the word of the terrain whose places are ringed is underlined, then
  // all of them stay underlined, dimmer. The clock is the card's (`view.seq`).
  let shownAt = $state(0);
  let now = $state(0);
  let seenSeq = -1;
  $effect(() => {
    if (view.seq === seenSeq) return;
    seenSeq = view.seq;
    shownAt = performance.now();
    now = shownAt;
  });
  const turns = $derived(card?.turns ?? null);
  $effect(() => {
    if (turns === null || reducedMotion()) return undefined;
    const timer = setInterval(() => {
      now = performance.now();
    }, 200);
    const stop = setTimeout(() => {
      clearInterval(timer);
      now = performance.now();
    }, 6500);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  });
  const phase = $derived(
    turns === null ? null : turnPhase(now - shownAt, turns.length, reducedMotion()),
  );
  function turnOf(word: string): number {
    return turns?.findIndex((turn) => turn.word === word.toLowerCase()) ?? -1;
  }

  // --- Where the card stands -----------------------------------------------------------------

  let plate: HTMLElement | null = $state(null);
  let place = $state.raw<Placement | null>(null);
  let leader = $state.raw<{ from: Placement; to: Placement } | null>(null);
  /** HUD outlines and menu-item rings, in client px. */
  let hudBoxes = $state.raw<{ piece: HudPiece; x: number; y: number; w: number; h: number }[]>([]);
  let itemRings = $state.raw<{ x: number; y: number; r: number }[]>([]);

  /** The rectangle of a HUD piece the card marks, client px; null: not on screen. */
  function hudRect(piece: HudPiece): DOMRect | null {
    const host = document.querySelector(`[data-coach="${piece}"]`);
    const el = piece === 'alerts' ? (host?.firstElementChild ?? null) : host;
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  /** The ring of a marked menu item while its menu is open, client px. */
  function itemRing(item: string): { x: number; y: number; r: number } | null {
    const el = document.querySelector(`.radial [data-coach-menu="${item}"] .glyph`);
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, r: 16 };
  }

  /** The target of the card: its first mark on screen. */
  function targetNow(): Target | null {
    const marks = card?.marks ?? [];
    for (const mark of marks) {
      if (mark.hud != null) {
        const rect = hudRect(mark.hud);
        if (rect !== null) {
          return { kind: 'box', x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        }
        continue;
      }
      if (mark.menu != null && mark.at != null) {
        const node = nodeNamed(map, mark.at);
        const open = orders.cityMenu.current;
        if (node !== undefined && open.open && open.target === node) {
          const ring = itemRing(mark.menu);
          if (ring !== null) return { kind: 'circle', ...ring };
        }
        const a = node === undefined ? null : anchors.node(node);
        if (a !== null) return { kind: 'circle', x: a.x, y: a.y, r: a.r + 8 };
        continue;
      }
      if (mark.road != null) {
        const a = nodeNamed(map, mark.road[0]);
        const b = nodeNamed(map, mark.road[1]);
        const pa = a === undefined ? null : anchors.node(a);
        const pb = b === undefined ? null : anchors.node(b);
        if (pa !== null && pb !== null) {
          return { kind: 'circle', x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, r: 6 };
        }
        continue;
      }
      const name = mark.node ?? mark.group ?? mark.vp_badge ?? null;
      const node = name === null ? undefined : nodeNamed(map, name);
      const a = node === undefined ? null : anchors.node(node);
      if (a !== null)
        return { kind: 'circle', x: a.x, y: a.y, r: a.r + (mark.ring === true ? 13 : 8) };
    }
    return null;
  }

  /** What the card keeps clear of: every place and its name, the marks, the HUD, open menus. */
  function obstacles(target: Target | null): Rect[] {
    const out: Rect[] = [];
    for (const node of map.nodes) {
      const a = anchors.node(node.id);
      if (a === null) continue;
      const r = Math.max(a.r, 16);
      out.push([a.x - r - 22, a.y - r - 14, a.x + r + 22, a.y + r + 30]);
    }
    if (target !== null) out.push(targetRect(target));
    for (const box of hudBoxes)
      out.push([box.x - 14, box.y - 14, box.x + box.w + 14, box.y + box.h + 14]);
    for (const el of document.querySelectorAll(
      '.radial svg, .hud .bar, [data-coach="alerts"] > *',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push([r.x - 8, r.y - 8, r.right + 8, r.bottom + 8]);
    }
    if (view.paused) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      out.push([w / 2 - 120, h - 96, w / 2 + 120, h - 40]);
    }
    return out;
  }

  let placedFor = '';
  let lastTarget: Target | null = null;

  function moved(a: Target | null, b: Target | null): boolean {
    if (a === null || b === null) return a !== b;
    const ca = a.kind === 'circle' ? [a.x, a.y] : [a.x + a.w / 2, a.y + a.h / 2];
    const cb = b.kind === 'circle' ? [b.x, b.y] : [b.x + b.w / 2, b.y + b.h / 2];
    return Math.hypot((ca[0] ?? 0) - (cb[0] ?? 0), (ca[1] ?? 0) - (cb[1] ?? 0)) > 14;
  }

  function frame(): void {
    // The HUD outlines and the ring of a marked menu item follow their element.
    const pieces = coach.hudMarks();
    hudBoxes = pieces
      .map((piece) => {
        const r = hudRect(piece);
        return r === null ? null : { piece, x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const open = orders.cityMenu.current;
    itemRings = coach
      .menuMarks()
      .filter((m) => open.open && open.target === m.node)
      .map((m) => itemRing(m.item))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const target = targetNow();
    if (plate === null || card === null) {
      place = null;
      leader = null;
      return;
    }
    const size = { w: plate.offsetWidth, h: plate.offsetHeight };
    const key = `${String(view.seq)}:${String(slide)}:${String(size.h)}:${String(view.paused)}:${String(window.innerWidth)}x${String(window.innerHeight)}`;
    if (key !== placedFor || moved(target, lastTarget) || place === null) {
      placedFor = key;
      lastTarget = target;
      const top = document.querySelector('.hud .bar')?.getBoundingClientRect().bottom ?? 56;
      const area: Rect = [0, top + 8, window.innerWidth, window.innerHeight];
      place =
        target === null
          ? { x: window.innerWidth - size.w - 24, y: top + 24 }
          : placeCard(target, size, area, obstacles(target));
    }
    leader = target === null ? null : leaderLine(target, place, size);
  }

  // The card, its leader and the HUD outlines follow the map and the HUD every frame.
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
  const stepsLabel = $derived(
    card === null ? '' : tf('tutorial.card.steps', { n: card.step, total: card.steps }),
  );
  const lozenge = (x: number, y: number, r: number): string =>
    `M${String(x)} ${String(y - r)}L${String(x + r)} ${String(y)}L${String(x)} ${String(y + r)}L${String(x - r)} ${String(y)}Z`;
</script>

<div class="coach" class:still={reducedMotion()}>
  <!-- The HUD outlines (Compass on the HUD: an outline with corner lozenges) and the ring of a
       marked menu item; the marks of places are the map's (render/coachMarkView.ts). -->
  <svg class="marks" aria-hidden="true">
    {#each hudBoxes as box (box.piece)}
      {@const x = box.x - 7}
      {@const y = box.y - 7}
      {@const w = box.w + 14}
      {@const h = box.h + 14}
      <g class="hudmark">
        <rect class="glow" x={x - 3} y={y - 3} width={w + 6} height={h + 6} />
        <rect class="casing" {x} {y} width={w} height={h} />
        <rect class="ink" {x} {y} width={w} height={h} />
        {#each [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [cx, cy], k (k)}
          <path class="corner" d={lozenge(cx ?? 0, cy ?? 0, 5)} />
        {/each}
      </g>
    {/each}
    {#each itemRings as ring, k (k)}
      <g class="itemmark">
        <circle class="casing" cx={ring.x} cy={ring.y} r={ring.r + 9} />
        <circle class="ink" cx={ring.x} cy={ring.y} r={ring.r + 9} />
        <circle class="casing thin" cx={ring.x} cy={ring.y} r={ring.r + 15} />
        <circle class="dash" cx={ring.x} cy={ring.y} r={ring.r + 15} />
      </g>
    {/each}
    {#if card !== null && leader !== null && place !== null}
      {#key view.seq}
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
      {/key}
    {/if}
  </svg>

  {#if card !== null}
    {#key view.seq}
      <section
        class="plate"
        class:placed={place !== null}
        style:left="{place?.x ?? -9999}px"
        style:top="{place?.y ?? -9999}px"
        aria-live="polite"
        bind:this={plate}
      >
        <span class="pt u"></span><span class="pt d"></span>
        <div class="head">
          <span class="lab">{kicker}</span>
          {#if card.fail}
            <span class="lab again">{t('tutorial.card.tryAgain')}</span>
          {:else}
            <span class="steps" role="img" aria-label={stepsLabel}>
              {#each [...Array(card.steps).keys()] as i (i)}
                <span class="lz" class:on={i + 1 < card.step} class:now={i + 1 === card.step}
                ></span>
              {/each}
            </span>
          {/if}
        </div>
        <p class="say"><RichText segments={say} {turnOf} {phase} /></p>
        {#if act.length > 0}
          {#key coach.pulse}
            <p class="act" class:pulse={coach.pulse > 0}><RichText segments={act} /></p>
          {/key}
        {/if}
        {#if card.slides > 1}
          <div class="row slides" class:bare={lastSlide}>
            <span class="of">{tf('tutorial.card.of', { n: slide + 1, total: card.slides })}</span>
            {#if !lastSlide}
              <button
                type="button"
                class="btn"
                onclick={() => {
                  coach.nextSlide();
                }}>{t('tutorial.card.next')}</button
              >
            {/if}
          </div>
        {:else if card.canContinue}
          <div class="row">
            <button
              type="button"
              class="btn"
              onclick={() => {
                coach.continue();
              }}>{t('tutorial.card.continue')}</button
            >
          </div>
        {/if}
      </section>
    {/key}
  {/if}

  {#if view.paused}
    <!-- The simulation waits for the card (round 3): bottom centre, clear of the top bar and the
         warnings; nothing is dimmed, the card asks the player to look at the frame. -->
    <div class="paused" role="status">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"
        ><rect x="0.5" y="0.5" width="3" height="11" /><rect
          x="6.5"
          y="0.5"
          width="3"
          height="11"
        /></svg
      >{t('tutorial.paused')}
    </div>
  {/if}
</div>

<style>
  /* Over the radial menus (21), whose items the marks point at; under the result (25). */
  .coach {
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

  /* --- The HUD outline (Compass on the HUD) and a menu item's ring ---------------------------- */
  .hudmark .glow {
    fill: none;
    stroke: rgb(236 228 209 / 45%);
    stroke-width: 6;
    filter: blur(4px);
    animation: breathe 2.4s var(--ease-engrave) 4 alternate both;
  }

  .hudmark .casing,
  .itemmark .casing {
    fill: none;
    stroke: var(--casing);
    stroke-width: 4;
  }

  .itemmark .casing.thin {
    stroke-width: 3;
  }

  .hudmark .ink,
  .itemmark .ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }

  .itemmark .dash {
    fill: none;
    stroke: rgb(236 228 209 / 55%);
    stroke-width: 1;
    stroke-dasharray: 3 5;
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
    width: 340px;
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

  .lab.again {
    color: var(--ink-soft);
  }

  .steps {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .lz {
    display: inline-block;
    width: 6px;
    height: 6px;
    transform: rotate(45deg);
    box-shadow: 0 0 0 1px var(--ink-soft);
  }

  .lz.on {
    background: var(--ink);
  }

  .lz.now {
    background: var(--ink);
    box-shadow:
      0 0 0 1px var(--ink),
      0 0 0 3px rgb(236 228 209 / 18%);
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

  /* A locked control was used: the action line says again what to do. */
  .act.pulse {
    animation: pulse 0.9s var(--ease-engrave) 1;
  }

  @keyframes pulse {
    0%,
    100% {
      color: var(--ink-soft);
      transform: none;
    }
    30% {
      color: #fff8e9;
      transform: translateX(3px);
    }
    60% {
      transform: translateX(-2px);
    }
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid var(--line);
  }

  .row.slides {
    justify-content: space-between;
  }

  .row.slides.bare {
    margin-top: 4px;
    padding-top: 0;
    border-top: 0;
  }

  .of {
    font: 500 10.5px/1 var(--font-display);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  /* The small primary button of the card (Lapis): an ivory tablet with an inner rule. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: 0;
    background: var(--ink);
    box-shadow:
      inset 0 0 0 4px var(--ink),
      inset 0 0 0 5px var(--stone-bg);
    color: var(--stone-bg);
    font: 500 11.5px/1 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .btn:hover {
    background: #fff8e9;
    box-shadow:
      inset 0 0 0 4px #fff8e9,
      inset 0 0 0 5px var(--stone-bg);
  }

  .btn:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  /* --- The "Paused" plate --------------------------------------------------------------------- */
  .paused {
    position: absolute;
    left: 50%;
    bottom: 42px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    box-sizing: border-box;
    padding: 0 17px 0 14px;
    background: rgb(14 12 9 / 95%);
    border: 1px solid rgb(236 228 209 / 60%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 95%),
      inset 0 0 0 4px rgb(236 228 209 / 22%),
      0 10px 26px rgb(0 0 0 / 55%);
    font: 500 12px/1 var(--font-display);
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--ink);
    animation: ink 0.2s linear both;
  }

  .paused rect {
    fill: currentColor;
  }

  /* "Less motion" (#871): the card is there at once, the marks hold still. */
  .still .plate.placed,
  .still .placed .pt,
  .still .leadline,
  .still .leadcase,
  .still .leadfoot,
  .still .hudmark .glow,
  .still .act.pulse,
  .still .paused {
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
