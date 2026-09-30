import { describe, expect, it } from 'vitest';
import { decodeServerMsg, encodeClientMsg } from './decode.ts';

const serverFixtures = import.meta.glob<string>(
  '../../../../packages/protocol/fixtures/server/*.json',
  { eager: true, import: 'default', query: '?raw' },
);

function fixture(name: string): Record<string, unknown> {
  const raw = serverFixtures[`../../../../packages/protocol/fixtures/server/${name}.json`];
  if (raw === undefined) throw new Error(`no fixture ${name}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('decodeServerMsg', () => {
  it('accepts every server fixture of PRO-01', () => {
    expect(Object.keys(serverFixtures).length).toBeGreaterThan(0);
    for (const [path, raw] of Object.entries(serverFixtures)) {
      expect(decodeServerMsg(raw), path).toEqual(JSON.parse(raw));
    }
  });

  it.each([
    ['not JSON', '{"type": "pong"'],
    ['not an object', '[1, 2]'],
    ['null', 'null'],
    ['no type', '{"id": 1}'],
    ['unknown type', '{"type": "pongg", "id": 1}'],
    ['a client type', '{"type": "hello", "protocol_version": 1, "token": "x"}'],
    ['inherited key as type', '{"type": "toString"}'],
    ['missing field', '{"type": "pong"}'],
    ['string for number', '{"type": "pong", "id": "1"}'],
    ['negative number', '{"type": "pong", "id": -1}'],
    ['fraction', '{"type": "pong", "id": 1.5}'],
  ])('rejects %s', (_name, frame) => {
    expect(decodeServerMsg(frame)).toBeNull();
  });

  it('rejects a binary frame', () => {
    expect(decodeServerMsg(new ArrayBuffer(4))).toBeNull();
  });

  it('rejects a snapshot whose view is broken', () => {
    const snapshot = fixture('snapshot');
    const view = snapshot.view as Record<string, unknown>;
    const broken = [
      { ...snapshot, tick: 'soon' },
      { ...snapshot, view: null },
      { ...snapshot, view: { ...view, groups: {} } },
      { ...snapshot, view: { ...view, vp: [1] } },
      { ...snapshot, view: { ...view, groups: [{ id: 'g', units: 1 }] } },
      { ...snapshot, view: { ...view, packets: [{ id: 'p', edge: 0 }] } },
    ];
    for (const msg of broken) {
      expect(decodeServerMsg(JSON.stringify(msg))).toBeNull();
    }
  });

  it('rejects a welcome for player 2 and a match_end with a winner out of range', () => {
    expect(decodeServerMsg(JSON.stringify({ ...fixture('welcome'), player: 2 }))).toBeNull();
    expect(decodeServerMsg(JSON.stringify({ ...fixture('match_end'), winner: 5 }))).toBeNull();
  });
});

describe('encodeClientMsg', () => {
  it('writes JSON', () => {
    expect(JSON.parse(encodeClientMsg({ type: 'ping', id: 3 }))).toEqual({ type: 'ping', id: 3 });
  });
});
