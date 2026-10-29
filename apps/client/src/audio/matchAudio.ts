/**
 * The sounds of one match (#71): server messages in, sounds out. An event waits until the map
 * draws its tick, like the toasts, so the sound does not run ahead of the picture. A sound that
 * waited longer than `STALE_MS` (a hidden tab does not draw frames) is dropped, so coming back
 * does not play a burst. The fight-round hit is skipped under "less motion".
 */
import { reducedMotion } from '../render/motion.ts';
import type { PlayerId, ServerMsg } from '../protocol.gen.ts';
import type { SoundId } from './recipes.ts';
import { cuesOf } from './soundMap.ts';

export const STALE_MS = 500;
const QUEUE_MAX = 64;

export interface MatchAudioOptions {
  me: PlayerId;
  play: (id: SoundId) => void;
  now?: () => number;
  visible?: () => boolean;
  reduced?: () => boolean;
}

interface Waiting {
  id: SoundId;
  tick: number;
  at: number;
}

export class MatchAudio {
  readonly #me: PlayerId;
  readonly #play: (id: SoundId) => void;
  readonly #now: () => number;
  readonly #visible: () => boolean;
  readonly #reduced: () => boolean;
  #queue: Waiting[] = [];

  constructor(opts: MatchAudioOptions) {
    this.#me = opts.me;
    this.#play = opts.play;
    this.#now = opts.now ?? (() => performance.now());
    this.#visible = opts.visible ?? (() => document.visibilityState !== 'hidden');
    this.#reduced = opts.reduced ?? reducedMotion;
  }

  onMessage(msg: ServerMsg): void {
    for (const cue of cuesOf(msg, this.#me)) {
      if (cue.id === 'fightRound' && this.#reduced()) continue;
      if (cue.tick === null) {
        if (this.#visible()) this.#play(cue.id);
      } else {
        this.#queue.push({ id: cue.id, tick: cue.tick, at: this.#now() });
      }
    }
    if (this.#queue.length > QUEUE_MAX) this.#queue = this.#queue.slice(-QUEUE_MAX);
  }

  /** The map drew tick `tick`: play what is due, drop what is stale. */
  onRender(tick: number): void {
    if (this.#queue.length === 0) return;
    const now = this.#now();
    const visible = this.#visible();
    const rest: Waiting[] = [];
    for (const item of this.#queue) {
      if (item.tick > tick) {
        rest.push(item);
      } else if (visible && now - item.at <= STALE_MS) {
        this.#play(item.id);
      }
    }
    this.#queue = rest;
  }

  /** The snapshot timeline broke (a reconnect): forget what waits. */
  reset(): void {
    this.#queue = [];
  }
}
