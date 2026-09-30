/**
 * The HUD's reactive state (CLI-08, #64; AGENTS.md 7.2). One class with one field,
 * `current = $state.raw(...)`, replaced as a whole once per snapshot (10 Hz) and on a selection
 * change. Not a `$state` exported from the module (Svelte does not compile a reassigned one), not
 * touched by the render loop: the frame loop reads the snapshot buffer, never this.
 */
import type { EventMsg, SnapshotMsg } from '../protocol.gen.ts';
import {
  buildHudData,
  type AttackTarget,
  type HudContext,
  type HudData,
  type HudEvent,
  type Selection,
} from './hudData.ts';

/** Events kept for the feed. */
export const EVENT_LIMIT = 30;

export class HudState {
  /** `null` until the first snapshot. Replaced, never mutated. */
  current = $state.raw<HudData | null>(null);

  readonly #ctx: HudContext;
  #snapshot: SnapshotMsg | null = null;
  #selection: Selection | null = null;
  #target: AttackTarget | null = null;
  /** Newest first; events arrive between snapshots and reach `current` with the next one. */
  #events: HudEvent[] = [];
  #seq = 0;

  constructor(ctx: HudContext) {
    this.#ctx = ctx;
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  get target(): AttackTarget | null {
    return this.#target;
  }

  /** A new snapshot: the HUD numbers are recomputed here and only here. */
  onSnapshot(snapshot: SnapshotMsg): void {
    this.#snapshot = snapshot;
    this.#publish();
  }

  /** A visible event for the feed; shown with the next snapshot. */
  onEvent(event: EventMsg): void {
    this.#seq += 1;
    this.#events = [
      { seq: this.#seq, tick: event.tick, kind: event.kind, data: event.data },
      ...this.#events,
    ].slice(0, EVENT_LIMIT);
  }

  select(selection: Selection | null): void {
    this.#selection = selection;
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
    );
  }
}
