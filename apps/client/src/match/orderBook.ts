import type { AckMsg, Command } from '../protocol.gen.ts';
import type { GhostArrow } from '../render/interaction.ts';
import { GHOST_REJECT_MS } from '../render/style.ts';

/** An order the player sent that no snapshot shows yet. */
export interface GhostOrder extends GhostArrow {
  readonly seq: number;
  readonly group: string;
  readonly status: NonNullable<GhostArrow['status']>;
  readonly rejectedAt: number | null;
}

export type CommandResult =
  | {
      readonly kind: 'accepted';
      readonly seq: number;
      readonly cmd: Command;
      /** `arrive_tick` of the `ack` (a transfer, DEC-18); `null` for the other commands. */
      readonly arriveTick?: number | null;
    }
  | {
      readonly kind: 'rejected';
      readonly seq: number;
      readonly cmd: Command;
      /** `reject_code` of the `ack`. */
      readonly code: string;
    }
  /** The connection dropped between the command and its `ack`; the snapshots show the outcome. */
  | { readonly kind: 'lost'; readonly seq: number; readonly cmd: Command };

interface Pending {
  readonly cmd: Command;
  readonly ghost: GhostOrder | null;
}

/**
 * Commands sent and not answered (CLI-06, #62; AGENTS.md 7.3): a move shows at once as a dashed
 * ghost arrow. The `ack` accepting it makes the ghost solid, and it stays until a rendered
 * snapshot reaches the tick it was applied at (the order line of the snapshot takes over). The
 * `ack` rejecting it leaves the ghost to shake and fade for `GHOST_REJECT_MS` (U6), then it is
 * gone. Knows no rules: the path is the server's, from `ack`.
 */
export class OrderBook {
  readonly #now: () => number;

  /** Called for every answered command; the match UI turns it into a message. */
  onResult: ((result: CommandResult) => void) | null = null;

  readonly #pending = new Map<number, Pending>();
  /** Accepted moves waiting for the snapshot of their tick: seq -> `applied_tick`. */
  readonly #accepted = new Map<number, { ghost: GhostOrder; tick: number }>();
  #ghosts: readonly GhostOrder[] = [];

  /** `now`: milliseconds, for the fade of a rejected ghost (a test passes its own clock). */
  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  /** Ghost arrows, oldest first; the same array until they change. */
  ghosts(): readonly GhostOrder[] {
    const now = this.#now();
    if (this.#ghosts.some((g) => g.rejectedAt !== null && now - g.rejectedAt >= GHOST_REJECT_MS)) {
      this.#setGhosts(
        this.#ghosts.filter((g) => g.rejectedAt === null || now - g.rejectedAt < GHOST_REJECT_MS),
      );
    }
    return this.#ghosts;
  }

  /**
   * Remembers a sent command. `from` is the node of the group at the time, for the ghost arrow of
   * a move; a move without it (group on a road) has none.
   */
  track(seq: number, cmd: Command, from: number | null = null): void {
    let ghost: GhostOrder | null = null;
    if (cmd.type === 'move' && from !== null) {
      ghost = {
        seq,
        group: cmd.group,
        from,
        dest: cmd.dest,
        planned: cmd.planned,
        path: null,
        status: 'pending',
        rejectedAt: null,
      };
    }
    this.#pending.set(seq, { cmd, ghost });
    // A newer order for the same group replaces the ghost of the older one.
    if (ghost !== null) this.#setGhosts([...this.#without(ghost.group), ghost]);
  }

  onAck(ack: AckMsg): void {
    const pending = this.#pending.get(ack.seq);
    if (pending === undefined) return;
    this.#pending.delete(ack.seq);
    if (ack.reject_code !== null) {
      this.#reject(pending.ghost);
      this.onResult?.({ kind: 'rejected', seq: ack.seq, cmd: pending.cmd, code: ack.reject_code });
      return;
    }
    const ghost = pending.ghost;
    if (ghost !== null && this.#ghosts.includes(ghost)) {
      const confirmed: GhostOrder = { ...ghost, path: ack.path, status: 'accepted' };
      this.#accepted.set(ack.seq, { ghost: confirmed, tick: ack.applied_tick });
      this.#setGhosts(this.#ghosts.map((g) => (g === ghost ? confirmed : g)));
    }
    this.onResult?.({
      kind: 'accepted',
      seq: ack.seq,
      cmd: pending.cmd,
      arriveTick: ack.arrive_tick,
    });
  }

  /** After a reconnect the server had the command but its `ack` was lost (`onAckLost`). */
  onAckLost(seq: number): void {
    const pending = this.#pending.get(seq);
    if (pending === undefined) return;
    this.#pending.delete(seq);
    this.#drop(pending.ghost);
    this.onResult?.({ kind: 'lost', seq, cmd: pending.cmd });
  }

  /** A frame built on the snapshot of `tick` is on screen: earlier accepted orders show in it. */
  onRendered(tick: number): void {
    if (this.#accepted.size === 0) return;
    const done: GhostOrder[] = [];
    for (const [seq, { ghost, tick: applied }] of this.#accepted) {
      if (tick >= applied) {
        this.#accepted.delete(seq);
        done.push(ghost);
      }
    }
    if (done.length > 0) this.#setGhosts(this.#ghosts.filter((g) => !done.includes(g)));
  }

  clear(): void {
    this.#pending.clear();
    this.#accepted.clear();
    this.#setGhosts([]);
  }

  #without(group: string): GhostOrder[] {
    return this.#ghosts.filter((g) => {
      if (g.group !== group) return true;
      this.#accepted.delete(g.seq);
      return false;
    });
  }

  /** The ghost stays on the map, marked rejected: the view shakes it and lets it fade. */
  #reject(ghost: GhostOrder | null): void {
    if (ghost === null || !this.#ghosts.includes(ghost)) return;
    const rejected: GhostOrder = { ...ghost, status: 'rejected', rejectedAt: this.#now() };
    this.#setGhosts(this.#ghosts.map((g) => (g === ghost ? rejected : g)));
  }

  #drop(ghost: GhostOrder | null): void {
    if (ghost !== null) this.#setGhosts(this.#ghosts.filter((g) => g !== ghost));
  }

  #setGhosts(next: readonly GhostOrder[]): void {
    this.#ghosts = next;
  }
}
