/**
 * The HUD's reactive state (CLI-08, #64; AGENTS.md 7.2). One class with one field,
 * `current = $state.raw(...)`, replaced as a whole once per snapshot (10 Hz) and on a selection or
 * hover change. Not a `$state` exported from the module (Svelte does not compile a reassigned one),
 * not touched by the render loop: the frame loop reads the snapshot buffer, never this.
 *
 * Besides `current` it owns the small pieces of the match HUD that are not a view of the snapshot:
 * the toasts, the start banner and the last-minute cue (ui-style 10.4, U4, U12).
 */
import type { EventMsg, SnapshotMsg } from '../protocol.gen.ts';
import {
  buildHudData,
  type AttackTarget,
  type HoverTarget,
  type HudContext,
  type HudData,
  type HudEvent,
  type Selection,
} from './hudData.ts';
import { isLogged } from './eventText.ts';
import { AlertState } from '../match/alerts.svelte.ts';
import { t } from '../i18n/index.ts';
import { ToastState } from './toastState.svelte.ts';
import { toastOf } from './toasts.ts';

/** Events kept for the feed. */
export const EVENT_LIMIT = 30;

/** The start banner and the ring around the capital last this long, ms (U4). */
export const START_MS = 3000;

/** A snapshot at or before this tick (seconds of match time) is the start of a match, not a rejoin. */
const FRESH_SECONDS = 3;

/** The timer turns amber at this many seconds left (U12). */
export const LAST_MINUTE_S = 60;

function hoverKey(hover: HoverTarget | null): string {
  return hover === null ? '-' : `${hover.kind}:${String(hover.id)}`;
}

export class HudState {
  /** `null` until the first snapshot. Replaced, never mutated. */
  current = $state.raw<HudData | null>(null);

  /** Alerts of the match: incoming attacks and overcrowded cities (`hud/AlertStack.svelte`). */
  readonly alerts: AlertState;

  /** Toasts of the match (fights, captures, attrition, refused commands). */
  readonly toasts = new ToastState();

  /**
   * The start banner is up (U4): the first seconds of a fresh match. Replaced as a whole; the map
   * reads `beacon` (the city to ring) from the plain getter, not from here.
   */
  banner = $state.raw<boolean>(false);

  readonly #ctx: HudContext;
  #snapshot: SnapshotMsg | null = null;
  #selection: Selection | null = null;
  #target: AttackTarget | null = null;
  #hover: HoverTarget | null = null;
  /** Newest first; events arrive between snapshots and reach `current` with the next one. */
  #events: HudEvent[] = [];
  #seq = 0;
  #bannerTimer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #lastMinuteSeen = false;

  constructor(ctx: HudContext) {
    this.#ctx = ctx;
    this.alerts = new AlertState(ctx.me, ctx.rules);
  }

  /** The context of the match: ruleset, side, nicks, map. */
  get context(): HudContext {
    return this.#ctx;
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  get target(): AttackTarget | null {
    return this.#target;
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
    this.alerts.onSnapshot(snapshot);
    this.#startOnce(snapshot);
    this.#lastMinute(snapshot);
    this.#publish();
  }

  /** A visible event for the feed; shown with the next snapshot. */
  onEvent(event: EventMsg): void {
    const entry: HudEvent = {
      seq: this.#seq + 1,
      tick: event.tick,
      kind: event.kind,
      data: event.data,
    };
    const toast = toastOf(entry, this.#ctx.me);
    if (toast !== null) this.toasts.push(toast);
    if (!isLogged(event.kind)) return; // bookkeeping kinds would push the real news out
    this.#seq += 1;
    this.#events = [entry, ...this.#events].slice(0, EVENT_LIMIT);
  }

  select(selection: Selection | null): void {
    this.#selection = selection;
    this.#publish();
  }

  /** The thing the pointer rests on, for the tooltip; `null`: nothing. */
  hover(hover: HoverTarget | null): void {
    if (hoverKey(hover) === hoverKey(this.#hover)) return;
    this.#hover = hover;
    this.#publish();
  }

  /** The enemy node the selected group is aimed at, for the combat estimate; `null` clears it. */
  aim(target: AttackTarget | null): void {
    this.#target = target;
    this.#publish();
  }

  /** The snapshot timeline broke (resync, reconnect): forget the old picture. */
  reset(): void {
    this.#snapshot = null;
    this.current = null;
    this.alerts.reset();
    this.toasts.clear();
  }

  destroy(): void {
    clearTimeout(this.#bannerTimer);
    this.toasts.clear();
  }

  /** The first snapshot of a fresh match opens the start banner for three seconds (U4). */
  #startOnce(snapshot: SnapshotMsg): void {
    if (this.#started) return;
    this.#started = true;
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
      this.toasts.push({ tone: 'warn', icon: 'clock', text: t('toast.lastMinute') });
    }
  }

  #publish(): void {
    if (this.#snapshot === null) {
      return;
    }
    this.current = buildHudData(
      this.#ctx,
      this.#snapshot,
      this.#selection,
      this.#target,
      this.#events,
      this.#hover,
    );
  }
}
