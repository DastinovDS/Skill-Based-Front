import { describe, expect, it } from 'vitest';
import { EaseTween, TWEEN_MS, easeOutCubic } from './tween.ts';

describe('easeOutCubic', () => {
  it('runs 0 to 1, fast first and slow at the end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(7)).toBe(1);
  });
});

describe('EaseTween', () => {
  it('starts settled at its value', () => {
    const tween = new EaseTween(0.5);
    expect(tween.value).toBe(0.5);
    expect(tween.active).toBe(false);
    expect(tween.step(100)).toBe(0.5);
  });

  it('eases to a new target and lands exactly on it', () => {
    const tween = new EaseTween(0);
    tween.setTarget(1);
    expect(tween.active).toBe(true);
    const mid = tween.step(TWEEN_MS / 2);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    expect(tween.step(TWEEN_MS)).toBe(1);
    expect(tween.active).toBe(false);
  });

  it('is frame-rate independent: the same time gives the same value', () => {
    const coarse = new EaseTween(0);
    const fine = new EaseTween(0);
    coarse.setTarget(1);
    fine.setTarget(1);
    coarse.step(150);
    for (let i = 0; i < 15; i++) fine.step(10);
    expect(fine.value).toBeCloseTo(coarse.value, 9);
  });

  it('retargets from the value shown, so the display never jumps', () => {
    const tween = new EaseTween(0);
    tween.setTarget(1);
    const before = tween.step(100);
    tween.setTarget(0.2);
    expect(tween.value).toBe(before);
    expect(tween.step(0)).toBe(before);
    expect(tween.step(TWEEN_MS)).toBe(0.2);
  });

  it('ignores the same target and a negative dt', () => {
    const tween = new EaseTween(0);
    tween.setTarget(1);
    tween.step(100);
    const shown = tween.value;
    tween.setTarget(1);
    tween.step(-50);
    expect(tween.value).toBe(shown);
  });

  it('snaps with no animation', () => {
    const tween = new EaseTween(0);
    tween.setTarget(1);
    tween.snap(0.3);
    expect(tween.value).toBe(0.3);
    expect(tween.active).toBe(false);
  });
});
