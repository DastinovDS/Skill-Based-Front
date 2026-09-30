/**
 * Ring buffer of server snapshots by tick, and the render clock (CLI-02, #58).
 *
 * Rendering runs `delayTicks` (2-3) behind the newest snapshot so that there are always two
 * snapshots to interpolate between. Plain TypeScript, not `$state` (AGENTS.md, 7.2): the render
 * loop calls `sample()` every frame, the HUD reads a snapshot 10 times a second elsewhere.
 *
 * The render time advances with the wall clock, 1 tick per `tickMs`, and is kept inside
 * [newest - delayTicks, newest - delayTicks + 1]: a late snapshot makes the picture wait (never
 * extrapolate), and a pause of the render loop or a long gap makes it jump into the window. The
 * upper bound keeps the cushion: the clock never runs ahead of the snapshots by more than one tick,
 * so after a stall the delay is still `delayTicks`, not zero.
 */
import type { SnapshotMsg } from '../protocol.gen.ts';
import { interpolateFrame, type RenderFrame } from './interpolate.ts';

export interface SnapshotBufferOptions {
  /** How many ticks the render time stays behind the newest snapshot. Default 2. */
  delayTicks?: number;
  /** Snapshots kept. Default 8. */
  capacity?: number;
  /** Tick length in ms (`1000 / ruleset_public.tick_hz`). Default 100. */
  tickMs?: number;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
}

/** What `push` did with a snapshot. */
export type PushResult = 'added' | 'duplicate' | 'stale';

export class SnapshotBuffer {
  #delayTicks: number;
  readonly #capacity: number;
  readonly #tickMs: number;
  readonly #now: () => number;

  /** Ascending by `tick`, no equal ticks. */
  #snapshots: SnapshotMsg[] = [];
  #renderTick = 0;
  #lastSampleAt = 0;

  constructor(opts: SnapshotBufferOptions = {}) {
    this.#delayTicks = opts.delayTicks ?? 2;
    this.#capacity = Math.max(2, opts.capacity ?? 8);
    this.#tickMs = opts.tickMs ?? 100;
    this.#now = opts.now ?? (() => performance.now());
  }

  get size(): number {
    return this.#snapshots.length;
  }

  get newestTick(): number | null {
    return this.#snapshots.at(-1)?.tick ?? null;
  }

  get delayTicks(): number {
    return this.#delayTicks;
  }

  set delayTicks(ticks: number) {
    this.#delayTicks = Math.max(0, ticks);
  }

  /**
   * Add a snapshot. The same tick twice is a `duplicate` and an older tick than the newest is
   * `stale` (the connection is ordered, so it is a resent frame); both are ignored. A gap in
   * ticks is fine: the server keeps only its latest snapshot for a slow client.
   */
  push(snapshot: SnapshotMsg): PushResult {
    const newest = this.newestTick;
    if (newest !== null && snapshot.tick < newest) return 'stale';
    if (snapshot.tick === newest) return 'duplicate';
    if (newest === null) {
      this.#renderTick = snapshot.tick - this.#delayTicks;
      this.#lastSampleAt = this.#now();
    }
    this.#snapshots.push(snapshot);
    if (this.#snapshots.length > this.#capacity) this.#snapshots.shift();
    return 'added';
  }

  /** Forget everything: on `resync` and on reconnect the next snapshot starts a new timeline. */
  clear(): void {
    this.#snapshots = [];
  }

  /** The frame to draw now; `null` until the first snapshot. */
  sample(): RenderFrame | null {
    const newest = this.newestTick;
    const oldest = this.#snapshots[0];
    if (newest === null || oldest === undefined) return null;

    const now = this.#now();
    this.#renderTick += (now - this.#lastSampleAt) / this.#tickMs;
    this.#lastSampleAt = now;
    const earliest = newest - this.#delayTicks;
    const latest = Math.min(newest, earliest + 1);
    this.#renderTick = Math.min(latest, Math.max(earliest, this.#renderTick));

    // `a`: the newest snapshot not after the render time (the oldest one if none is);
    // `b`: the one right after it.
    let i = this.#snapshots.length - 1;
    while (i > 0 && (this.#snapshots[i] as SnapshotMsg).tick > this.#renderTick) i--;
    const a = this.#snapshots[i] as SnapshotMsg;
    return interpolateFrame(a, this.#snapshots[i + 1] ?? null, this.#renderTick);
  }
}
