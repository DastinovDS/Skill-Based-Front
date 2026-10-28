import { describe, expect, it, vi } from 'vitest';
import { FrameGuard } from './frameGuard.ts';

function setup(limit = 3) {
  const onFailure = vi.fn();
  const log = vi.fn();
  return { guard: new FrameGuard(limit, onFailure, log), onFailure, log };
}

const boom = (): void => {
  throw new Error('boom');
};

describe('FrameGuard', () => {
  it('runs a good frame and says nothing', () => {
    const { guard, onFailure, log } = setup();
    const frame = vi.fn();
    guard.run(frame);
    expect(frame).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('swallows a throwing frame so the loop goes on, and logs only the first failure', () => {
    const { guard, log } = setup(100);
    for (let i = 0; i < 5; i++)
      expect(() => {
        guard.run(boom);
      }).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('reports once after `limit` failed frames in a row', () => {
    const { guard, onFailure } = setup(3);
    guard.run(boom);
    guard.run(boom);
    expect(onFailure).not.toHaveBeenCalled();
    guard.run(boom);
    expect(onFailure).toHaveBeenCalledOnce();
    guard.run(boom);
    guard.run(boom);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('takes a transient error for no alarm: a good frame starts the count over', () => {
    const { guard, onFailure } = setup(3);
    for (let i = 0; i < 10; i++) {
      guard.run(boom);
      guard.run(boom);
      guard.run(() => undefined);
    }
    expect(onFailure).not.toHaveBeenCalled();
  });
});
