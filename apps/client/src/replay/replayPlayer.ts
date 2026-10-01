/**
 * Playback of a replay (CLI-10, #66): a `RenderSource` for the map, driven by a clock that the
 * viewer controls (play/pause, speed, seek). Between two frames (2 a second) the picture is
 * interpolated by CLI-02, so the motion is smooth at ×1 and still readable at ×16.
 *
 * Plain TypeScript, no Svelte state: the map asks for `frame()` every animation frame, the
 * controls poll the getters a few times a second (a getter moves the clock too, so the controls
 * stay right even when nothing draws).
 */
import { interpolateFrame, type RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, SnapshotMsg } from '../protocol.gen.ts';
import type { RenderSource } from '../render/source.ts';
import type { ReplayFile } from './replayFile.ts';
import { buildTimeline, type Timeline } from './timeline.ts';

/** Playback speeds of the controls. */
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** Fight marks live a few seconds, so a short tail of events before the position is enough. */
const EVENT_TAIL = 64;

export class ReplayPlayer implements RenderSource {
  readonly tickHz: number;
  /** The last tick of the match. */
  readonly duration: number;
  readonly outcome: ReplayFile['outcome'];
  readonly #timeline: Timeline;
  readonly #now: () => number;
  #position = 0;
  #playing = false;
  #speed: Speed = 1;
  #lastAt = 0;
  #eventEnd = -1;
  #events: readonly EventMsg[] = [];

  constructor(file: ReplayFile, now: () => number = () => performance.now()) {
    this.tickHz = file.tick_hz;
    this.duration = file.frames.at(-1)?.t ?? 0;
    this.outcome = file.outcome;
    this.#timeline = buildTimeline(file);
    this.#now = now;
  }

  /** Render time in ticks (fractional). */
  get position(): number {
    this.#advance();
    return this.#position;
  }

  get playing(): boolean {
    this.#advance();
    return this.#playing;
  }

  get speed(): Speed {
    return this.#speed;
  }

  get ended(): boolean {
    this.#advance();
    return this.#position >= this.duration;
  }

  /** The snapshot at or before the position: the numbers the scoreboard shows. */
  get current(): SnapshotMsg {
    this.#advance();
    return this.#timeline.snapshots[this.#index(this.#position)] as SnapshotMsg;
  }

  play(): void {
    if (this.#playing) return;
    if (this.#position >= this.duration) this.#position = 0;
    this.#advance();
    this.#playing = true;
  }

  pause(): void {
    this.#advance();
    this.#playing = false;
  }

  toggle(): void {
    if (this.#playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed): void {
    this.#advance();
    this.#speed = speed;
  }

  /** Jump to a tick (clamped to the match). Keeps playing or staying paused. */
  seek(tick: number): void {
    this.#lastAt = this.#now();
    this.#position = Math.min(this.duration, Math.max(0, tick));
  }

  frame(): RenderFrame {
    this.#advance();
    const { snapshots, groupOwners, packetOwners } = this.#timeline;
    const i = this.#index(this.#position);
    const frame = interpolateFrame(
      snapshots[i] as SnapshotMsg,
      snapshots[i + 1] ?? null,
      this.#position,
    );
    return {
      ...frame,
      groups: frame.groups.map((g) => ({ ...g, owner: groupOwners.get(g.group.id) })),
      packets: frame.packets.map((p) => ({ ...p, owner: packetOwners.get(p.packet.id) })),
    };
  }

  /** Events up to the position; the same array while that set is unchanged. */
  events(): readonly EventMsg[] {
    const all = this.#timeline.events;
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((all[mid] as EventMsg).tick <= this.#position) lo = mid + 1;
      else hi = mid;
    }
    if (lo !== this.#eventEnd) {
      this.#eventEnd = lo;
      this.#events = all.slice(Math.max(0, lo - EVENT_TAIL), lo);
    }
    return this.#events;
  }

  #advance(): void {
    const now = this.#now();
    if (this.#playing) {
      const ticks = ((now - this.#lastAt) / 1000) * this.tickHz * this.#speed;
      this.#position = Math.min(this.duration, this.#position + ticks);
      if (this.#position >= this.duration) this.#playing = false;
    }
    this.#lastAt = now;
  }

  /** Index of the last snapshot not after `tick`. */
  #index(tick: number): number {
    const { snapshots } = this.#timeline;
    let lo = 0;
    let hi = snapshots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((snapshots[mid] as SnapshotMsg).tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
