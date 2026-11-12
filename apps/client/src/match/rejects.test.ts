import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import type { Command } from '../protocol.gen.ts';
import {
  DROPPED_REASONS,
  droppedReasonKey,
  isKnownReject,
  REJECT_CODES,
  refusalLine,
  refusalToast,
} from './rejects.ts';

// The Python source of the codes: a code added there without a message here fails this test.
const commandsPy = import.meta.glob<string>('../../../../packages/sim/src/gow_sim/commands.py', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function pythonCodes(): string[] {
  const source = Object.values(commandsPy)[0] ?? '';
  const body = /class RejectCode\(StrEnum\):([\s\S]*?)\n@dataclass/.exec(source)?.[1] ?? '';
  return [...body.matchAll(/^ {4}([A-Z_]+) = "\1"/gm)].map((m) => m[1] as string);
}

describe('reject codes', () => {
  it('cover every RejectCode of the simulation', () => {
    const codes = pythonCodes();
    expect(codes.length).toBeGreaterThan(10);
    expect([...REJECT_CODES].sort()).toEqual([...codes].sort());
    for (const code of codes) expect(isKnownReject(code), code).toBe(true);
    expect(isKnownReject('SOMETHING_NEW')).toBe(false);
    expect(isKnownReject('constructor')).toBe(false);
  });
});

const cmd: Command = { type: 'recruit', node: 2 };

describe('the answer to a refused command (#765)', () => {
  it('is no toast for a known code, the reason alone for an unknown one', () => {
    for (const code of REJECT_CODES) {
      expect(refusalToast({ kind: 'rejected', code, cmd }), code).toBeNull();
    }
    expect(refusalToast({ kind: 'rejected', code: 'SOMETHING_NEW', cmd })).toBe('reject.unknown');
    // B2: a lost answer is told by the status bar, not a toast.
    expect(refusalToast({ kind: 'lost', cmd })).toBeNull();
    expect(refusalToast({ kind: 'accepted', cmd })).toBeNull();
  });

  it('is always a console line for the developers', () => {
    expect(refusalLine({ kind: 'rejected', code: 'CITY_FULL', cmd })).toBe(
      '[client] command refused: recruit CITY_FULL',
    );
    expect(refusalLine({ kind: 'lost', cmd })).toBe('[client] command lost: recruit');
    expect(refusalLine({ kind: 'accepted', cmd })).toBeNull();
  });
});

describe('the reason a group order dropped a group (DEC-48, B3)', () => {
  it('has a text for each code a member of a group order can get', () => {
    for (const key of Object.values(DROPPED_REASONS)) expect(en[key].length).toBeGreaterThan(0);
    expect(droppedReasonKey('GROUP_BUSY')).toBe('reject.GROUP_BUSY');
    expect(droppedReasonKey('INVALID_ARGUMENT')).toBe('reject.INVALID_ARGUMENT.groupMove');
    expect(droppedReasonKey('IN_FIGHT')).toBe('reject.IN_FIGHT.stays');
    expect(droppedReasonKey('STACK_LIMIT')).toBe('reject.STACK_LIMIT');
    expect(droppedReasonKey('STACK_LIMIT', true)).toBe('reject.STACK_LIMIT.planned');
  });

  it('is the generic text for any other code', () => {
    expect(droppedReasonKey('CITY_FULL')).toBe('reject.unknown');
    expect(droppedReasonKey('SOMETHING_NEW')).toBe('reject.unknown');
    expect(droppedReasonKey('constructor')).toBe('reject.unknown');
  });
});
