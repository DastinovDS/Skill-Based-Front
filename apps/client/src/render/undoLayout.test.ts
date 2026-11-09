import { describe, expect, it } from 'vitest';
import { REWIND } from './style.ts';
import { nothingLook, rewindLook, rewindRing } from './undoLayout.ts';

describe('rewindLook (Rewind fixed, #851)', () => {
  it('winds the order back into the group, then fades it', () => {
    expect(rewindLook(0, false)).toMatchObject({ arrow: 1, arrowAlpha: 1, ring: 0, ringAlpha: 0 });
    const half = rewindLook(REWIND.arrowMs / 2, false);
    expect(half?.arrow).toBeCloseTo(0.5);
    expect(rewindLook(REWIND.arrowMs * 0.95, false)?.arrowAlpha).toBeCloseTo(
      1 - (0.95 - REWIND.fadeFrom) / (1 - REWIND.fadeFrom),
    );
    expect(rewindLook(REWIND.arrowMs, false)?.arrowAlpha).toBe(0);
  });

  it('winds the ring from its start, holds it and fades it; the cue ends', () => {
    const R = REWIND.ring;
    expect(rewindLook(R.from - 1, false)?.ring).toBe(0);
    expect(rewindLook(R.from + R.ms, false)).toMatchObject({ ring: 1, ringAlpha: 1 });
    expect(rewindLook(R.fadeFrom + R.fadeMs / 2, false)?.ringAlpha).toBeCloseTo(0.5);
    expect(rewindLook(REWIND.ms, false)).toBeNull();
    expect(rewindLook(-1, false)).toBeNull();
  });

  it('runs nothing with less motion: the ring stands wound and fades, the arrow is gone', () => {
    expect(rewindLook(10, true)).toEqual({ arrow: 0, arrowAlpha: 0, ring: 1, ringAlpha: 1 });
    expect(rewindLook(REWIND.ring.fadeFrom + REWIND.ring.fadeMs / 2, true)?.ringAlpha).toBeCloseTo(
      0.5,
    );
  });
});

describe('rewindRing', () => {
  it('turns anticlockwise from the top, three quarters at full, its head leading the turn', () => {
    const ring = rewindRing({ x: 0, y: 0 }, 10, 1);
    if (ring === null) throw new Error('no ring');
    expect(ring.arc[0]?.x).toBeCloseTo(0);
    expect(ring.arc[0]?.y).toBeCloseTo(-10);
    // Three quarters anticlockwise on the screen (y down) from the top ends on the right.
    const end = ring.arc[ring.arc.length - 1];
    expect(end?.x).toBeCloseTo(10);
    expect(end?.y).toBeCloseTo(0);
    // The head leads on, turning down there.
    expect(ring.dir.y).toBeCloseTo(-1);
    expect(ring.tip.y).toBeCloseTo(-REWIND.ringHead.ahead);
    expect(rewindRing({ x: 0, y: 0 }, 10, 0)).toBeNull();
  });
});

describe('nothingLook', () => {
  it('comes in, shakes once, fades and ends', () => {
    expect(nothingLook(0, false)?.alpha).toBe(0);
    expect(nothingLook(REWIND.empty.inMs, false)?.alpha).toBeCloseTo(REWIND.empty.alpha);
    expect(nothingLook(REWIND.empty.shakeMs + 1, false)?.dx).toBeCloseTo(0);
    expect(nothingLook(100, true)?.dx).toBeCloseTo(0);
    expect(nothingLook(REWIND.empty.ms, false)).toBeNull();
  });
});
