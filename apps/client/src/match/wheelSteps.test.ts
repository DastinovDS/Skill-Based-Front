import { describe, expect, it } from 'vitest';
import { WHEEL_GESTURE_GAP_MS, WHEEL_STEP_PX, WheelSteps } from './wheelSteps.ts';

const PIXEL = 0;
const LINE = 1;
const wheel = (deltaY: number, deltaX = 0, deltaMode = PIXEL) => ({
  deltaX,
  deltaY,
  deltaMode,
  shiftKey: true,
});

describe('WheelSteps (#793)', () => {
  it('steps once per mouse notch: up is +1, down is -1, never more for one event', () => {
    const steps = new WheelSteps();
    // A notch of 100 px, an accelerated one of 300 px: one step each.
    expect(steps.push(wheel(-100), 0)).toBe(1);
    expect(steps.push(wheel(-300), 20)).toBe(1);
    expect(steps.push(wheel(100), 40)).toBe(-1);
  });

  it('counts a notch in lines as one step, however close the events come', () => {
    const steps = new WheelSteps();
    expect(steps.push(wheel(-3, 0, LINE), 0)).toBe(1);
    expect(steps.push(wheel(-3, 0, LINE), 10)).toBe(1);
    expect(steps.push(wheel(3, 0, LINE), 20)).toBe(-1);
  });

  it('steps at once on the first small delta after a pause (a slow notch of a few pixels)', () => {
    const steps = new WheelSteps();
    expect(steps.push(wheel(-4), 0)).toBe(1);
    expect(steps.push(wheel(-4), WHEEL_GESTURE_GAP_MS)).toBe(1);
    expect(steps.push(wheel(-4), 2 * WHEEL_GESTURE_GAP_MS)).toBe(1);
  });

  it('gathers the small deltas of a trackpad swipe: a step per WHEEL_STEP_PX, not per event', () => {
    const steps = new WheelSteps();
    // 60 events of 5 px, a frame apart: 300 px in all.
    let sum = 0;
    for (let i = 0; i < 60; i++) sum += steps.push(wheel(-5), i * 16);
    // The first event steps (a new gesture), then one step for each full 100 px of the rest.
    expect(sum).toBe(1 + Math.floor((59 * 5) / WHEEL_STEP_PX));
    expect(sum).toBeLessThan(5);
  });

  it('takes the horizontal delta when Shift turns the wheel into a horizontal scroll', () => {
    const steps = new WheelSteps();
    expect(steps.push(wheel(0, -100), 0)).toBe(1);
    expect(steps.push(wheel(0, 100), 500)).toBe(-1);
    // The axis that moved more counts.
    expect(steps.push(wheel(10, -120), 1000)).toBe(1);
  });

  it('drops what it gathered on a turn the other way and on reset', () => {
    const steps = new WheelSteps();
    expect(steps.push(wheel(-5), 0)).toBe(1);
    expect(steps.push(wheel(-90), 16)).toBe(0);
    // The other way: the 90 px are gone, 20 px back are not a step yet.
    expect(steps.push(wheel(20), 32)).toBe(0);
    expect(steps.push(wheel(-90), 48)).toBe(0);
    steps.reset();
    // After a reset the next event starts a gesture.
    expect(steps.push(wheel(-5), 60)).toBe(1);
  });

  it('ignores an event without a delta', () => {
    const steps = new WheelSteps();
    expect(steps.push(wheel(0, 0), 0)).toBe(0);
  });
});
