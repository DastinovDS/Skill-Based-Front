/**
 * The rounds of the fights going on, kept for the fight board (DEC-24, item I; DEC-29; #295).
 * Plain TypeScript: no Svelte, no PixiJS. It only collects what the server sent and decides
 * nothing about a fight (AGENTS.md 7.1).
 *
 * Two sources, one record per round (told by its tick): the events `fight_round` (every round
 * while the client is connected, shots of both sides with the virtual ones apart, the spent
 * charges and the losses) and `FightView.last_round` of a snapshot (the same numbers; it fills the
 * history after a reconnect, when the earlier events are gone). The view has no list of all the
 * rounds, by design (#294), so after a reconnect the history starts at `last_round`; `complete`
 * says whether the rounds held add up to the totals of the view (`shots`, `losses`).
 *
 * All pairs are by player id (index = player), the way the protocol has them; `fightCards` turns a
 * history into the own-and-enemy view of one player.
 */
import type {
  EventMsg,
  FightRoundView,
  FightView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';

/** Rounds kept per fight; a fight is a few seconds of rounds, so this is only a safety cap. */
export const MAX_ROUNDS = 100;

type Pair = readonly [number, number];

/** One round of a fight, by player. */
export interface RoundRecord {
  readonly tick: number;
  /** Shots made, the virtual (bonus, terrain) ones among them. */
  readonly shots: Pair;
  readonly virtual: Pair;
  /** Charges that left the units of the player. */
  readonly spent: Pair;
  /** Units the player lost. */
  readonly losses: Pair;
}

/** A fight and the rounds seen of it. */
export interface FightHistory {
  readonly id: string;
  readonly node: number | null;
  readonly edge: number | null;
  /** Oldest first. */
  readonly rounds: readonly RoundRecord[];
  /** Totals of the fight so far, from the view; `null` until a snapshot lists the fight. */
  readonly totals: { readonly shots: Pair; readonly losses: Pair } | null;
  /** The tick of the next round, from the view. */
  readonly nextRoundTick: number | null;
}

interface Entry {
  id: string;
  node: number | null;
  edge: number | null;
  rounds: RoundRecord[];
  totals: FightHistory['totals'];
  nextRoundTick: number | null;
  /** The newest tick an event or a snapshot told about this fight. */
  touched: number;
}

function intField(data: EventMsg['data'], key: string): number | null {
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

function pairField(data: EventMsg['data'], key: string): Pair | null {
  const a = intField(data, `${key}_0`);
  const b = intField(data, `${key}_1`);
  return a === null || b === null ? null : [a, b];
}

/** The round of a `fight_round` event; `null` for an event without every number (an old server). */
export function roundOfEvent(event: EventMsg): RoundRecord | null {
  const shots = pairField(event.data, 'shots');
  const virtual = pairField(event.data, 'virtual');
  const spent = pairField(event.data, 'spent');
  const losses = pairField(event.data, 'losses');
  if (shots === null || virtual === null || spent === null || losses === null) return null;
  return { tick: event.tick, shots, virtual, spent, losses };
}

function roundOfView(round: FightRoundView): RoundRecord {
  return {
    tick: round.tick,
    shots: round.shots,
    virtual: round.virtual,
    spent: round.spent,
    losses: round.losses,
  };
}

const sum = (
  rounds: readonly RoundRecord[],
  pick: (round: RoundRecord) => Pair,
  p: 0 | 1,
): number => rounds.reduce((total, round) => total + pick(round)[p], 0);

/**
 * Whether the rounds held make up the whole fight: their shots and losses equal the totals of the
 * view. Without totals (no snapshot yet) there is nothing to compare, so yes.
 */
export function isComplete(history: FightHistory): boolean {
  const { totals, rounds } = history;
  if (totals === null) return true;
  return ([0, 1] as const).every(
    (p) =>
      sum(rounds, (r) => r.shots, p) === totals.shots[p] &&
      sum(rounds, (r) => r.losses, p) === totals.losses[p],
  );
}

export class FightLog {
  readonly #fights = new Map<string, Entry>();

  /** `fight_started` opens a fight, `fight_round` adds a round; other events are not its business. */
  onEvent(event: EventMsg): void {
    if (event.kind !== 'fight_started' && event.kind !== 'fight_round') return;
    const id = event.data['fight'];
    if (typeof id !== 'string') return;
    const entry = this.#entry(id, event.tick);
    entry.node = intField(event.data, 'node');
    entry.edge = intField(event.data, 'edge');
    if (event.kind === 'fight_round') {
      const round = roundOfEvent(event);
      if (round !== null) this.#add(entry, round);
    }
  }

  /**
   * The fights of a snapshot: totals, the next round and the latest round of each (a round already
   * held from its event is not added twice). A fight that is gone from the view has ended: its
   * history is dropped, unless an event newer than the snapshot has just opened it.
   */
  onSnapshot(snapshot: SnapshotMsg): void {
    const listed = new Set<string>();
    for (const fight of snapshot.view.fights) {
      listed.add(fight.id);
      this.#fromView(fight, snapshot.tick);
    }
    for (const [id, entry] of this.#fights) {
      if (!listed.has(id) && entry.touched <= snapshot.tick) this.#fights.delete(id);
    }
  }

  /** Forget everything: the timeline broke (a reconnect); the next snapshot restarts the history. */
  clear(): void {
    this.#fights.clear();
  }

  /** The fights known, oldest first (by id of arrival). Fresh objects: safe to keep. */
  histories(): readonly FightHistory[] {
    return [...this.#fights.values()].map((entry) => ({
      id: entry.id,
      node: entry.node,
      edge: entry.edge,
      rounds: [...entry.rounds],
      totals: entry.totals,
      nextRoundTick: entry.nextRoundTick,
    }));
  }

  #entry(id: string, tick: number): Entry {
    let entry = this.#fights.get(id);
    if (entry === undefined) {
      entry = {
        id,
        node: null,
        edge: null,
        rounds: [],
        totals: null,
        nextRoundTick: null,
        touched: tick,
      };
      this.#fights.set(id, entry);
    }
    entry.touched = Math.max(entry.touched, tick);
    return entry;
  }

  #fromView(fight: FightView, tick: number): void {
    const entry = this.#entry(fight.id, tick);
    entry.node = fight.node;
    entry.edge = fight.edge;
    entry.totals = { shots: fight.shots, losses: fight.losses };
    entry.nextRoundTick = fight.next_round_tick;
    if (fight.last_round !== null) this.#add(entry, roundOfView(fight.last_round));
  }

  #add(entry: Entry, round: RoundRecord): void {
    entry.touched = Math.max(entry.touched, round.tick);
    if (entry.rounds.some((held) => held.tick === round.tick)) return;
    entry.rounds.push(round);
    entry.rounds.sort((a, b) => a.tick - b.tick);
    if (entry.rounds.length > MAX_ROUNDS) entry.rounds.splice(0, entry.rounds.length - MAX_ROUNDS);
  }
}

// --- One player's cards -------------------------------------------------------------------------

/** One round as one player sees it: own side and the enemy's. */
export interface RoundRow {
  readonly tick: number;
  readonly own: RoundSide;
  readonly enemy: RoundSide;
}

export interface RoundSide {
  /** Shots made, the virtual ones among them. */
  readonly shots: number;
  readonly virtual: number;
  /** Charges that left the units of this side. */
  readonly spent: number;
  /** Units this side lost. */
  readonly losses: number;
}

/** A fight going on, as the board shows it. */
export interface FightCard {
  readonly id: string;
  readonly node: number | null;
  readonly edge: number | null;
  /** Newest first. */
  readonly rows: readonly RoundRow[];
  /** `false`: rounds before the first row are missing (a reconnect) or were cut. */
  readonly complete: boolean;
  /** The totals of the fight so far from the view; `null` until a snapshot lists the fight. */
  readonly totals: { readonly own: TotalSide; readonly enemy: TotalSide } | null;
}

export interface TotalSide {
  readonly shots: number;
  readonly losses: number;
}

function side(round: RoundRecord, p: PlayerId): RoundSide {
  return {
    shots: round.shots[p],
    virtual: round.virtual[p],
    spent: round.spent[p],
    losses: round.losses[p],
  };
}

/** The cards of the fights that a snapshot lists, for player `me`; the rest are not going on. */
export function fightCards(histories: readonly FightHistory[], me: PlayerId): readonly FightCard[] {
  const enemy: PlayerId = me === 0 ? 1 : 0;
  return histories
    .filter((history) => history.totals !== null)
    .map((history) => ({
      id: history.id,
      node: history.node,
      edge: history.edge,
      rows: history.rounds
        .map((round) => ({ tick: round.tick, own: side(round, me), enemy: side(round, enemy) }))
        .reverse(),
      complete: isComplete(history),
      totals:
        history.totals === null
          ? null
          : {
              own: { shots: history.totals.shots[me], losses: history.totals.losses[me] },
              enemy: { shots: history.totals.shots[enemy], losses: history.totals.losses[enemy] },
            },
    }));
}
