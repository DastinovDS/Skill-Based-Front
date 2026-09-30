import { describe, expect, it } from 'vitest';
import { DEV_RULES } from '../hud/devFeed.ts';
import { en } from '../i18n/en.ts';
import { ru } from '../i18n/ru.ts';
import { moveCost, REJECT_MESSAGES, rejectMessageKey } from './rejects.ts';

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

  it('exist in both languages', () => {
    for (const code of Object.keys(REJECT_MESSAGES)) {
      const key = rejectMessageKey(code);
      expect(en[key].length).toBeGreaterThan(0);
      expect(ru[key].length).toBeGreaterThan(0);
    }
  });

  it('give a generic message for a code this client does not know', () => {
    expect(rejectMessageKey('SOMETHING_NEW')).toBe('reject.unknown');
    expect(rejectMessageKey('constructor')).toBe('reject.unknown');
  });
});

describe('moveCost', () => {
  it('is read from the ruleset of welcome', () => {
    expect(moveCost(DEV_RULES, false)).toBe(DEV_RULES.cost.move);
    expect(moveCost(DEV_RULES, true)).toBe(DEV_RULES.cost.planned_move);
    expect(DEV_RULES.cost.planned_move).toBeGreaterThan(DEV_RULES.cost.move);
  });
});
