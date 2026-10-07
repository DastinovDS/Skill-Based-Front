/**
 * Incoming frames: the only place that turns server text into `ServerMsg` (AGENTS.md, section 6;
 * msgpack later replaces this module together with the encoder below).
 *
 * The server validates everything it sends, so this is a cheap structural check of what the
 * client reads: the `type` tag, the required fields of each message and the shape of the parts
 * that rendering dereferences (groups, packets, nodes, edges). It does not repeat the Pydantic
 * rules (limits, patterns). A frame that fails is dropped, never passed on half-typed.
 */
import type { ClientMsg, ServerMsg } from '../protocol.gen.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRating = (v: unknown): boolean => isObj(v) && isInt(v.before) && isInt(v.after);
const isPlayer = (v: unknown): boolean => v === 0 || v === 1;
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const every = (v: unknown, pred: (item: unknown) => boolean): boolean => isArr(v) && v.every(pred);

function isLocation(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.kind === 'node') return isInt(v.node);
  return v.kind === 'edge' && isInt(v.edge) && isInt(v.from_node) && isInt(v.progress);
}

function isGroup(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isInt(v.units) &&
    isInt(v.charged) &&
    isStr(v.mode) &&
    isLocation(v.location)
  );
}

function isPacket(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isInt(v.edge) &&
    isInt(v.from_node) &&
    isInt(v.charges) &&
    isInt(v.depart_tick) &&
    isInt(v.arrive_tick)
  );
}

const isPlace = (v: unknown): boolean => isObj(v) && isInt(v.id) && isStr(v.detail);

function isView(v: unknown): boolean {
  return (
    isObj(v) &&
    isObj(v.me) &&
    isInt(v.me.cp) &&
    every(v.vp, isInt) &&
    (v.vp as unknown[]).length === 2 &&
    every(v.nodes, isPlace) &&
    every(v.edges, isPlace) &&
    every(v.groups, isGroup) &&
    every(v.packets, isPacket) &&
    isArr(v.intents)
  );
}

const CHECKS: Record<ServerMsg['type'], (m: Obj) => boolean> = {
  welcome: (m) =>
    isPlayer(m.player) && isObj(m.ruleset_public) && isStr(m.map_id) && isInt(m.last_seq),
  snapshot: (m) => isInt(m.tick) && isView(m.view),
  ack: (m) =>
    isInt(m.seq) &&
    isInt(m.applied_tick) &&
    (m.path === null || every(m.path, isInt)) &&
    (m.reject_code === null || isStr(m.reject_code)),
  event: (m) => isInt(m.tick) && isStr(m.kind) && isObj(m.data),
  match_end: (m) =>
    isInt(m.tick) &&
    isStr(m.reason) &&
    (m.winner === null || isPlayer(m.winner)) &&
    every(m.vp, isInt) &&
    (m.vp as unknown[]).length === 2 &&
    (m.rating === undefined || m.rating === null || isRating(m.rating)),
  error: (m) => isStr(m.code) && (m.message === null || isStr(m.message)),
  pong: (m) => isInt(m.id),
  paused: (m) =>
    typeof m.paused === 'boolean' &&
    (m.by === null || isPlayer(m.by)) &&
    (m.ends_in_s === null || isInt(m.ends_in_s)),
};

function isServerType(type: unknown): type is ServerMsg['type'] {
  return isStr(type) && Object.hasOwn(CHECKS, type);
}

/** Parse and check a text frame from the server; `null` if it is not a valid `ServerMsg`. */
export function decodeServerMsg(frame: unknown): ServerMsg | null {
  if (!isStr(frame)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return null;
  }
  if (!isObj(parsed) || !isServerType(parsed.type)) return null;
  return CHECKS[parsed.type](parsed) ? (parsed as unknown as ServerMsg) : null;
}

/** Serialize a message for the server. */
export function encodeClientMsg(msg: ClientMsg): string {
  return JSON.stringify(msg);
}
