import type { AckMember, AckMsg, Command, EventMsg } from '../protocol.gen.ts';
import type { GhostArrow } from '../render/interaction.ts';
import { ghostRejectMs } from '../render/intentLayout.ts';
import { UndoList } from './undoList.ts';

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
      /** A `group_move` (DEC-48, item B6): each group accepted or dropped with its code. */
      readonly members?: readonly AckMember[] | null;
    }
  | {
      readonly kind: 'rejected';
      readonly seq: number;
      readonly cmd: Command;
      /** `reject_code` of the `ack`. */
      readonly code: string;
      /** A `group_move` none of whose groups was valid: each group's code. */
      readonly members?: readonly AckMember[] | null;
    }
  /** The connection dropped between the command and its `ack`; the snapshots show the outcome. */
  | { readonly kind: 'lost'; readonly seq: number; readonly cmd: Command };

interface Pending {
  readonly cmd: Command;
  /** One ghost for a move, one per group of a `group_move` (DEC-48) that stood in a node. */
  readonly ghosts: readonly GhostOrder[];
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

  /** What `X` can undo (#764): lives as long as the match, whoever draws the orders. */
  readonly undo = new UndoList();

  /** Called for every answered command; the match UI turns it into a message. */
  onResult: ((result: CommandResult) => void) | null = null;

  /**
   * Called with `(from, to)` when a split this player sent made the new group `to` out of `from`:
   * the server names the new group only in the `group_split` event (the `ack` has no ids).
   */
  onSplit: ((from: string, to: string) => void) | null = null;

  /** Splits sent and not yet seen as a `group_split` event: group id -> how many are waiting. */
  readonly #splits = new Map<string, number>();

  readonly #pending = new Map<number, Pending>();
  /** Accepted moves waiting for the snapshot of their tick: seq -> their ghosts and `applied_tick`. */
  readonly #accepted = new Map<number, { ghosts: readonly GhostOrder[]; tick: number }>();
  #ghosts: readonly GhostOrder[] = [];

  /** `now`: milliseconds, for the fade of a rejected ghost (a test passes its own clock). */
  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  /** Ghost arrows, oldest first; the same array until they change. */
  ghosts(): readonly GhostOrder[] {
    const now = this.#now();
    const live = (g: GhostOrder): boolean =>
      g.rejectedAt === null || now - g.rejectedAt < ghostRejectMs(g.rejectCode ?? null);
    if (!this.#ghosts.every(live)) this.#setGhosts(this.#ghosts.filter(live));
    return this.#ghosts;
  }

  /** A move or a recruit is sent and not answered yet: it may become the newest thing to undo. */
  get undoAwaited(): boolean {
    for (const { cmd } of this.#pending.values()) {
      if (cmd.type === 'move' || cmd.type === 'recruit') return true;
    }
    return false;
  }

  /**
   * Remembers a sent command. `from` is the node of the group at the time, for the ghost arrow of
   * a move; a move without it (group on a road) has none. `route`: the server's route to the
   * target from its `reach` answer, which the ghost follows until the `ack` brings the order's path.
   * `memberRoutes`: the same for each group of a group order (#1004), in the order of its `groups`.
   */
  track(
    seq: number,
    cmd: Command,
    from: number | null = null,
    route: readonly number[] | null = null,
    members: readonly (number | null)[] = [],
    memberRoutes: readonly (readonly number[] | null)[] = [],
  ): void {
    const ghosts: GhostOrder[] = [];
    const ghostOf = (group: string, at: number, dest: number, planned: boolean): GhostOrder => ({
      seq,
      group,
      from: at,
      dest,
      planned,
      path: null,
      status: 'pending',
      rejectedAt: null,
      rejectCode: null,
    });
    const known = (at: number, dest: number, path: readonly number[] | null | undefined) =>
      path != null && path[0] === at && path.at(-1) === dest ? path : null;
    if (cmd.type === 'move' && from !== null) {
      ghosts.push({
        ...ghostOf(cmd.group, from, cmd.dest, cmd.planned),
        path: known(from, cmd.dest, route),
      });
    }
    // A group order (DEC-48): a ghost per group standing in a node (`members`, in the order of its
    // `groups`, `null` for one on a road), along the route the server gave it in `reach` (#1004),
    // a straight line without one, until the `ack` brings its path.
    if (cmd.type === 'group_move') {
      cmd.groups.forEach((group, i) => {
        const at = members[i] ?? null;
        if (at === null || at === cmd.dest) return;
        ghosts.push({
          ...ghostOf(group, at, cmd.dest, cmd.planned),
          path: known(at, cmd.dest, memberRoutes[i]),
        });
      });
    }
    this.#pending.set(seq, { cmd, ghosts });
    if (cmd.type === 'split') this.#splits.set(cmd.group, (this.#splits.get(cmd.group) ?? 0) + 1);
    // A newer order for the same group replaces the ghost of the older one.
    if (ghosts.length > 0) {
      let kept = this.#ghosts;
      for (const ghost of ghosts) kept = this.#without(ghost.group, kept);
      this.#setGhosts([...kept, ...ghosts]);
    }
  }

  onAck(ack: AckMsg): void {
    const pending = this.#pending.get(ack.seq);
    if (pending === undefined) return;
    this.#pending.delete(ack.seq);
    const { cmd } = pending;
    const members = ack.members;
    // Only a group order carries the answers of its groups (DEC-48, item B6).
    const answers = cmd.type === 'group_move' ? { members } : {};
    // A group of a `group_move` (DEC-48, item B6): its answer in `members`, by its place in `groups`.
    const memberOf = (group: string): AckMember | undefined =>
      cmd.type === 'group_move' ? members?.[cmd.groups.indexOf(group)] : undefined;
    if (ack.reject_code !== null) {
      const code = ack.reject_code;
      this.#forgetSplit(cmd);
      for (const ghost of pending.ghosts) {
        this.#reject(ghost, memberOf(ghost.group)?.reject_code ?? code);
      }
      this.onResult?.({ kind: 'rejected', seq: ack.seq, cmd, code, ...answers });
      return;
    }
    const confirmed: GhostOrder[] = [];
    for (const ghost of pending.ghosts) {
      if (!this.#ghosts.includes(ghost)) continue;
      const member = memberOf(ghost.group);
      if (member?.reject_code != null) {
        this.#reject(ghost, member.reject_code);
        continue;
      }
      const path = cmd.type === 'group_move' ? (member?.path ?? null) : ack.path;
      const done: GhostOrder = { ...ghost, path, status: 'accepted' };
      confirmed.push(done);
      this.#setGhosts(this.#ghosts.map((g) => (g === ghost ? done : g)));
    }
    if (confirmed.length > 0) {
      this.#accepted.set(ack.seq, { ghosts: confirmed, tick: ack.applied_tick });
    }
    this.onResult?.({ kind: 'accepted', seq: ack.seq, cmd, ...answers });
  }

  /** After a reconnect the server had the command but its `ack` was lost (`onAckLost`). */
  onAckLost(seq: number): void {
    const pending = this.#pending.get(seq);
    if (pending === undefined) return;
    this.#pending.delete(seq);
    this.#forgetSplit(pending.cmd);
    const lost = pending.ghosts;
    if (lost.length > 0) this.#setGhosts(this.#ghosts.filter((g) => !lost.includes(g)));
    this.onResult?.({ kind: 'lost', seq, cmd: pending.cmd });
  }

  /**
   * An event of the match: a `group_split` of a group this player has a split sent for names the
   * new group (`new_group`, the id the snapshots use). Other events are not the book's.
   */
  onEvent(event: EventMsg): void {
    if (event.kind !== 'group_split') return;
    const { group, new_group: created } = event.data;
    if (typeof group !== 'string' || typeof created !== 'string') return;
    if (!this.#forgetSplit({ type: 'split', group, n: 0 })) return;
    this.onSplit?.(group, created);
  }

  /** A frame built on the snapshot of `tick` is on screen: earlier accepted orders show in it. */
  onRendered(tick: number): void {
    if (this.#accepted.size === 0) return;
    const done: GhostOrder[] = [];
    for (const [seq, { ghosts, tick: applied }] of this.#accepted) {
      if (tick >= applied) {
        this.#accepted.delete(seq);
        done.push(...ghosts);
      }
    }
    if (done.length > 0) this.#setGhosts(this.#ghosts.filter((g) => !done.includes(g)));
  }

  clear(): void {
    this.#pending.clear();
    this.#splits.clear();
    this.#accepted.clear();
    this.undo.clear();
    this.#setGhosts([]);
  }

  /** One waiting split of the command's group is done (or never happened); `false`: none was waiting. */
  #forgetSplit(cmd: Command): boolean {
    if (cmd.type !== 'split') return false;
    const waiting = this.#splits.get(cmd.group) ?? 0;
    if (waiting === 0) return false;
    if (waiting === 1) this.#splits.delete(cmd.group);
    else this.#splits.set(cmd.group, waiting - 1);
    return true;
  }

  /** `ghosts` without those of `group`; an accepted one of them is no longer waited for. */
  #without(group: string, ghosts: readonly GhostOrder[]): readonly GhostOrder[] {
    return ghosts.filter((g) => {
      if (g.group !== group) return true;
      const accepted = this.#accepted.get(g.seq);
      if (accepted !== undefined) {
        const rest = accepted.ghosts.filter((a) => a.group !== group);
        if (rest.length === 0) this.#accepted.delete(g.seq);
        else this.#accepted.set(g.seq, { ...accepted, ghosts: rest });
      }
      return false;
    });
  }

  /** The ghost stays on the map, marked rejected: the view shakes it and lets it fade. */
  #reject(ghost: GhostOrder, code: string): void {
    if (!this.#ghosts.includes(ghost)) return;
    const rejected: GhostOrder = {
      ...ghost,
      status: 'rejected',
      rejectedAt: this.#now(),
      rejectCode: code,
    };
    this.#setGhosts(this.#ghosts.map((g) => (g === ghost ? rejected : g)));
  }

  #setGhosts(next: readonly GhostOrder[]): void {
    this.#ghosts = next;
  }
}
