import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_PROTOCOL_VERSION, PROTOCOL_VERSION, type ServerMsg } from '../protocol.gen.ts';
import { createFakeServer } from './fakeServer.ts';
import {
  backoffDelay,
  MatchConnection,
  matchSocketUrl,
  type MatchHandlers,
} from './matchConnection.ts';

const fixtures = import.meta.glob<string>('../../../../packages/protocol/fixtures/**/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function fixtureText(side: 'client' | 'server', name: string): string {
  const raw = fixtures[`../../../../packages/protocol/fixtures/${side}/${name}.json`];
  if (raw === undefined) throw new Error(`no fixture ${side}/${name}`);
  return raw;
}

const serverFixture = (name: string): ServerMsg =>
  JSON.parse(fixtureText('server', name)) as ServerMsg;

const withFields = (name: string, fields: Record<string, unknown>): ServerMsg =>
  ({ ...(JSON.parse(fixtureText('server', name)) as object), ...fields }) as unknown as ServerMsg;

const welcome = (last_seq = 0): ServerMsg => withFields('welcome', { last_seq });
const ack = (seq: number): ServerMsg => withFields('ack_ok', { seq });
const move = { type: 'forfeit' } as const;

function setup(extra: { random?: () => number; token?: string } = {}) {
  const server = createFakeServer();
  const messages: ServerMsg[] = [];
  const statuses: string[] = [];
  const rtts: number[] = [];
  const lost: number[] = [];
  let invalid = 0;
  let clock = 0;
  const handlers: MatchHandlers = {
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onRtt: (ms) => rtts.push(ms),
    onInvalidFrame: () => invalid++,
    onAckLost: (seq) => lost.push(seq),
  };
  const conn = new MatchConnection({
    matchId: 'm 1',
    token: extra.token ?? 'secret-token',
    handlers,
    location: { protocol: 'https:', host: 'game.example' },
    createSocket: server.create,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    pingIntervalMs: 1000,
    random: extra.random ?? (() => 1),
    now: () => clock,
  });
  return {
    server,
    conn,
    messages,
    statuses,
    rtts,
    lost,
    invalid: () => invalid,
    setClock: (ms: number) => (clock = ms),
  };
}

/** Connect and finish the handshake; returns the socket. */
function ready(t: ReturnType<typeof setup>, lastSeq = 0) {
  t.conn.connect();
  const socket = t.server.last();
  socket.accept();
  socket.reply(welcome(lastSeq));
  return socket;
}

describe('url', () => {
  it('is same-origin, ws or wss by the page protocol, and has no token', () => {
    expect(matchSocketUrl('m 1', { protocol: 'https:', host: 'a.example:8443' })).toBe(
      'wss://a.example:8443/ws/match/m%201',
    );
    expect(matchSocketUrl('x', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws/match/x',
    );
    const t = setup({ token: 'secret-token' });
    t.conn.connect();
    expect(t.server.last().url).toBe('wss://game.example/ws/match/m%201');
    expect(t.server.last().url).not.toContain('secret-token');
  });
});

describe('handshake', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends hello first, with the protocol version and the token', () => {
    const t = setup();
    t.conn.send(move);
    t.conn.connect();
    const socket = t.server.last();
    expect(socket.sent).toEqual([]);
    socket.accept();
    expect(socket.sent).toEqual([
      { type: 'hello', protocol_version: PROTOCOL_VERSION, token: 'secret-token' },
    ]);
    expect(t.conn.status).toBe('connecting');
  });

  it('uses the protocol version of the PRO-01 hello fixture', () => {
    expect(
      (JSON.parse(fixtureText('client', 'hello')) as { protocol_version: number }).protocol_version,
    ).toBe(PROTOCOL_VERSION);
  });

  it('becomes ready on welcome and passes server messages on', () => {
    const t = setup();
    const socket = ready(t);
    expect(t.conn.status).toBe('ready');
    const snapshot = serverFixture('snapshot');
    socket.reply(snapshot);
    expect(t.messages.map((m) => m.type)).toEqual(['welcome', 'snapshot']);
    expect(t.messages[1]).toEqual(snapshot);
  });

  it('drops an invalid frame and stays connected', () => {
    const t = setup();
    const socket = ready(t);
    socket.replyRaw('{"type": "snapshot"');
    socket.replyRaw('{"type": "pong"}');
    socket.replyRaw(new ArrayBuffer(2));
    expect(t.invalid()).toBe(3);
    expect(t.messages.map((m) => m.type)).toEqual(['welcome']);
    expect(t.conn.status).toBe('ready');
  });
});

describe('commands', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('numbers commands 1, 2, 3 and sends them at once when ready', () => {
    const t = setup();
    const socket = ready(t);
    const seqs = [t.conn.send(move), t.conn.send(move), t.conn.send(move)];
    expect(seqs).toEqual([1, 2, 3]);
    expect(socket.sent.slice(1).map((m) => (m.type === 'command' ? m.seq : m.type))).toEqual(seqs);
  });

  it('holds commands until welcome, then sends them in order', () => {
    const t = setup();
    t.conn.send(move);
    t.conn.connect();
    const socket = t.server.last();
    socket.accept();
    t.conn.send(move);
    expect(socket.sent.map((m) => m.type)).toEqual(['hello']);
    socket.reply(welcome());
    expect(socket.sent.map((m) => m.type)).toEqual(['hello', 'command', 'command']);
  });

  it('keeps a command pending until its ack', () => {
    const t = setup();
    const socket = ready(t);
    t.conn.send(move);
    t.conn.send(move);
    expect(t.conn.pendingSeqs).toEqual([1, 2]);
    socket.reply(ack(1));
    expect(t.conn.pendingSeqs).toEqual([2]);
    expect(t.messages.at(-1)).toMatchObject({ type: 'ack', seq: 1 });
  });

  it('resends unacknowledged commands after a reconnect, only those above last_seq', () => {
    const t = setup();
    const first = ready(t);
    t.conn.send(move); // 1: accepted by the server, ack lost
    t.conn.send(move); // 2: never arrived
    t.conn.send(move); // 3: never arrived
    first.drop();
    vi.advanceTimersByTime(500);
    const second = t.server.last();
    expect(second).not.toBe(first);
    second.accept();
    second.reply(welcome(1));
    expect(second.sent.map((m) => (m.type === 'command' ? m.seq : m.type))).toEqual([
      'hello',
      2,
      3,
    ]);
    expect(t.lost).toEqual([1]);
    expect(t.conn.pendingSeqs).toEqual([2, 3]);
  });

  it('continues numbering after welcome.last_seq (a reloaded page, the same token)', () => {
    const t = setup();
    ready(t, 7);
    expect(t.conn.send(move)).toBe(8);
  });

  it('sends resync only when ready', () => {
    const t = setup();
    t.conn.resync();
    const socket = ready(t);
    t.conn.resync();
    expect(socket.sent.map((m) => m.type)).toEqual(['hello', 'resync']);
  });
});

describe('reconnect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('backs off exponentially up to the cap', () => {
    expect(backoffDelay(0, 500, 4000, 1)).toBe(500);
    expect(backoffDelay(1, 500, 4000, 1)).toBe(1000);
    expect(backoffDelay(3, 500, 4000, 1)).toBe(4000);
    expect(backoffDelay(10, 500, 4000, 1)).toBe(4000);
    expect(backoffDelay(2, 500, 4000, 0)).toBe(1000);
  });

  it('retries after 500, 1000, 2000, 4000, 4000 ms while the server is down', () => {
    const t = setup();
    t.conn.connect();
    for (const delay of [500, 1000, 2000, 4000, 4000]) {
      const count = t.server.sockets.length;
      t.server.last().drop();
      expect(t.conn.status).toBe('reconnecting');
      vi.advanceTimersByTime(delay - 1);
      expect(t.server.sockets.length).toBe(count);
      vi.advanceTimersByTime(1);
      expect(t.server.sockets.length).toBe(count + 1);
    }
  });

  it('resets the delay after a successful welcome', () => {
    const t = setup();
    t.conn.connect();
    t.server.last().drop();
    vi.advanceTimersByTime(500);
    t.server.last().drop();
    vi.advanceTimersByTime(1000);
    const socket = t.server.last();
    socket.accept();
    socket.reply(welcome());
    socket.drop();
    const count = t.server.sockets.length;
    vi.advanceTimersByTime(500);
    expect(t.server.sockets.length).toBe(count + 1);
  });

  it('spreads the delay with random', () => {
    const t = setup({ random: () => 0 });
    t.conn.connect();
    t.server.last().drop();
    vi.advanceTimersByTime(250);
    expect(t.server.sockets.length).toBe(2);
  });

  it('reports the status changes', () => {
    const t = setup();
    const socket = ready(t);
    socket.drop();
    vi.advanceTimersByTime(500);
    t.server.last().accept();
    t.server.last().reply(welcome());
    expect(t.statuses).toEqual(['connecting', 'ready', 'reconnecting', 'connecting', 'ready']);
  });

  it('does not reconnect on close code 4001 and asks for a reload', () => {
    const t = setup();
    t.conn.connect();
    t.server.last().accept();
    t.server.last().drop(CLOSE_PROTOCOL_VERSION);
    expect(t.conn.status).toBe('version_mismatch');
    vi.advanceTimersByTime(60_000);
    expect(t.server.sockets.length).toBe(1);
  });

  it('does not reconnect after match_end', () => {
    const t = setup();
    const socket = ready(t);
    socket.reply(serverFixture('match_end'));
    expect(t.conn.status).toBe('ended');
    expect(t.messages.at(-1)?.type).toBe('match_end');
    vi.advanceTimersByTime(60_000);
    expect(t.server.sockets.length).toBe(1);
  });

  it('close() stops reconnecting and drops pending commands', () => {
    const t = setup();
    const socket = ready(t);
    t.conn.send(move);
    socket.drop();
    t.conn.close();
    vi.advanceTimersByTime(60_000);
    expect(t.server.sockets.length).toBe(1);
    expect(t.conn.status).toBe('idle');
    expect(t.conn.pendingSeqs).toEqual([]);
  });

  it('ignores late events of an old socket', () => {
    const t = setup();
    const first = ready(t);
    first.drop();
    vi.advanceTimersByTime(500);
    const before = t.messages.length;
    first.reply(welcome());
    first.drop();
    expect(t.messages.length).toBe(before);
    expect(t.conn.status).toBe('connecting');
  });
});

describe('ping', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('measures RTT by the pong id and does not pass pong on', () => {
    const t = setup();
    const socket = ready(t);
    t.setClock(1000);
    vi.advanceTimersByTime(1000);
    expect(socket.sent.at(-1)).toEqual({ type: 'ping', id: 0 });
    t.setClock(1042);
    socket.reply({ type: 'pong', id: 0 });
    expect(t.rtts).toEqual([42]);
    expect(t.messages.some((m) => m.type === 'pong')).toBe(false);
  });

  it('matches pongs to pings in any order and ignores unknown ids', () => {
    const t = setup();
    const socket = ready(t);
    t.setClock(1000);
    vi.advanceTimersByTime(1000); // ping 0 at 1000
    t.setClock(2000);
    vi.advanceTimersByTime(1000); // ping 1 at 2000
    t.setClock(2030);
    socket.reply({ type: 'pong', id: 1 });
    t.setClock(2100);
    socket.reply({ type: 'pong', id: 0 });
    socket.reply({ type: 'pong', id: 99 });
    socket.reply({ type: 'pong', id: 1 });
    expect(t.rtts).toEqual([30, 1100]);
  });

  it('stops pinging when the connection drops', () => {
    const t = setup();
    const socket = ready(t);
    socket.drop();
    const count = socket.sent.length;
    vi.advanceTimersByTime(400);
    expect(socket.sent.length).toBe(count);
    // and does not ping before the new welcome
    const next = t.server.last();
    next.accept();
    vi.advanceTimersByTime(5000);
    expect(next.sent.map((m) => m.type)).toEqual(['hello']);
  });
});
