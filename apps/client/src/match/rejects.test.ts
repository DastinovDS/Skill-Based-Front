import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { REJECT_MESSAGES, REJECT_MESSAGES_BY_COMMAND, rejectMessageKey } from './rejects.ts';

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

describe('reject messages', () => {
  it('cover every RejectCode of the simulation', () => {
    const codes = pythonCodes();
    expect(codes.length).toBeGreaterThan(10);
    expect(Object.keys(REJECT_MESSAGES).sort()).toEqual([...codes].sort());
  });

  it('exist in the dictionary', () => {
    for (const code of Object.keys(REJECT_MESSAGES)) {
      const key = rejectMessageKey(code);
      expect(en[key].length).toBeGreaterThan(0);
    }
  });

  it('tell a code for the command it answers where the general text would mislead (economy v2)', () => {
    expect(rejectMessageKey('ALREADY_BUILT', 'build_factory')).toBe('reject.ALREADY_BUILT.factory');
    expect(rejectMessageKey('ALREADY_BUILT', 'build_barracks')).toBe('reject.ALREADY_BUILT');
    expect(rejectMessageKey('NOT_CITY', 'draw_line')).toBe('reject.NOT_CITY.line');
    for (const key of Object.values(REJECT_MESSAGES_BY_COMMAND)) {
      expect(en[key].length).toBeGreaterThan(0);
    }
  });

  it('give a generic message for a code this client does not know', () => {
    expect(rejectMessageKey('SOMETHING_NEW')).toBe('reject.unknown');
    expect(rejectMessageKey('constructor')).toBe('reject.unknown');
  });
});
