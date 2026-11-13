<script lang="ts">
  import { t, tf, type MessageKey } from '../../i18n/index.ts';
  import type { ChapterId, MapFile } from '../../protocol.gen.ts';
  import { reducedMotion } from '../../render/motion.ts';
  import { chapterOf } from '../../tutorial/chapters.ts';
  import {
    CHARTER_ORDER,
    defaultSeat,
    openedBy,
    sealStates,
    type CharterSeat,
    type SealState,
    type TutorialProgress,
  } from '../../tutorial/progress.ts';
  import FrontTop from '../FrontTop.svelte';
  import CharterEmblem from './CharterEmblem.svelte';
  import MenuBackdrop from '../MenuBackdrop.svelte';
  import {
    compassPoints,
    loz,
    SEAT,
    SHEET,
    SIDE_Y,
    sealRadius,
    star,
    tickPath,
  } from './charterArt.ts';
  import { chapterKicker, chapterName, chapterWhy } from './texts.ts';

  interface Props {
    progress: TutorialProgress;
    /** The seat chosen when the page opens; by default the next chapter. */
    initial?: CharterSeat;
    nick: string;
    hasPassword: boolean;
    map: MapFile | null;
    /** The intro of a chapter (Start, Replay). */
    onchapter: (chapter: ChapterId) => void;
    /** The first match: an easy bot on Narrows; the answer is the line to show when it failed. */
    onmatch: () => Promise<MessageKey | null>;
    /** The rules reference. */
    onrules: () => void;
    onprofile: () => void;
  }

  let { progress, initial, nick, hasPassword, map, onchapter, onmatch, onrules, onprofile }: Props =
    $props();

  const uid = $props.id();
  const states = $derived(sealStates(progress));
  let chosen = $state<CharterSeat | null>(null);
  const sel = $derived<CharterSeat>(chosen ?? initial ?? defaultSeat(progress));
  let busy = $state(false);
  let failure = $state<MessageKey | null>(null);

  const isAdvanced = (seat: CharterSeat): boolean =>
    seat === 'group-orders' || seat === 'rally-points' || seat === 'supply-distribution';
  const nameOf = (seat: CharterSeat): string =>
    seat === 'match' ? t('tutorial.match.name') : chapterName({ id: seat });
  const eyebrowOf = (seat: CharterSeat): string =>
    seat === 'match' ? t('tutorial.eyebrow.match') : chapterKicker(chapterOf(seat));
  const lineOf = (seat: CharterSeat): string =>
    seat === 'match' ? t('tutorial.match.why') : chapterWhy({ id: seat });

  function subOf(seat: CharterSeat, state: SealState): string {
    if (state === 'done')
      return t(seat === 'match' ? 'tutorial.seat.played' : 'tutorial.seat.done');
    if (state === 'next') return t('tutorial.seat.next');
    if (state === 'open')
      return t(seat === 'match' ? 'tutorial.seat.anyTime' : 'tutorial.seat.optional');
    const before = openedBy(seat);
    return tf('tutorial.seat.after', {
      n: before === null ? '' : chapterOf(before).road === 'main' ? numeralOf(before) : '',
    });
  }

  const numeralOf = (id: ChapterId): string =>
    ['I', 'II', 'III', 'IV', 'V'][chapterOf(id).number - 1] ?? '';

  function actionOf(seat: CharterSeat, state: SealState): string {
    if (state === 'done')
      return t(seat === 'match' ? 'tutorial.action.playAgain' : 'tutorial.action.replay');
    return t(seat === 'match' ? 'tutorial.action.play' : 'tutorial.action.start');
  }

  function choose(seat: CharterSeat): void {
    chosen = seat;
    failure = null;
  }

  let seats: Partial<Record<CharterSeat, HTMLButtonElement>> = $state({});

  function onseatkey(event: KeyboardEvent, seat: CharterSeat): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const i = CHARTER_ORDER.indexOf(seat);
    const next = CHARTER_ORDER[(i + step + CHARTER_ORDER.length) % CHARTER_ORDER.length];
    if (next === undefined) return;
    choose(next);
    seats[next]?.focus();
  }

  async function play(): Promise<void> {
    const seat = sel;
    if (states[seat] === 'locked' || busy) return;
    if (seat !== 'match') {
      onchapter(seat);
      return;
    }
    await firstMatch();
  }

  async function firstMatch(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await onmatch();
    } finally {
      busy = false;
    }
  }

  // The sheet keeps its drawing and scales to the window under the bar.
  let areaW = $state(SHEET.width + 112);
  let areaH = $state(SHEET.height + 120);
  const k = $derived(
    Math.max(0.5, Math.min((areaW - 112) / SHEET.width, (areaH - 48) / SHEET.height, 1.25)),
  );

  const [ix, iy] = SEAT.units;
  const [mx, my] = SEAT.match;
  const [fx, fy] = SEAT.fork;
  const dMain = `M${String(ix - 92)} ${String(iy)}L${String(mx)} ${String(my)}`;
  const dSide =
    `M${String(fx)} ${String(fy)}L${String(fx)} ${String(SIDE_Y)}M${String(SEAT['group-orders'][0])} ${String(SIDE_Y)}L${String(SEAT['supply-distribution'][0])} ${String(SIDE_Y)}` +
    (['group-orders', 'rally-points', 'supply-distribution'] as const)
      .map(
        (seat) =>
          `M${String(SEAT[seat][0])} ${String(SIDE_Y)}L${String(SEAT[seat][0])} ${String(SEAT[seat][1])}`,
      )
      .join('');
  const ax = mx - 66 - 11;
  const arrow = `M${String(ax - 7)} ${String(my - 8)}L${String(ax + 1)} ${String(my)}L${String(ax - 7)} ${String(my + 8)}`;

  const selState = $derived(states[sel]);
  const locked = $derived(selState === 'locked');
  const before = $derived(openedBy(sel));
</script>

<!-- The chapter select, Charter (#806, round 5): the client's top bar over a stone sheet of seals.
     The main rule I to V ends in an arrow at the first match's seal (always open); the Advanced rule
     drops from it after V. Under the seals the detail of the chosen one, with Start, the first match
     and the rules. -->
<main class="front charter-page">
  <MenuBackdrop {map} phase="idle" />
  <div class="blurstone"></div>
  <FrontTop
    player={{ nick, guest: !hasPassword, onprofile }}
    onhelp={() => undefined}
    helpHere
    title={t('tutorial.title')}
  />
  <div class="area" bind:clientWidth={areaW} bind:clientHeight={areaH}>
    <section
      class="charter rule-frame"
      class:still={reducedMotion()}
      aria-labelledby="{uid}-title"
      style:transform="translate(-50%, -50%) scale({k})"
    >
      <h2 id="{uid}-title" class="sr">{t('tutorial.chapters')}</h2>
      <svg class="rules" viewBox="0 0 {SHEET.width} {SHEET.height}" aria-hidden="true">
        <defs>
          <radialGradient id="{uid}-hole" cx=".6" cy=".66" r=".8">
            <stop offset="0" stop-color="#1c1813" /><stop offset=".8" stop-color="#0d0b09" /><stop
              offset="1"
              stop-color="#060504"
            />
          </radialGradient>
          <linearGradient id="{uid}-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#050403" /><stop
              offset=".55"
              stop-color="#050403"
              stop-opacity=".2"
            /><stop offset="1" stop-color="#d6c8ac" stop-opacity=".42" />
          </linearGradient>
          <radialGradient id="{uid}-seal" cx=".38" cy=".3" r=".85">
            <stop offset="0" stop-color="#2f2920" /><stop offset="1" stop-color="#13110d" />
          </radialGradient>
          <linearGradient id="{uid}-ivory" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff8e9" /><stop offset=".55" stop-color="#ece4d1" /><stop
              offset="1"
              stop-color="#c9bea6"
            />
          </linearGradient>
          <filter id="{uid}-soft" x="-50%" y="-50%" width="200%" height="200%"
            ><feGaussianBlur stdDeviation="5" /></filter
          >
          <filter id="{uid}-glow" x="-50%" y="-50%" width="200%" height="200%"
            ><feGaussianBlur stdDeviation="3" /></filter
          >
        </defs>
        <g fill="none">
          <path d={dSide} class="rule-cut" />
          <path
            d={dSide}
            class="rule-lit"
            class:faint={states['group-orders'] === 'locked'}
            transform="translate(0 1.6)"
          />
          <path d={dMain} class="rule-cut" />
          <path d={dMain} class="rule-lit" transform="translate(0 1.6)" />
          <path d={arrow} class="arrow-case" />
          <path d={arrow} class="arrow" />
          <path d={loz(fx, fy, 6)} class="joint" />
          <path d={loz(ix - 92, iy, 4.5)} class="joint" />
        </g>
      </svg>

      <div role="radiogroup" aria-label={t('tutorial.chaptersGroup')}>
        {#each CHARTER_ORDER as seat, order (seat)}
          {@const [x, y] = SEAT[seat]}
          {@const R = sealRadius(seat)}
          {@const state = states[seat]}
          {@const hit = Math.round(2 * R + 6)}
          {@const box = Math.round(2 * R + 80)}
          {@const done = state === 'done'}
          {@const m = seat === 'match'}
          {@const inset = R - 4}
          <button
            type="button"
            class="place {state}"
            class:sel={seat === sel}
            class:adv={isAdvanced(seat)}
            role="radio"
            aria-checked={seat === sel}
            tabindex={seat === sel ? 0 : -1}
            aria-label={m
              ? tf('tutorial.seat.labelMatch', { name: nameOf(seat), state: subOf(seat, state) })
              : tf('tutorial.seat.label', {
                  eyebrow: eyebrowOf(seat),
                  name: nameOf(seat),
                  state: subOf(seat, state),
                })}
            style:left="{x}px"
            style:top="{y}px"
            style:--hit="{hit}px"
            style:--box="{box}px"
            bind:this={seats[seat]}
            onclick={() => {
              choose(seat);
            }}
            onkeydown={(event) => {
              onseatkey(event, seat);
            }}
          >
            <svg viewBox="{-box / 2} {-box / 2} {box} {box}" aria-hidden="true">
              {#if state === 'next'}
                <!-- The Compass on the next seal: the double ring, its points turn once. -->
                <g>
                  <circle r={R * 0.78 + 16} class="cc-glow" filter="url(#{uid}-soft)" />
                  <circle r={R * 0.78 + 8} class="cc-case" />
                  <circle r={R * 0.78 + 8} class="cc-ink" />
                  <circle r={R * 0.78 + 14} class="cc-case thin" />
                  <circle r={R * 0.78 + 14} class="cc-dash" />
                  <g class="spin">
                    {#each compassPoints(R * 0.78 + 14) as d, i (i)}
                      <path {d} class="cc-point" />
                    {/each}
                    <circle r={R * 0.78 + 22} fill="none" />
                  </g>
                </g>
              {/if}
              <path d={loz(0, 1.5, R)} class="seat-lip" />
              <path d={loz(0, 0, R)} fill="url(#{uid}-hole)" />
              <path d={loz(0, 0, R)} fill="none" stroke="url(#{uid}-rim)" stroke-width="1.6" />
              {#if state === 'locked'}
                <path class="ring locked-ring" d={loz(0, 0, R * 0.78)} />
                <CharterEmblem {seat} y={-R * 0.1} size={R * 0.56} tone="dim" stroke={1.7} />
                {#if !m}
                  <text y={R * 0.5} class="num dim" font-size={Math.max(9, R * 0.2)}
                    >{isAdvanced(seat) ? `A·${numeralOf(seat)}` : numeralOf(seat)}</text
                  >
                {/if}
                <g transform="translate({R * 0.5} {-R * 0.5}) scale(.9)">
                  <path d="M-6.5 -1.5h13v10.5h-13z" class="lk-case" />
                  <path d="M-6.5 -1.5h13v10.5h-13z" class="lk-body" />
                  <path d="M-3.6 -1.5v-3.6a3.6 3.6 0 0 1 7.2 0v3.6" class="lk-shackle-case" />
                  <path d="M-3.6 -1.5v-3.6a3.6 3.6 0 0 1 7.2 0v3.6" class="lk-shackle" />
                  <circle cy="3.6" r="1.4" class="lk-hole" />
                </g>
              {:else}
                <g
                  class="seal-face"
                  class:stamp={done}
                  style:animation-delay={done ? `${String(0.15 + order * 0.12)}s` : undefined}
                >
                  <path
                    d={loz(0, 3, inset)}
                    fill="#000"
                    fill-opacity=".45"
                    filter="url(#{uid}-glow)"
                  />
                  {#if done}
                    <path d={loz(0, 0, inset)} fill="url(#{uid}-ivory)" class="face-rim" />
                    <path d={loz(0, 0, inset - 4)} class="face-in-dark" />
                    <path class="ring done-ring" d={loz(0, 0, inset * 0.78)} />
                    <path d={loz(0, 0, inset * 0.7)} class="face-faint-dark" />
                    <CharterEmblem {seat} y={-R * 0.1} size={R * 0.56} tone="dark" stroke={1.9} />
                    {#if !m}
                      <text y={R * 0.5} class="num dark" font-size={Math.max(9, R * 0.2)}
                        >{isAdvanced(seat) ? `A·${numeralOf(seat)}` : numeralOf(seat)}</text
                      >
                    {/if}
                  {:else}
                    <path d={loz(0, 0, inset)} fill="url(#{uid}-seal)" class="face-rim" />
                    <path d={loz(0, 0, inset - 3)} class="face-in" />
                    <path
                      class="ring open-ring"
                      class:minium={m}
                      class:strong={state === 'next'}
                      d={loz(0, 0, inset * 0.78)}
                    />
                    <path d={loz(0, 0, inset * 0.7)} class="face-faint" />
                    <CharterEmblem
                      {seat}
                      y={-R * 0.1}
                      size={R * 0.56}
                      tone={m ? 'minium' : 'ink'}
                      stroke={1.7}
                    />
                    {#if !m}
                      <text y={R * 0.5} class="num soft" font-size={Math.max(9, R * 0.2)}
                        >{isAdvanced(seat) ? `A·${numeralOf(seat)}` : numeralOf(seat)}</text
                      >
                    {/if}
                  {/if}
                </g>
              {/if}
              {#if done}
                <path
                  d={loz(R * 0.52, -R * 0.52, 7.5)}
                  fill="url(#{uid}-ivory)"
                  class="tick-case"
                />
                <path d={tickPath(R * 0.52, -R * 0.52, 7.5)} class="tick" />
              {/if}
              <g class="fr">
                <path d={loz(0, 0, R + 9)} class="fr-case" />
                <path d={loz(0, 0, R + 9)} class="fr-ink" />
              </g>
              <!-- The chosen seal: the plinth's way marker, a lozenge on a short rule over it. -->
              <g class="pin">
                <path d="M0 {-(R + 22) + 4}L0 {-(R + 22) + 15}" class="pin-case" />
                <path d="M0 {-(R + 22) + 4}L0 {-(R + 22) + 15}" class="pin-ink" />
                <path d={loz(0, -(R + 22), 6.5)} fill="url(#{uid}-ivory)" class="pin-head" />
              </g>
              <g class="hov">
                <path d={loz(0, -(R + 22) + 6, 5.5)} class="hov-head" />
              </g>
            </svg>
            <span class="lbl" aria-hidden="true">
              <span class="pl-name">{nameOf(seat)}</span>
              <span class="pl-sub">{subOf(seat, state)}</span>
            </span>
          </button>
        {/each}
      </div>
      <span
        class="rtag"
        style:left="{SEAT['group-orders'][0] - 150}px"
        style:top="{SEAT['group-orders'][1] - 5}px">{t('tutorial.advanced')}</span
      >

      <div class="dt">
        <p class="lab">{eyebrowOf(sel)}</p>
        <h2>{nameOf(sel)}</h2>
        <p class="why">
          {locked && before !== null
            ? tf('tutorial.opensAfter', { name: chapterName({ id: before }) })
            : lineOf(sel)}
        </p>
        {#if failure !== null}
          <p class="failure" role="alert">{t(failure)}</p>
        {/if}
        <div class="dt-acts">
          <button
            type="button"
            class="lapis-btn primary tab"
            aria-disabled={locked || busy}
            onclick={() => {
              void play();
            }}
          >
            {#if locked}
              <svg width="14" height="16" viewBox="-8 -9 16 19" aria-hidden="true"
                ><path d="M-6.5 -1.5h13v10.5h-13z" fill="currentColor" /><path
                  d="M-3.6 -1.5v-3.6a3.6 3.6 0 0 1 7.2 0v3.6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                /></svg
              >{t('tutorial.action.locked')}
            {:else}
              {actionOf(sel, selState)}
            {/if}
          </button>
          {#if sel !== 'match'}
            <button
              type="button"
              class="lapis-btn secondary fm"
              aria-disabled={busy}
              onclick={() => {
                void firstMatch();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"
                ><path d={star(9, 9.6, 8.4, 3.6)} class="fm-star" /></svg
              >{t('tutorial.firstMatch')}
            </button>
          {/if}
          <button type="button" class="quiet" onclick={onrules}>{t('tutorial.rules')}</button>
        </div>
      </div>
    </section>
  </div>
</main>

<style>
  .charter-page {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
    overflow: hidden;
  }

  .blurstone {
    position: absolute;
    inset: 0;
    background: var(--stone-tex) rgb(22 19 15 / 80%);
    backdrop-filter: blur(9px) saturate(0.55);
  }

  .area {
    position: absolute;
    inset: 72px 0 0;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .charter {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 1168px;
    height: 680px;
    background: var(--stone-tex) var(--stone-panel);
    box-shadow: 0 30px 60px rgb(0 0 0 / 50%);
    color: var(--ink);
    transform-origin: center center;
    animation: charter-in 0.7s var(--ease-settle) both;
  }

  @keyframes charter-in {
    from {
      opacity: 0;
    }
  }

  .rules {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .rule-cut {
    stroke: #050403;
    stroke-width: 3;
  }

  .rule-lit {
    stroke: rgb(214 200 172 / 42%);
    stroke-width: 1;
  }

  .rule-lit.faint {
    stroke: rgb(214 200 172 / 20%);
    stroke-dasharray: 4 5;
  }

  .arrow-case {
    stroke: #050403;
    stroke-width: 4.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .arrow {
    stroke: var(--ink);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .joint {
    fill: var(--frame-lozenge);
    stroke: #050403;
    stroke-width: 1.3;
  }

  /* --- A seal ------------------------------------------------------------------------------- */
  .place {
    position: absolute;
    z-index: 5;
    width: var(--hit);
    height: var(--hit);
    margin: calc(var(--hit) / -2) 0 0 calc(var(--hit) / -2);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .place:focus-visible {
    outline: none;
  }

  .place > svg {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--box);
    height: var(--box);
    margin: calc(var(--box) / -2) 0 0 calc(var(--box) / -2);
    overflow: visible;
    pointer-events: none;
  }

  .lbl {
    position: absolute;
    left: 50%;
    top: calc(100% + 10px);
    width: max-content;
    max-width: 150px;
    transform: translateX(-50%);
    text-align: center;
    pointer-events: none;
  }

  .place.next .lbl {
    top: calc(100% + 12px);
  }

  .pl-name {
    display: block;
    font: 500 12.5px/1.3 var(--font-display);
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink);
    text-wrap: balance;
  }

  .pl-sub {
    display: block;
    margin-top: 1px;
    font: italic 500 15.5px/1.2 var(--font-text);
    color: var(--ink-soft);
  }

  .place.locked .pl-name,
  .place.locked .pl-sub {
    color: var(--ink-dim);
  }

  .place:hover .pl-name {
    color: #fff8e9;
  }

  .seat-lip {
    fill: #d6c8ac;
    fill-opacity: 0.14;
  }

  .ring {
    fill: none;
    stroke-width: 1.6;
    transition:
      stroke 0.2s,
      stroke-opacity 0.2s;
  }

  .locked-ring {
    stroke: #8f8573;
    stroke-opacity: 0.85;
    stroke-width: 1.2;
    stroke-dasharray: 4 4;
  }

  .done-ring {
    stroke: #16130f;
  }

  .open-ring {
    stroke: var(--ink);
    stroke-opacity: 0.8;
  }

  .open-ring.strong {
    stroke-opacity: 1;
  }

  .open-ring.minium {
    stroke: var(--enemy);
  }

  .place:hover .ring {
    stroke: #fff8e9;
    stroke-opacity: 1;
  }

  .face-rim {
    stroke: #050403;
    stroke-width: 2;
  }

  .face-in {
    fill: none;
    stroke: rgb(214 200 172 / 38%);
    stroke-width: 1;
  }

  .face-faint {
    fill: none;
    stroke: rgb(236 228 209 / 22%);
    stroke-width: 1;
  }

  .face-in-dark {
    fill: none;
    stroke: #7d7363;
    stroke-width: 1;
  }

  .face-faint-dark {
    fill: none;
    stroke: #16130f;
    stroke-opacity: 0.35;
    stroke-width: 1;
  }

  .num {
    text-anchor: middle;
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 1px;
  }

  .num.soft {
    fill: var(--ink-dim);
  }

  .num.dim {
    fill: #7d7363;
  }

  .num.dark {
    fill: #3d372d;
  }

  .lk-case {
    fill: #0b0a08;
    stroke: #060504;
    stroke-width: 2.6;
    stroke-linejoin: round;
  }

  .lk-body {
    fill: var(--ink-soft);
  }

  .lk-shackle-case {
    fill: none;
    stroke: #060504;
    stroke-width: 4.2;
  }

  .lk-shackle {
    fill: none;
    stroke: var(--ink-soft);
    stroke-width: 2;
  }

  .lk-hole {
    fill: #0b0a08;
  }

  .tick-case {
    stroke: #060504;
    stroke-width: 1.4;
  }

  .tick {
    fill: none;
    stroke: #060504;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .fr {
    opacity: 0;
  }

  .place:focus-visible .fr {
    opacity: 1;
  }

  .fr-case {
    fill: none;
    stroke: #060504;
    stroke-width: 5;
  }

  .fr-ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
  }

  .pin {
    opacity: 0;
  }

  .place.sel .pin {
    opacity: 1;
    animation: pin-in 0.45s var(--ease-settle) both;
  }

  @keyframes pin-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  .pin-case {
    stroke: #060504;
    stroke-width: 3.4;
  }

  .pin-ink {
    stroke: var(--ink);
    stroke-width: 1.3;
  }

  .pin-head {
    stroke: #060504;
    stroke-width: 1.5;
  }

  .hov {
    opacity: 0;
    transform: translateY(4px);
    transform-box: fill-box;
    transition:
      opacity 0.25s var(--ease-settle),
      transform 0.25s var(--ease-settle);
  }

  .place:hover .hov {
    opacity: 1;
    transform: none;
  }

  .place.sel .hov {
    opacity: 0 !important;
  }

  .hov-head {
    fill: #16130f;
    stroke: var(--ink);
    stroke-width: 1.4;
  }

  .seal-face {
    transition: transform 0.25s var(--ease-settle);
    transform-box: fill-box;
    transform-origin: center;
  }

  .place:hover .seal-face {
    transform: translateY(-3px);
  }

  .stamp {
    animation: stamp 0.55s var(--ease-settle) both;
  }

  @keyframes stamp {
    0% {
      opacity: 0;
      transform: scale(1.28);
    }
    60% {
      opacity: 1;
      transform: scale(0.97);
    }
    100% {
      transform: scale(1);
    }
  }

  /* The Compass on the next seal. */
  .cc-glow {
    fill: none;
    stroke: rgb(236 228 209 / 50%);
    stroke-width: 7;
    animation: breathe 2.4s var(--ease-engrave) 4 alternate both;
  }

  .cc-case {
    fill: none;
    stroke: #060504;
    stroke-width: 4;
  }

  .cc-case.thin {
    stroke-width: 3;
  }

  .cc-ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.6;
  }

  .cc-dash {
    fill: none;
    stroke: rgb(236 228 209 / 55%);
    stroke-width: 1;
    stroke-dasharray: 3 5;
  }

  .cc-point {
    fill: var(--ink);
    stroke: #060504;
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .spin {
    transform-box: fill-box;
    transform-origin: center;
    animation: spin 9s var(--ease-travel) 1 both;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes breathe {
    from {
      opacity: 0.25;
    }
    to {
      opacity: 0.85;
    }
  }

  .rtag {
    position: absolute;
    z-index: 4;
    font: 500 10.5px/1 var(--font-display);
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--ink-dim);
    pointer-events: none;
  }

  /* --- The detail of the chosen seal --------------------------------------------------------- */
  .dt {
    position: absolute;
    left: 58px;
    top: 478px;
    width: 660px;
    margin: 0;
    padding-top: 22px;
  }

  .dt::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 5px;
    background:
      linear-gradient(var(--cut), var(--cut)) 0 0 / 100% 1px no-repeat,
      linear-gradient(var(--line), var(--line)) 0 1px / 100% 1px no-repeat,
      linear-gradient(var(--lit-faint), var(--lit-faint)) 0 4px / 100% 1px no-repeat;
  }

  .lab {
    margin: 0;
    font: 500 11.5px/1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .dt h2 {
    margin: 6px 0 4px;
    font: 500 32px/1.05 var(--font-display);
    letter-spacing: 0.04em;
  }

  .dt .why {
    margin: 0;
    max-width: 640px;
    font: italic 500 19px/1.35 var(--font-text);
    color: var(--ink-soft);
  }

  .failure {
    margin: 8px 0 0;
    font: italic 500 17px/1.3 var(--font-text);
    color: var(--warn);
  }

  .dt-acts {
    display: flex;
    align-items: center;
    gap: 22px;
    margin-top: 18px;
  }

  .tab {
    height: 58px;
    min-width: 200px;
    font-size: 18px;
    letter-spacing: 0.24em;
    gap: 10px;
  }

  .tab[aria-disabled='true'] {
    background: transparent;
    color: var(--ink-dim);
    cursor: default;
    box-shadow:
      inset 0 0 0 1px var(--rule),
      inset 0 0 0 4px var(--rule-faint);
  }

  .fm {
    height: 50px;
    padding: 0 20px 0 16px;
    gap: 10px;
  }

  .fm-star {
    fill: var(--enemy);
    stroke: #060504;
    stroke-width: 1;
  }

  .quiet {
    border: 0;
    background: none;
    padding: 2px 0;
    color: var(--ink-soft);
    font: italic 500 17px/1.2 var(--font-text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
    text-decoration-color: var(--rule);
    cursor: pointer;
  }

  .quiet:hover {
    color: var(--ink);
    text-decoration-color: var(--ink-soft);
  }

  .quiet:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  /* "Less motion": the seals pressed without the stamp, the compass still. */
  .still,
  .still .stamp,
  .still .spin,
  .still .pin,
  .still .cc-glow {
    animation: none !important;
  }

  .still .cc-glow {
    opacity: 0.6;
  }
</style>
