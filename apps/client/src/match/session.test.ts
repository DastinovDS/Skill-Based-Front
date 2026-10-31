import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devEvent, devSnapshot } from '../hud/devFeed.ts';
import { MatchAudio } from '../audio/matchAudio.ts';
import type { SoundId } from '../audio/recipes.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { createFakeServer, type MockSocket } from '../net/fakeServer.ts';
import type { ServerMsg } from '../protocol.gen.ts';
import { MatchSession } from './session.ts';

const map = DEFAULT_MAP;
const welcome: ServerMsg = {
  type: 'welcome',
  player: 0,
  ruleset_public: DEV_RULES,
  map_id: map.meta.name,
  last_seq: 0,
  nicks: ['Danya', 'Bot'],
  rated: false,
  unrated_reason: 'casual',
  calibration: null,
  forfeit_ban_s: 0,
  pause_available: true,
};
const snapshot = (tick: number): ServerMsg => devSnapshot(map, DEV_RULES, tick);

function setup() {
  const server = createFakeServer();
  const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map });
  let clock = 0;
  const session = new MatchSession({
    matchId: 'm1',
    token: 'secret',
    context: { hud, tickHz: DEV_RULES.tick_hz },
    now: () => clock,
    connection: {
      createSocket: server.create,
      location: { protocol: 'http:', host: 'localhost' },
      baseBackoffMs: 100,
      random: () => 1,
    },
  });
  session.start();
  const socket: MockSocket = server.last();
  socket.accept();
  socket.reply(welcome);
  return { session, hud, socket, server, advance: (ms: number) => (clock += ms) };
}

describe('MatchSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes the HUD from the first welcome, and keeps it after a reconnect', () => {
    const server = createFakeServer();
    const seen: ServerMsg[] = [];
    let made = 0;
    const session = new MatchSession({
      matchId: 'm1',
      token: 'secret',
      context: (msg) => {
        made += 1;
        return {
          hud: new HudState({
            me: msg.player,
            nicks: ['Danya', 'Bot'],
            rules: msg.ruleset_public,
            map,
          }),
          tickHz: msg.ruleset_public.tick_hz,
        };
      },
      onServerMessage: (msg) => seen.push(msg),
      connection: {
        createSocket: server.create,
        location: { protocol: 'http:', host: 'localhost' },
        baseBackoffMs: 100,
        random: () => 1,
      },
    });
    session.start();
    const socket = server.last();
    socket.accept();
    expect(made).toBe(0);
    expect(session.frame()).toBeNull();
    socket.reply({ ...welcome, ruleset_public: { ...DEV_RULES, tick_hz: 20 } });
    expect(made).toBe(1);
    expect(session.tickHz).toBe(20);
    socket.reply(snapshot(20));
    expect(seen.map((msg) => msg.type)).toEqual(['welcome', 'snapshot']);
    socket.drop();
    vi.advanceTimersByTime(1000);
    const again = server.last();
    again.accept();
    again.reply(welcome);
    expect(made).toBe(1);
  });

  it('hands events, acks and the end to the match audio, and releases events with the frames (#71)', () => {
    const server = createFakeServer();
    const played: SoundId[] = [];
    const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map });
    let clock = 0;
    const audio = new MatchAudio({ me: 0, play: (id) => played.push(id), now: () => clock });
    const session = new MatchSession({
      matchId: 'm1',
      token: 'secret',
      context: { hud, tickHz: DEV_RULES.tick_hz, audio },
      now: () => clock,
      connection: {
        createSocket: server.create,
        location: { protocol: 'http:', host: 'localhost' },
        baseBackoffMs: 100,
        random: () => 1,
      },
    });
    session.start();
    const socket = server.last();
    socket.accept();
    socket.reply(welcome);
    socket.reply({
      type: 'ack',
      seq: 1,
      applied_tick: 2,
      path: null,
      arrive_tick: null,
      reject_code: null,
    });
    expect(played).toEqual(['orderOk']);
    for (let tick = 30; tick <= 60; tick += 1) {
      clock += 100;
      socket.reply(snapshot(tick));
    }
    socket.reply({ type: 'event', tick: 62, kind: 'node_captured', data: { node: 1, player: 0 } });
    expect(session.frame()?.tick).toBeLessThan(62);
    expect(played).toEqual(['orderOk']); // waits until the map reaches tick 62
    for (let tick = 61; tick <= 64; tick += 1) {
      clock += 100;
      socket.reply(snapshot(tick));
    }
    expect(session.frame()?.tick).toBeGreaterThanOrEqual(62);
    expect(played).toEqual(['orderOk', 'capture']);
  });

  it('sends pause and resume only while ready', () => {
    const { session, socket } = setup();
    session.pause();
    session.resume();
    expect(socket.sent.map((msg) => msg.type).slice(-2)).toEqual(['pause', 'resume']);
  });

  it('feeds the map and the HUD from the same snapshots', () => {
    const { session, hud, socket } = setup();
    expect(session.tickHz).toBe(DEV_RULES.tick_hz);
    expect(session.frame()).toBeNull();
    socket.reply(snapshot(20));
    socket.reply(snapshot(21));
    expect(hud.current?.tick).toBe(21);
    expect(session.frame()?.base.tick).toBeGreaterThanOrEqual(20);
    // A duplicate does not reach the HUD a second time.
    const current = hud.current;
    socket.reply(snapshot(21));
    expect(hud.current).toBe(current);
  });

  it('logs a long silence between two snapshots, and only that (#546)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { socket, advance } = setup();
    socket.reply(snapshot(20));
    advance(100);
    socket.reply(snapshot(21));
    expect(warn).not.toHaveBeenCalled();
    advance(2500);
    socket.reply(snapshot(22));
    expect(warn).toHaveBeenCalledExactlyOnceWith('[client] snapshot gap 2500 ms');
    warn.mockRestore();
  });

  it('keeps events for the map and the HUD feed', () => {
    const { session, hud, socket } = setup();
    const event = devEvent(map, 30);
    if (event === null) throw new Error('no dev event at tick 30');
    socket.reply(event);
    expect(session.events()).toEqual([event]);
    socket.reply(snapshot(31));
    expect(hud.current?.events).toHaveLength(1);
  });

  it('sends commands as intents and routes the ack to the order book', () => {
    const { session, socket } = setup();
    const results: string[] = [];
    session.orders.onResult = (r) => results.push(r.kind);
    const cmd = { type: 'move', group: 'dev-0', dest: 1, planned: false, bonus: 0 } as const;
    const seq = session.send(cmd);
    session.orders.track(seq, cmd, 0);
    expect(socket.sent.at(-1)).toEqual({ type: 'command', seq, cmd });
    expect(session.orders.ghosts()).toHaveLength(1);
    socket.reply({
      type: 'ack',
      seq,
      applied_tick: 22,
      path: [0, 1],
      arrive_tick: 51,
      reject_code: 'NO_PATH',
    });
    expect(results).toEqual(['rejected']);
    expect(session.orders.ghosts().map((g) => g.status)).toEqual(['rejected']);
  });

  it('routes a group_split event to the order book: the new group of a split that was sent (#315)', () => {
    const { session, socket } = setup();
    const splits: string[][] = [];
    session.orders.onSplit = (from, to) => splits.push([from, to]);
    const event = (group: string) =>
      ({
        type: 'event',
        tick: 22,
        kind: 'group_split',
        data: { player: 0, group, new_group: '77', units: 2 },
      }) as const;
    // An event of a split nobody sent is ignored; one that was sent names the new group.
    socket.reply(event('dev-0'));
    const cmd = { type: 'split', group: 'dev-0', n: 2 } as const;
    session.orders.track(session.send(cmd), cmd);
    socket.reply(event('dev-0'));
    socket.reply(event('dev-0'));
    expect(splits).toEqual([['dev-0', '77']]);
  });

  it('forgets frames and the HUD picture when the connection drops, and on resync', () => {
    const { session, hud, socket } = setup();
    socket.reply(snapshot(20));
    expect(session.frame()).not.toBeNull();
    socket.drop();
    expect(session.buffer.size).toBe(0);
    expect(session.frame()).toBeNull();
    expect(hud.current).toBeNull();
    expect(session.status).toBe('reconnecting');
  });

  it('clears the buffer on resync and asks the server for a full snapshot', () => {
    const { session, socket } = setup();
    socket.reply(snapshot(20));
    expect(session.buffer.size).toBe(1);
    session.resync();
    expect(session.buffer.size).toBe(0);
    expect(socket.sent.at(-1)).toEqual({ type: 'resync' });
  });

  it('drops the ghost once a rendered frame reaches the tick the order was applied at', () => {
    const { session, socket, advance } = setup();
    socket.reply(snapshot(20));
    const cmd = { type: 'move', group: 'dev-0', dest: 1, planned: false, bonus: 0 } as const;
    const seq = session.send(cmd);
    session.orders.track(seq, cmd, 0);
    socket.reply({
      type: 'ack',
      seq,
      applied_tick: 22,
      path: [0, 1],
      arrive_tick: 51,
      reject_code: null,
    });
    socket.reply(snapshot(21));

    // The render time runs behind the newest snapshot: the order is not on screen yet.
    expect(session.frame()?.base.tick).toBeLessThan(22);
    expect(session.orders.ghosts()).toHaveLength(1);
    for (const tick of [22, 23, 24]) socket.reply(snapshot(tick));
    advance(5000);
    expect(session.frame()?.base.tick).toBeGreaterThanOrEqual(22);
    expect(session.orders.ghosts()).toEqual([]);
  });

  it('shows the toast of an event when the map reaches its tick, not when the event arrives (#561)', () => {
    const { session, hud, socket, advance } = setup();
    socket.reply(snapshot(20));
    socket.reply({
      type: 'event',
      tick: 22,
      kind: 'attrition',
      data: { node: 0, player: 0 },
    });
    for (const tick of [21, 22]) socket.reply(snapshot(tick));
    // The render time runs behind the newest snapshot: the event is not on the map yet.
    expect(session.frame()?.tick).toBeLessThan(22);
    expect(hud.toasts.current).toEqual([]);
    for (const tick of [23, 24]) socket.reply(snapshot(tick));
    advance(5000);
    expect(session.frame()?.tick).toBeGreaterThanOrEqual(22);
    expect(hud.toasts.current).toHaveLength(1);
  });
});
