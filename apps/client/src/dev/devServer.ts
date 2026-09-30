/**
 * Stand-in for the match server on the dev screen (CLI-06, #62), until SRV-03 (#48) exists. It
 * speaks the real protocol through a fake socket, so the dev screen runs the same
 * `MatchConnection` as a live match: `welcome`, a snapshot 10 times a second (`devSnapshot`), an
 * `ack` a moment after each command. It answers `move` and `cancel_order` only, and is not a
 * rules engine: the orders it accepts stand in the snapshots and nothing moves. The path is a
 * breadth-first search on the map, good enough for a picture.
 */
import { devEvent, devSnapshot, DEV_PLAYER } from '../hud/devFeed.ts';
import { MockSocket } from '../net/fakeServer.ts';
import type {
  AckMsg,
  ClientMsg,
  Command,
  MapFile,
  OrderView,
  RulesetPublic,
  SnapshotMsg,
} from '../protocol.gen.ts';

/** How long an `ack` takes, ms: long enough to see the ghost arrow. */
export const DEV_ACK_MS = 800;

export interface DevServer {
  createSocket: (url: string) => WebSocket;
  stop: () => void;
}

/** Nodes from `from` to `to` along roads, or `null`. */
export function devPath(map: MapFile, from: number, to: number): [number, ...number[]] | null {
  const via = new Map<number, number>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i] as number;
    if (node === to) break;
    for (const edge of map.edges) {
      const next = edge.a === node ? edge.b : edge.b === node ? edge.a : null;
      if (next !== null && !via.has(next)) {
        via.set(next, node);
        queue.push(next);
      }
    }
  }
  if (!via.has(to)) return null;
  const path = [to];
  for (let at = to; at !== from;) {
    at = via.get(at) as number;
    path.unshift(at);
  }
  return path as [number, ...number[]];
}

export function createDevServer(map: MapFile, rules: RulesetPublic): DevServer {
  let tick = 0;
  let spent = 0;
  let lastSeq = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const orders = new Map<string, OrderView>();
  const timeouts = new Set<ReturnType<typeof setTimeout>>();

  function snapshot(): SnapshotMsg {
    const base = devSnapshot(map, rules, tick);
    return {
      ...base,
      view: {
        ...base.view,
        me: { ...base.view.me, cp: Math.max(0, base.view.me.cp - spent) },
        groups: base.view.groups.map((g) => ({ ...g, order: orders.get(g.id) ?? null })),
      },
    };
  }

  let current: SnapshotMsg = snapshot();

  function judge(cmd: Command): { code: string | null; path: AckMsg['path'] } {
    if (cmd.type === 'move') {
      const group = current.view.groups.find((g) => g.id === cmd.group);
      if (group === undefined) return { code: 'NOT_FOUND_OR_HIDDEN', path: null };
      if (group.location.kind !== 'node') return { code: 'GROUP_ON_EDGE', path: null };
      if (orders.get(group.id)?.planned === true) return { code: 'GROUP_BUSY', path: null };
      const path = devPath(map, group.location.node, cmd.dest);
      if (path === null) return { code: 'NO_PATH', path: null };
      const cost = cmd.planned ? rules.cost.planned_move : rules.cost.move;
      if (cost > current.view.me.cp) return { code: 'NOT_ENOUGH_CP', path: null };
      spent += cost;
      orders.set(group.id, {
        dest: cmd.dest,
        path: [...path.slice(1)] as [number, ...number[]],
        planned: cmd.planned,
      });
      return { code: null, path };
    }
    if (cmd.type === 'cancel_order') {
      if (orders.get(cmd.group)?.planned !== true) return { code: 'NOTHING_TO_CANCEL', path: null };
      spent += rules.cost.cancel;
      orders.delete(cmd.group);
      return { code: null, path: null };
    }
    return { code: 'INVALID_ARGUMENT', path: null };
  }

  class DevSocket extends MockSocket {
    override send(data: string): void {
      super.send(data);
      const msg = JSON.parse(data) as ClientMsg;
      if (msg.type === 'hello') {
        this.reply({
          type: 'welcome',
          player: DEV_PLAYER,
          ruleset_public: rules,
          map_id: map.meta.name,
          last_seq: lastSeq,
        });
        this.push();
        timer = setInterval(() => {
          tick += 1;
          this.push();
        }, 1000 / rules.tick_hz);
      } else if (msg.type === 'command') {
        lastSeq = Math.max(lastSeq, msg.seq);
        const handle = setTimeout(() => {
          timeouts.delete(handle);
          const { code, path } = judge(msg.cmd);
          this.reply({
            type: 'ack',
            seq: msg.seq,
            applied_tick: tick + 1,
            path,
            reject_code: code,
          });
        }, DEV_ACK_MS);
        timeouts.add(handle);
      }
    }

    push(): void {
      current = snapshot();
      const event = devEvent(map, tick);
      if (event !== null) this.reply(event);
      this.reply(current);
    }
  }

  return {
    createSocket: (url) => {
      const socket = new DevSocket(url);
      setTimeout(() => {
        socket.accept();
      }, 0);
      return socket as unknown as WebSocket;
    },
    stop: () => {
      clearInterval(timer);
      for (const handle of timeouts) clearTimeout(handle);
      timeouts.clear();
    },
  };
}
