/**
 * Stand-in for the match server on the dev screen (CLI-06, #62; all commands: CLI-07, #63), until SRV-03 (#48) exists. It
 * speaks the real protocol through a fake socket, so the dev screen runs the same
 * `MatchConnection` as a live match: `welcome`, a snapshot 10 times a second (`devSnapshot`), an
 * `ack` a moment after each command. It answers every command with simple stand-in checks (CP, ownership, a few reject
 * codes) and is not a rules engine: accepted orders and modes stand in the snapshots, nothing moves. A road upgrade
 * (DEC-28, item 7: for CP, on the edge) shows as a build of the road that widens it after
 * `ruleset_public.build.ticks_per_level` ticks. The path is a breadth-first search on the map, good enough for a picture.
 */
import { devEvent, devFightEvents, devSnapshot, DEV_PLAYER } from '../hud/devFeed.ts';
import { MockSocket } from '../net/fakeServer.ts';
import type {
  AckMsg,
  ClientMsg,
  Command,
  MapFile,
  NodeView,
  OrderView,
  PacketView,
  Mode,
  RulesetPublic,
  Stance,
  SnapshotMsg,
} from '../protocol.gen.ts';

/** How long an `ack` takes, ms: long enough to see the ghost arrow. */
export const DEV_ACK_MS = 800;
/** Ticks per road hop of the dev screen's stand-in `arrive_tick` (not a rule). */
const DEV_EDGE_TICKS = 30;

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

/** Ticks a demo packet needs for one road of the dev screen. */
const DEV_PACKET_TICKS = 60;

/**
 * Demo packets for the «Supply» layer (not rules): a charge pair on the first own road, a transfer
 * the other way on the second, and, where an own road continues from the end of the first, a
 * packet that goes on over it. They restart every `DEV_PACKET_TICKS`.
 */
export function devPackets(map: MapFile, nodes: readonly NodeView[], tick: number): PacketView[] {
  const own = (id: number): boolean => nodes[id]?.owner === DEV_PLAYER;
  const roads = map.edges.filter((e) => own(e.a) && own(e.b));
  const depart = tick - (tick % DEV_PACKET_TICKS);
  const leg = { depart_tick: depart, arrive_tick: depart + DEV_PACKET_TICKS };
  const [first, second] = roads;
  const packets: PacketView[] = [];
  if (first !== undefined) {
    const onward = roads.find((e) => e.id !== first.id && (e.a === first.b || e.b === first.b));
    const far = onward === undefined ? null : onward.a === first.b ? onward.b : onward.a;
    packets.push({
      id: 'dev-packet-1',
      edge: first.id,
      from_node: first.a,
      charges: 2,
      ...leg,
      path: far === null ? [first.b] : [first.b, far],
      dest_tick: depart + DEV_PACKET_TICKS * (far === null ? 1 : 2),
      transfer: false,
    });
  }
  if (second !== undefined) {
    packets.push({
      id: 'dev-packet-2',
      edge: second.id,
      from_node: second.b,
      charges: 1,
      ...leg,
      path: [second.a],
      dest_tick: depart + DEV_PACKET_TICKS,
      transfer: true,
    });
  }
  return packets;
}

export function createDevServer(map: MapFile, rules: RulesetPublic): DevServer {
  let tick = 0;
  let spent = 0;
  let lastSeq = 0;
  let stance: Stance = 'balance';
  let socket: MockSocket | null = null;
  const modes = new Map<string, Mode>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const orders = new Map<string, OrderView>();
  /** Road builds: edge -> the tick it grows; levels so far by edge. */
  const builds = new Map<number, number>();
  const widths = new Map<number, number>();
  /** The front markers (DEC-28, item 2) and the rear minimum (item 3). */
  const fronts: [number | null, number | null] = [null, null];
  let rearMin = rules.supply.rear_min_default;
  const timeouts = new Set<ReturnType<typeof setTimeout>>();

  function snapshot(): SnapshotMsg {
    for (const [edge, done] of builds) {
      if (tick >= done) {
        widths.set(edge, (widths.get(edge) ?? 0) + 1);
        builds.delete(edge);
      }
    }
    const base = devSnapshot(map, rules, tick);
    return {
      ...base,
      view: {
        ...base.view,
        me: {
          ...base.view.me,
          stance,
          cp: Math.max(0, base.view.me.cp - spent),
          fronts: [...fronts],
          rear_min: rearMin,
        },
        packets: devPackets(map, base.view.nodes, tick),
        edges: base.view.edges.map((e) => {
          const ends = map.edges[e.id];
          const width = e.width + (widths.get(e.id) ?? 0);
          const done = builds.get(e.id);
          const build = done === undefined ? null : { done_tick: done };
          const inner = (n: number | undefined) =>
            n !== undefined && base.view.nodes[n]?.owner === DEV_PLAYER;
          // The gain of a level (DEC-28, item 7): packet speed, unit speed, one more charge.
          return inner(ends?.a) && inner(ends?.b) && width < (ends?.max_level ?? 0)
            ? { ...e, width, build, upgrade_gain: { speed_pct: 50, unit_speed_pct: 15, amount: 1 } }
            : { ...e, width, build };
        }),
        groups: base.view.groups.map((g) => ({
          ...g,
          mode: modes.get(g.id) ?? g.mode,
          order: orders.get(g.id) ?? null,
        })),
      },
    };
  }

  let current: SnapshotMsg = snapshot();

  function judge(cmd: Command): {
    code: string | null;
    path: AckMsg['path'];
    arrive?: number;
  } {
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
        bonus: 0, // the dev server does not model the planned bonus (DEC-29)
      });
      return { code: null, path };
    }
    if (cmd.type === 'cancel_order') {
      if (orders.get(cmd.group)?.planned !== true) return { code: 'NOTHING_TO_CANCEL', path: null };
      spent += rules.cost.cancel;
      orders.delete(cmd.group);
      return { code: null, path: null };
    }
    if (cmd.type === 'transfer') {
      // Stand-in (DEC-18): own cities, a path over the map, 30 ticks a road; free.
      const own = (id: number) => current.view.nodes[id]?.owner === DEV_PLAYER;
      if (!own(cmd.from_node) || !own(cmd.to_node)) return { code: 'NOT_OWNER', path: null };
      if (cmd.from_node === cmd.to_node) return { code: 'INVALID_ARGUMENT', path: null };
      const path = devPath(map, cmd.from_node, cmd.to_node);
      if (path === null) return { code: 'NO_PATH', path: null };
      return { code: null, path, arrive: tick + 1 + 30 * (path.length - 1) };
    }
    return { code: judgeOther(cmd), path: null };
  }

  function place(marker: 0 | 1, node: number | null): null {
    fronts[marker] = node;
    return null;
  }

  /** The rest of the commands: stand-in checks good for seeing accepts and rejects in the UI. */
  function judgeOther(cmd: Command): string | null {
    const charge = (cost: number): string | null => {
      if (cost > current.view.me.cp) return 'NOT_ENOUGH_CP';
      spent += cost;
      return null;
    };
    const mine = (id: string) => current.view.groups.find((g) => g.id === id);
    switch (cmd.type) {
      case 'set_mode': {
        const group = mine(cmd.group);
        if (group === undefined) return 'NOT_FOUND_OR_HIDDEN';
        if ((modes.get(group.id) ?? group.mode) === cmd.mode) return 'NO_CHANGE';
        modes.set(group.id, cmd.mode);
        return null;
      }
      case 'set_stance':
        if (stance === cmd.stance) return 'NO_CHANGE';
        stance = cmd.stance;
        return charge(rules.cost.stance);
      case 'recruit':
        return current.view.nodes[cmd.node]?.owner === DEV_PLAYER
          ? charge(rules.cost.recruit)
          : 'NOT_OWNER';
      case 'split': {
        const group = mine(cmd.group);
        if (group === undefined) return 'NOT_FOUND_OR_HIDDEN';
        if (cmd.n < 1 || cmd.n >= group.units) return 'INVALID_ARGUMENT';
        return charge(rules.cost.split);
      }
      case 'merge':
        return cmd.groups.every((id) => mine(id) !== undefined)
          ? charge(rules.cost.merge)
          : 'NOT_FOUND_OR_HIDDEN';
      case 'upgrade_road': {
        // The checks of the real server in its order (DEC-28, item 7).
        if (map.edges[cmd.edge] === undefined) return 'NOT_FOUND_OR_HIDDEN';
        if (current.view.edges[cmd.edge]?.upgrade_gain == null) return 'NOT_INTERNAL';
        if (builds.has(cmd.edge)) return 'EDGE_BUSY';
        const code = charge(rules.cost.build);
        if (code === null) builds.set(cmd.edge, tick + 1 + rules.build.ticks_per_level);
        return code;
      }
      case 'set_front': {
        // The checks of the real server in its order (DEC-28, item 2), without the CP: it is free.
        if (cmd.marker !== 0 && cmd.marker !== 1) return 'INVALID_ARGUMENT';
        if (cmd.node === null)
          return fronts[cmd.marker] === null ? 'NO_CHANGE' : place(cmd.marker, null);
        const node = current.view.nodes[cmd.node];
        if (node === undefined) return 'NOT_FOUND_OR_HIDDEN';
        if (node.owner !== DEV_PLAYER) return 'NOT_OWNER';
        if (node.warehouse_cap === null) return 'NOT_CITY';
        if (fronts[cmd.marker] === cmd.node) return 'NO_CHANGE';
        if (fronts.includes(cmd.node)) return 'INVALID_ARGUMENT';
        return place(cmd.marker, cmd.node);
      }
      case 'set_rear_min':
        if (cmd.n < 0 || cmd.n > rules.supply.rear_min_max) return 'INVALID_ARGUMENT';
        if (cmd.n === rearMin) return 'NO_CHANGE';
        rearMin = cmd.n;
        return null;
      case 'forfeit':
        setTimeout(() => {
          socket?.reply({
            type: 'match_end',
            tick,
            reason: 'forfeit',
            winner: 1,
            vp: [0, 0],
            rating: null,
            rated: false,
            unrated_reason: 'casual',
            calibration: null,
          });
        }, 0);
        return null;
      default:
        return 'INVALID_ARGUMENT';
    }
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
          nicks: ['Danya', 'Bot'],
          rated: false,
          unrated_reason: 'casual',
          calibration: null,
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
          const { code, path, arrive } = judge(msg.cmd);
          this.reply({
            type: 'ack',
            seq: msg.seq,
            applied_tick: tick + 1,
            path,
            // A stand-in for the dev screen only: the real server derives it from the rules.
            arrive_tick:
              arrive ?? (path === null ? null : tick + DEV_EDGE_TICKS * (path.length - 1)),
            reject_code: code,
          });
        }, DEV_ACK_MS);
        timeouts.add(handle);
      } else if (msg.type === 'reach_query') {
        // Stand-in: every node with a path is reachable, DEV_EDGE_TICKS a road; no stack limit.
        const at = current.view.groups.find((g) => g.id === msg.group)?.location;
        const nodes =
          at?.kind === 'node'
            ? map.nodes.flatMap((n) => {
                const path = n.id === at.node ? null : devPath(map, at.node, n.id);
                return path === null
                  ? []
                  : [{ node: n.id, ticks: DEV_EDGE_TICKS * (path.length - 1) }];
              })
            : [];
        this.reply({ type: 'reach', group: msg.group, tick, nodes, split: [] });
      }
    }

    push(): void {
      current = snapshot();
      const event = devEvent(map, tick);
      if (event !== null) this.reply(event);
      for (const fight of devFightEvents(map, tick)) this.reply(fight);
      this.reply(current);
    }
  }

  return {
    createSocket: (url) => {
      const created = new DevSocket(url);
      socket = created;
      setTimeout(() => {
        created.accept();
      }, 0);
      return created as unknown as WebSocket;
    },
    stop: () => {
      clearInterval(timer);
      for (const handle of timeouts) clearTimeout(handle);
      timeouts.clear();
    },
  };
}
