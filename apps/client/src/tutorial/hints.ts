/**
 * The triggers of the first match's hints (`docs/design/tutorial.md`, section 5): which hint may show
 * now, read from the snapshots and the events the client gets anyway. Plain TypeScript. A trigger
 * compares fields of the own view and of own events; it never works out a rule (`AGENTS.md` 7.1).
 *
 * - H1, a bigger map: 5 s into the match; the own capital.
 * - H2, over its capacity: the first own node with `attrition_in` set, while it is.
 * - H3, full warehouses or CP at the cap: the first own `charge_burned` or `cp_burned`.
 * - H4, strike together: an own group joins a fight that already had a round (`groups` of the
 *   fight grows while `last_round` is set).
 * - H5, rally point: the third own `recruited` in a city without `rally_point`.
 *
 * Whether a hint was shown, the hints are off or an Advanced chapter is done is the coach's
 * question (`hintCoach.svelte.ts`).
 */
import type { EventMsg, MapFile, PlayerId, SnapshotMsg, View } from '../protocol.gen.ts';
import type { HintId } from './progress.ts';

/** H1 shows this many seconds into the match. */
export const BIGGER_MAP_AFTER_S = 5;
/** H5 shows at this own recruit in a city without a rally point. */
export const RALLY_AFTER_RECRUITS = 3;

/** A hint ready to show: what it says and where it points. */
export interface HintShow {
  readonly id: HintId;
  /** H3: the stock that is full (the charges point at the stance chip, the CP at the gauge). */
  readonly variant: 'charges' | 'cp' | null;
  /** The place the card points at and the map rings; null for a HUD piece or a road. */
  readonly node: number | null;
  /** A fight on a road (H4): its two ends. */
  readonly road: readonly [number, number] | null;
  /** The HUD piece the card points at (H3). */
  readonly hud: 'stance' | 'cp' | null;
}

const ORDER: readonly HintId[] = ['H1', 'H2', 'H3', 'H4', 'H5'];

function show(id: HintId, at: Partial<Omit<HintShow, 'id'>>): HintShow {
  return { id, variant: null, node: null, road: null, hud: null, ...at };
}

export class HintWatcher {
  readonly #map: MapFile;
  readonly #me: PlayerId;
  readonly #tickHz: number;
  /** The hints whose trigger fired (H2 is read from the latest view instead). */
  readonly #fired = new Map<HintId, HintShow>();
  /** Hints already shown (or passed over): never fired again. */
  readonly #gone = new Set<HintId>();
  #view: View | null = null;
  /** The fights of the previous snapshot: their own groups. */
  #fights = new Map<string, ReadonlySet<string>>();
  #recruits = 0;

  constructor(map: MapFile, me: PlayerId, tickHz: number) {
    this.#map = map;
    this.#me = me;
    this.#tickHz = tickHz;
  }

  onSnapshot(msg: SnapshotMsg): void {
    const view = msg.view;
    this.#view = view;
    if (msg.tick >= BIGGER_MAP_AFTER_S * this.#tickHz) {
      const capital = this.#map.nodes.find((node) => node.capital_of === this.#me);
      this.#fire(show('H1', { node: capital?.id ?? null }));
    }
    const fights = new Map<string, ReadonlySet<string>>();
    for (const fight of view.fights) {
      const before = this.#fights.get(fight.id);
      const grew = before !== undefined && fight.groups.some((group) => !before.has(group));
      if (grew && fight.last_round !== null) {
        const edge = fight.edge === null ? undefined : this.#map.edges[fight.edge];
        this.#fire(
          fight.node !== null
            ? show('H4', { node: fight.node })
            : show('H4', { road: edge === undefined ? null : [edge.a, edge.b] }),
        );
      }
      fights.set(fight.id, new Set(fight.groups));
    }
    this.#fights = fights;
  }

  onEvent(msg: EventMsg): void {
    if (msg.data['player'] !== this.#me) return;
    if (msg.kind === 'charge_burned') {
      this.#fire(show('H3', { variant: 'charges', hud: 'stance' }));
    } else if (msg.kind === 'cp_burned') {
      this.#fire(show('H3', { variant: 'cp', hud: 'cp' }));
    } else if (msg.kind === 'recruited') {
      const node = msg.data['node'];
      if (typeof node !== 'number') return;
      // A city with a rally point sends its recruits on by themselves: they do not count.
      if (this.#view?.nodes[node]?.rally_point != null) return;
      this.#recruits += 1;
      if (this.#recruits >= RALLY_AFTER_RECRUITS) this.#fire(show('H5', { node }));
    }
  }

  #fire(hint: HintShow): void {
    if (this.#gone.has(hint.id) || this.#fired.has(hint.id)) return;
    this.#fired.set(hint.id, hint);
  }

  /** The hints that may show now, H1 first. */
  ready(): HintShow[] {
    const out: HintShow[] = [];
    for (const id of ORDER) {
      if (this.#gone.has(id)) continue;
      if (id === 'H2') {
        const node = this.#view?.nodes.find((n) => n.owner === this.#me && n.attrition_in !== null);
        if (node !== undefined) out.push(show('H2', { node: node.id }));
        continue;
      }
      const hint = this.#fired.get(id);
      if (hint !== undefined) out.push(hint);
    }
    return out;
  }

  /** The hint showed, or will never show: its trigger is not asked again. */
  drop(id: HintId): void {
    this.#gone.add(id);
    this.#fired.delete(id);
  }
}
