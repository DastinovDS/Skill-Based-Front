/**
 * The list of alerts of the match (ui-style U7). Package C creates it and fills it with "they are
 * coming for your city"; package D draws the stack (and adds the overflow alerts). One field,
 * replaced as a whole once per snapshot (AGENTS.md 7.2), like `HudState.current`.
 *
 * Only what the player may know goes in: the public intents of planned orders (DEC-04, DEC-17: an
 * intent shows where it starts and where it aims, never the size or the path) and the owners of
 * cities, which are public. The client decides nothing about the fight to come.
 */
import type { PlayerId, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { incomingAlerts, type IncomingAlert } from './incoming.ts';
import { overflowAlerts, type OverflowAlert } from './overflow.ts';

/** A recruit that stayed home for want of the CP of its walk (`rally_walk_no_cp`, #930). */
export interface StayAlert {
  /** Order of arrival: keys the strip. */
  readonly seq: number;
  /** The city it stays in and the rally point it did not reach. */
  readonly node: number;
  readonly target: number | null;
}

/** How long the strip of a recruit that stayed home hangs, ms (the mockup's 3.5 s). */
export const STAY_MS = 3500;

export class AlertState {
  /** Newest information of the last snapshot; replaced, never mutated. */
  current = $state.raw<readonly IncomingAlert[]>([]);

  /** Own cities over their capacity (ui-style 12), the soonest loss first. */
  overflow = $state.raw<readonly OverflowAlert[]>([]);

  /** Recruits that just stayed home for want of CP (#930): each strip hangs `STAY_MS`. */
  stays = $state.raw<readonly StayAlert[]>([]);

  /** Ticks per second, to show a countdown in seconds. */
  readonly tickHz: number;

  readonly #me: PlayerId;
  readonly #delayTicks: number;
  readonly #attritionTicks: number;
  #cursor = -1;
  #staySeq = 0;
  #stayTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(me: PlayerId, rules: Pick<RulesetPublic, 'tick_hz' | 'orders' | 'capacity'>) {
    this.#me = me;
    this.#delayTicks = 0; // a plan gathers its bonus, it has no delay (DEC-41, item 10)
    this.#attritionTicks = rules.capacity.attrition_ticks;
    this.tickHz = rules.tick_hz;
  }

  onSnapshot(snapshot: SnapshotMsg): void {
    this.current = incomingAlerts(snapshot, this.#me, this.#delayTicks);
    this.overflow = overflowAlerts(snapshot, this.#me, this.#attritionTicks);
  }

  /** An own `rally_walk_no_cp`: its strip hangs for `STAY_MS`, the newest first. */
  onStay(node: number, target: number | null): void {
    this.#staySeq += 1;
    const seq = this.#staySeq;
    this.stays = [{ seq, node, target }, ...this.stays];
    const timer = setTimeout(() => {
      this.#stayTimers = this.#stayTimers.filter((t) => t !== timer);
      this.stays = this.stays.filter((s) => s.seq !== seq);
    }, STAY_MS);
    this.#stayTimers.push(timer);
  }

  reset(): void {
    this.current = [];
    this.overflow = [];
    this.clearStays();
    this.#cursor = -1;
  }

  /** Takes the strips of the recruits down (a reset, the end of the match). */
  clearStays(): void {
    for (const timer of this.#stayTimers) clearTimeout(timer);
    this.#stayTimers = [];
    this.stays = [];
  }

  /**
   * The city the camera goes to on `Space`: the overcrowded cities first (a unit is lost there),
   * then the cities they march on, one more per press, round and round; `null` without alerts.
   */
  nextNode(): number | null {
    const nodes = [...this.overflow, ...this.stays, ...this.current]
      .map((a) => a.node)
      .filter((node, i, all) => all.indexOf(node) === i);
    if (nodes.length === 0) {
      this.#cursor = -1;
      return null;
    }
    this.#cursor = (this.#cursor + 1) % nodes.length;
    return nodes[this.#cursor] ?? null;
  }
}
