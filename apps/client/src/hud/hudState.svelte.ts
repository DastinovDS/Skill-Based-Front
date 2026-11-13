/**
 * The HUD's reactive state (CLI-08, #64; AGENTS.md 7.2). One class with one field,
 * `current = $state.raw(...)`, replaced as a whole once per snapshot (10 Hz) and on a selection or
 * hover change. Not a `$state` exported from the module (Svelte does not compile a reassigned one),
 * not touched by the render loop: the frame loop reads the snapshot buffer, never this.
 *
 * Besides `current` it owns the small pieces of the match HUD that are not a view of the snapshot:
 * the toasts, the start banner and the last-minute cue (ui-style 10.4, U4, U12).
 */
import type { EventMsg, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import {
  buildHudData,
  type HudContext,
  type HudData,
  type HoverTarget,
  type Selection,
  type VpCredit,
  type WalkPaid,
} from './hudData.ts';
import type { PendingWalk } from './rallyDue.ts';
import { AlertState } from '../match/alerts.svelte.ts';
import { ThreatLog } from '../match/threats.ts';
import { t } from '../i18n/index.ts';
import { TOAST_HOLD_MS, ToastState } from './toastState.svelte.ts';
import { nodeNamer, type NodeNamer } from './nodeName.ts';
import { toastOf } from './toasts.ts';
import type { MatchSummary } from '../app/matchSummary.ts';

/** The start banner and the ring around the capital last this long, ms (U4). */
export const START_MS = 3000;

/** The charged walks kept for the gauge's flights (a new `seq` starts one). */
const PAID_KEEP = 4;

/** A snapshot at or before this tick (seconds of match time) is the start of a match, not a rejoin. */
const FRESH_SECONDS = 3;

/** The timer turns amber at this many seconds left (U12). */
export const LAST_MINUTE_S = 60;

export class HudState {
  /** `null` until the first snapshot. Replaced, never mutated. */
  current = $state.raw<HudData | null>(null);

  /** Alerts of the match: incoming attacks and overcrowded cities (`hud/AlertStack.svelte`). */
  readonly alerts: AlertState;

  /** Threats to own cities for the arcs at the screen edge: plain data, read every frame. */
  readonly threats: ThreatLog;

  /** Toasts of the match (an enemy capture, a capture not paid, a building done, the last minute). */
  readonly toasts = new ToastState();

  /**
   * The start banner is up (U4): the first seconds of a fresh match. Replaced as a whole; the map
   * reads `beacon` (the city to ring) from the plain getter, not from here.
   */
  banner = $state.raw<boolean>(false);

  /** The name of a place by its id, from the map of the match (#449). */
  readonly nodeName: NodeNamer;

  readonly #ctx: HudContext;
  #snapshot: SnapshotMsg | null = null;
  #selection: Selection | null = null;
  /** The group, or the icon of the groups of a city, under the pointer (for its charge tip). */
  #hovered: HoverTarget = null;
  #bannerTimer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #lastMinuteSeen = false;
  /** Own recruits made in a city with a rally point, not gone yet, by group id (#930). */
  #pending: (PendingWalk & { readonly group: string })[] = [];
  #paid: WalkPaid[] = [];
  /** Charged walks the map has not drawn leaving yet: their flight waits for the render tick. */
  #paidWaiting: { walk: WalkPaid; tick: number; timer: ReturnType<typeof setTimeout> }[] = [];
  #credit: VpCredit | null = null;
  #extraSeq = 0;
  /** Told after each change of `current` (the order controller steps on them, ARC-C01). */
  #listeners: (() => void)[] = [];

  /** The start banner (and the ring of the own capital) opens on a fresh match. */
  readonly #startBanner: boolean;

  /**
   * `startBanner: false`: a tutorial chapter (#806), whose first card takes the banner's place.
   */
  constructor(ctx: HudContext, options: { readonly startBanner?: boolean } = {}) {
    this.#ctx = ctx;
    this.#startBanner = options.startBanner ?? true;
    this.nodeName = nodeNamer(ctx.map);
    this.alerts = new AlertState(ctx.me, ctx.rules);
    this.threats = new ThreatLog(ctx.me);
  }

  /** The context of the match: ruleset, side, nicks, map. */
  get context(): HudContext {
    return this.#ctx;
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  /** What the result screen shows about our side (#596): the nicks. */
  summary(): MatchSummary {
    const me = this.#ctx.me;
    return { nicks: { mine: this.#ctx.nicks[me], enemy: this.#ctx.nicks[me === 0 ? 1 : 0] } };
  }

  /** The own capital to ring while the start banner is up (read every frame by the map). */
  get beacon(): number | null {
    if (!this.banner) return null;
    const capital = this.#ctx.map.nodes.find((n) => n.capital_of === this.#ctx.me);
    return capital?.id ?? null;
  }

  /** A new snapshot: the HUD numbers are recomputed here and only here. */
  onSnapshot(snapshot: SnapshotMsg): void {
    this.#snapshot = snapshot;
    this.#keepPending(snapshot);
    this.alerts.onSnapshot(snapshot);
    this.threats.onSnapshot(snapshot);
    this.#startOnce(snapshot);
    this.#lastMinute(snapshot);
    this.#publish();
  }

  /**
   * `listener` runs after each change of `current`: a snapshot, a selection, a hover, a reset (the
   * order controller steps then, not on a frame of the map, ARC-C01). Returns its removal.
   */
  listen(listener: () => void): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }

  /** The own group `id` in the newest snapshot; `null`: it is not there (any more). */
  ownGroup(id: string): GroupView | null {
    return this.#snapshot?.view.groups.find((g) => g.id === id) ?? null;
  }

  /** The newest snapshot shows the own group `id` in a fight (`FightView.groups`). */
  inFight(id: string): boolean {
    return this.#snapshot?.view.fights.some((f) => f.groups.includes(id)) ?? false;
  }

  /** A visible event: the threats, the rally walks and the toasts read it (there is no journal, #765). */
  onEvent(event: EventMsg): void {
    this.threats.onEvent(event, (node) => this.#snapshot?.view.nodes[node]?.owner);
    this.#rallyAndCredit(event);
    const toast = toastOf(event, this.#ctx.me, this.nodeName);
    if (toast !== null) this.toasts.later(event.tick, toast);
  }

  /**
   * The map drew tick `tick` (every frame): the toasts of events up to it show now, not when the
   * event arrived, so the news does not run ahead of the picture (the map renders a few ticks
   * behind the newest snapshot).
   */
  onRender(tick: number): void {
    this.toasts.release(tick);
    for (const entry of [...this.#paidWaiting]) {
      if (entry.tick <= tick) this.#releasePaid(entry.walk.seq);
    }
  }

  select(selection: Selection | null): void {
    this.#selection = selection;
    this.#publish();
  }

  /**
   * The group the pointer rests on, or the one icon of the groups of a city (`{ node }`, the tip
   * shows their totals), for the charge tip; `null`: none.
   */
  hoverGroup(target: HoverTarget): void {
    const same =
      target === this.#hovered ||
      (typeof target === 'object' &&
        typeof this.#hovered === 'object' &&
        target?.node === this.#hovered?.node);
    if (same) return;
    this.#hovered = target;
    this.#publish();
  }

  /** The snapshot timeline broke (resync, reconnect): forget the old picture. */
  reset(): void {
    this.#snapshot = null;
    this.current = null;
    this.alerts.reset();
    this.toasts.clear();
    this.#dropPaidWaiting();
    this.#pending = [];
    this.#tell();
  }

  destroy(): void {
    clearTimeout(this.#bannerTimer);
    this.toasts.clear();
    this.#dropPaidWaiting();
    this.alerts.clearStays();
  }

  /**
   * The events of the rally walks and the VP credit (#930): a recruit made where a rally point is
   * set waits to leave (the gauge keeps its earmark), a charged walk flies its CP mark into the
   * gauge, a walk without CP hangs its strip, and the `vp_awarded` of one tick are one credit.
   */
  #rallyAndCredit(event: EventMsg): void {
    const me = this.#ctx.me;
    const { data } = event;
    const group = typeof data.group === 'string' ? data.group : null;
    const node = typeof data.node === 'number' ? data.node : null;
    const target = typeof data.target === 'number' ? data.target : null;
    switch (event.kind) {
      case 'recruited':
        if (data.player !== me || group === null || node === null) return;
        if (this.#snapshot?.view.nodes[node]?.rally_point == null) return;
        this.#pending = [...this.#pending.filter((p) => p.group !== group), { group, node }];
        return;
      case 'rally_walk_paid':
        if (data.player !== me || node === null) return;
        if (group !== null) this.#pending = this.#pending.filter((p) => p.group !== group);
        // The gauge spends with this snapshot, but the CP mark flies only when the map shows the
        // recruit leave its city (the render clock runs behind): `onRender` releases it, the
        // hold timer covers a render clock that stops short of the tick.
        this.#extraSeq += 1;
        this.#holdPaid({ seq: this.#extraSeq, node, target }, event.tick);
        return;
      case 'rally_walk_no_cp':
        if (data.player !== me || node === null) return;
        if (group !== null) this.#pending = this.#pending.filter((p) => p.group !== group);
        this.alerts.onStay(node, target);
        return;
      case 'vp_awarded': {
        const vp = typeof data.vp === 'number' ? data.vp : 0;
        const mine = data.player === me;
        const same = this.#credit !== null && this.#credit.tick === event.tick;
        if (!same) this.#extraSeq += 1;
        const base: VpCredit =
          same && this.#credit !== null
            ? this.#credit
            : { seq: this.#extraSeq, tick: event.tick, mine: 0, enemy: 0 };
        this.#credit = mine
          ? { ...base, mine: base.mine + vp }
          : { ...base, enemy: base.enemy + vp };
        return;
      }
      default:
    }
  }

  #dropPaidWaiting(): void {
    for (const entry of this.#paidWaiting) clearTimeout(entry.timer);
    this.#paidWaiting = [];
  }

  #holdPaid(walk: WalkPaid, tick: number): void {
    const timer = setTimeout(() => {
      this.#releasePaid(walk.seq);
    }, TOAST_HOLD_MS);
    this.#paidWaiting.push({ walk, tick, timer });
  }

  #releasePaid(seq: number): void {
    const at = this.#paidWaiting.findIndex((entry) => entry.walk.seq === seq);
    const entry = this.#paidWaiting[at];
    if (entry === undefined) return;
    this.#paidWaiting.splice(at, 1);
    clearTimeout(entry.timer);
    this.#paid = [...this.#paid, entry.walk].slice(-PAID_KEEP);
    this.#publish();
  }

  /** A recruit waiting to leave stays one while it stands in its city with its order. */
  #keepPending(snapshot: SnapshotMsg): void {
    this.#pending = this.#pending.filter((walk) => {
      const group = snapshot.view.groups.find((g) => g.id === walk.group);
      return (
        group?.location.kind === 'node' && group.location.node === walk.node && group.order !== null
      );
    });
  }

  /** The first snapshot of a fresh match opens the start banner for three seconds (U4). */
  #startOnce(snapshot: SnapshotMsg): void {
    if (this.#started) return;
    this.#started = true;
    if (!this.#startBanner) return;
    if (snapshot.tick > FRESH_SECONDS * this.#ctx.rules.tick_hz) return; // a rejoin, not a start
    this.banner = true;
    this.#bannerTimer = setTimeout(() => {
      this.banner = false;
    }, START_MS);
  }

  /** One toast when the last minute begins (U12); the timer itself turns amber in the bar. */
  #lastMinute(snapshot: SnapshotMsg): void {
    const { match_ticks, tick_hz } = this.#ctx.rules;
    const left = Math.ceil(Math.max(0, match_ticks - snapshot.tick) / tick_hz);
    if (left > LAST_MINUTE_S || this.#lastMinuteSeen) return;
    this.#lastMinuteSeen = true;
    if (match_ticks > LAST_MINUTE_S * tick_hz && snapshot.tick > 0) {
      this.toasts.later(snapshot.tick, {
        tone: 'warn',
        icon: 'clock',
        text: t('toast.lastMinute'),
      });
    }
  }

  #publish(): void {
    if (this.#snapshot === null) {
      return;
    }
    this.current = buildHudData(this.#ctx, this.#snapshot, this.#selection, this.#hovered, {
      pending: this.#pending,
      paid: this.#paid,
      credit: this.#credit,
    });
    this.#tell();
  }
}
