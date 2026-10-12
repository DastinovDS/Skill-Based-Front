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

export type Alert = IncomingAlert | OverflowAlert;

export class AlertState {
  /** Newest information of the last snapshot; replaced, never mutated. */
  current = $state.raw<readonly IncomingAlert[]>([]);

  /** Own cities over their capacity (ui-style 12), the soonest loss first. */
  overflow = $state.raw<readonly OverflowAlert[]>([]);

  /** Ticks per second, to show a countdown in seconds. */
  readonly tickHz: number;

  readonly #me: PlayerId;
  readonly #delayTicks: number;
  readonly #attritionTicks: number;
  #cursor = -1;

  constructor(me: PlayerId, rules: Pick<RulesetPublic, 'tick_hz' | 'orders' | 'capacity'>) {
    this.#me = me;
    this.#delayTicks = rules.orders.planned_delay_ticks;
    this.#attritionTicks = rules.capacity.attrition_ticks;
    this.tickHz = rules.tick_hz;
  }

  onSnapshot(snapshot: SnapshotMsg): void {
    this.current = incomingAlerts(snapshot, this.#me, this.#delayTicks);
    this.overflow = overflowAlerts(snapshot, this.#me, this.#attritionTicks);
  }

  reset(): void {
    this.current = [];
    this.overflow = [];
    this.#cursor = -1;
  }

  /**
   * The city the camera goes to on `Space`: the overcrowded cities first (a unit is lost there),
   * then the cities they march on, one more per press, round and round; `null` without alerts.
   */
  nextNode(): number | null {
    const nodes = [...this.overflow, ...this.current]
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
