import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ParticleLayer, burst, ray, rnd, type ParticleSpec } from './particles.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rnd', () => {
  it('is repeatable and in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const a = rnd(i, 7);
      expect(a).toBe(rnd(i, 7));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    expect(rnd(1, 2)).not.toBe(rnd(1, 3));
  });
});

describe('burst', () => {
  const base = {
    x: 10,
    y: 20,
    count: 9,
    speed: 40,
    colors: [0xffffff, 0xff0000],
    size: 4,
    kind: 'dot',
    seed: 1,
  } as const;
  const run = (p: number, extra: Partial<Parameters<typeof burst>[1]> = {}): ParticleSpec[] => {
    const out: ParticleSpec[] = [];
    burst((particle) => out.push(particle), { ...base, p, ...extra });
    return out;
  };

  it('emits `count` particles inside its progress and none outside', () => {
    expect(run(0.3)).toHaveLength(9);
    expect(run(-0.1)).toHaveLength(0);
    expect(run(1)).toHaveLength(0);
  });

  it('starts at the point, flies out and fades and shrinks', () => {
    const start = run(0);
    for (const particle of start) expect([particle.x, particle.y]).toEqual([10, 20]);
    const late = run(0.9);
    expect(Math.max(...late.map((p) => Math.hypot(p.x - 10, p.y - 20)))).toBeGreaterThan(10);
    expect(late[0]?.alpha ?? 1).toBeLessThan(start[0]?.alpha ?? 0);
    expect(late[0]?.size ?? 99).toBeLessThan(start[0]?.size ?? 0);
  });

  it('keeps inside a cone and falls with gravity', () => {
    const cone = run(0.5, { cone: [0, 1] });
    for (const particle of cone) expect(particle.x).toBeGreaterThanOrEqual(10);
    const fall = run(0.5, { fall: 30 });
    const plain = run(0.5);
    expect(fall[0]?.y ?? 0).toBeGreaterThan(plain[0]?.y ?? 0);
  });

  it('alternates the colours', () => {
    const colors = run(0.2).map((p) => p.color);
    expect(new Set(colors)).toEqual(new Set([0xffffff, 0xff0000]));
  });
});

describe('ray', () => {
  it('is a thin square between two radii along an angle', () => {
    const r = ray({ x: 0, y: 0 }, 0, 10, 30, 2, 0xffffff, 1);
    expect(r).toMatchObject({ kind: 'square', x: 20, y: 0, size: 20, rotation: 0 });
    expect(r.aspect).toBeCloseTo(0.1);
  });
});

describe('ParticleLayer', () => {
  const make = (): { layer: ParticleLayer; parent: Container } => {
    // jsdom has no canvas: the atlas falls back to one white texture.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const parent = new Container();
    return { layer: new ParticleLayer(parent), parent };
  };
  const spec = (add: boolean): ParticleSpec => ({
    kind: 'dot',
    x: 1,
    y: 2,
    size: 8,
    color: 0xff0000,
    alpha: 1,
    add,
  });

  it('has two containers on one atlas: normal and additive', () => {
    const { layer, parent } = make();
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]?.children).toHaveLength(2);
    const [normal, additive] = parent.children[0]?.children ?? [];
    expect(normal?.blendMode).toBe('normal');
    expect(additive?.blendMode).toBe('add');
    layer.destroy();
  });

  it('counts a frame by blending and drops what is invisible', () => {
    const { layer } = make();
    layer.begin();
    layer.put(spec(false));
    layer.put(spec(true));
    layer.put(spec(true));
    layer.put({ ...spec(true), alpha: 0 });
    layer.put({ ...spec(true), size: 0 });
    layer.end();
    expect(layer.count()).toEqual({ normal: 1, additive: 2 });
    layer.begin();
    layer.end();
    expect(layer.count()).toEqual({ normal: 0, additive: 0 });
    layer.destroy();
  });

  it('drops the surplus of a full pool, and does not grow', () => {
    const { layer } = make();
    layer.begin();
    for (let i = 0; i < 1000; i++) layer.put(spec(false));
    layer.end();
    expect(layer.count().normal).toBe(256);
    layer.destroy();
  });
});
