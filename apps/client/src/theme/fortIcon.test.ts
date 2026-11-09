import { describe, expect, it } from 'vitest';
import { FORT_ICON, fortIconFor, mirrorPath } from './fortIcon.ts';

describe('the fortify icon, drawn per size (#858)', () => {
  it('mirrors a half across the middle of its grid', () => {
    expect(mirrorPath('M1 16 V8 H3.5 V10 Z', 24)).toBe('M23 16 V8 H20.5 V10 Z');
  });

  it('has a right half that is the left one mirrored, on every grid', () => {
    expect(FORT_ICON[24].right).toBe('M23 16 V8 H20.5 V10 H18 V5.5 H14 V18.5 H18 V16 Z');
    expect(FORT_ICON[32].right).toBe(
      'M30.5 21 V10.5 H27.5 V13 H25 V10.5 H22.5 V7.5 H19 V24.5 H22.5 V21 Z',
    );
    expect(FORT_ICON[16].right).toBe(
      'M15.5 10.5 V6.5 H14.5 V7.5 H13.5 V6.5 H12.5 V3.5 H9 V12.5 H12.5 V10.5 Z',
    );
  });

  it('keeps the road 1 px at 16 and 2 px from 24 on', () => {
    expect(FORT_ICON[16].roadWidth).toBe(1);
    expect(FORT_ICON[24].roadWidth).toBe(2);
    expect(FORT_ICON[32].roadWidth).toBe(2);
  });

  it('takes its own grid at 16, 24 and 32, the nearest larger one between', () => {
    expect(fortIconFor(14).grid).toBe(16);
    expect(fortIconFor(16).grid).toBe(16);
    expect(fortIconFor(18).grid).toBe(24);
    expect(fortIconFor(24).grid).toBe(24);
    expect(fortIconFor(40).grid).toBe(32);
  });
});
