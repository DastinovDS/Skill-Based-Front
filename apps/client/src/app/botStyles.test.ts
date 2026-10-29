import { describe, expect, it } from 'vitest';
import { BOT_LEVELS } from '../api/http.ts';
import { BOT_CELLS, BOT_STYLES } from './botStyles.ts';

// Which bot stands behind a level is checked against the server in
// apps/server/tests/test_bot_styles.py; here the difficulty cells.
describe('BOT_STYLES (#473)', () => {
  it('orders the difficulty from easy to expert within the cells', () => {
    const cells = BOT_LEVELS.map((level) => BOT_STYLES[level].cells);
    expect(cells).toEqual([...cells].sort((a, b) => a - b));
    expect(new Set(cells).size).toBe(BOT_LEVELS.length);
    for (const count of cells) expect(count).toBeLessThanOrEqual(BOT_CELLS);
  });
});
