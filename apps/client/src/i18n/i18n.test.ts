import { describe, expect, it } from 'vitest';
import { t } from './index.ts';

describe('t', () => {
  it('returns the ru string for a key', () => {
    expect(t('error.renderer')).toBe('Не удалось запустить отрисовку карты');
  });
});
