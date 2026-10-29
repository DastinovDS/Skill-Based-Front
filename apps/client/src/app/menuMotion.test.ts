import { describe, expect, it } from 'vitest';
import { MENU_MAP } from './menuMap.ts';
import {
  FALLBACK_PALETTE,
  STILL_AT,
  along,
  drawMotion,
  pick,
  sightOf,
  type MotionClock,
} from './menuMotion.ts';
import { RAIL_RIGHT, layoutScene, type BackdropPhase } from './menuScene.ts';
import { storyOf, type Story } from './menuStory.ts';

/** The calls a frame makes on a 2D canvas, with the numbers they take. */
class Recorder {
  readonly calls: { name: string; args: number[] }[] = [];
  globalAlpha = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  lineWidth = 1;
  lineDashOffset = 0;
  strokeStyle = '';
  fillStyle = '';
  font = '';
  #note(name: string, args: unknown[]): void {
    this.calls.push({ name, args: args.filter((a): a is number => typeof a === 'number') });
  }
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  stroke(): void {}
  fill(): void {}
  setLineDash(): void {}
  rotate(): void {}
  setTransform(): void {}
  clearRect(): void {}
  moveTo(...args: number[]): void {
    this.#note('moveTo', args);
  }
  lineTo(...args: number[]): void {
    this.#note('lineTo', args);
  }
  arc(...args: number[]): void {
    this.#note('arc', args);
  }
  fillRect(...args: number[]): void {
    this.#note('fillRect', args);
  }
  strokeRect(...args: number[]): void {
    this.#note('strokeRect', args);
  }
  translate(...args: number[]): void {
    this.#note('translate', args);
  }
  fillText(text: string, ...args: number[]): void {
    this.#note(`fillText ${text}`, args);
  }
  strokeText(text: string, ...args: number[]): void {
    this.#note(`strokeText ${text}`, args);
  }
}

const scene = layoutScene(MENU_MAP, 1280, 800);
const story = storyOf(scene) as Story;

function frame(phase: BackdropPhase, t: number, waited = 0, reduced = false): Recorder {
  const recorder = new Recorder();
  const clock: MotionClock = { phase, t, g: 1000 + t, waited, reduced };
  drawMotion(recorder as unknown as CanvasRenderingContext2D, FALLBACK_PALETTE, scene, story, clock);
  return recorder;
}

const PHASES: readonly BackdropPhase[] = ['idle', 'search', 'found', 'confirmed', 'banned'];

describe('the places of the story on the menu map (#474)', () => {
  it('gathers at Mossgate, meets at Fordham, the opponent comes from Long Meadow', () => {
    expect(story).not.toBeNull();
    const at = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
    expect(at(story.frontCity)).toEqual([690, 420]);
    expect(at(story.meeting)).toEqual([845, 420]);
    expect(at(story.entry)).toEqual([910, 525]);
  });

  it('sends the scout down the valley road into the fog edge, short of the enemy capital', () => {
    const end = story.scoutPath.at(-1) as { x: number; y: number };
    expect(story.scoutPath[0]).toMatchObject(scene.ownCapital);
    expect(end.x).toBeGreaterThan(scene.fadeStart);
    expect(scene.enemyCapital.x - end.x).toBeGreaterThanOrEqual(120);
  });

  it('rides the supply from the capital over own roads only', () => {
    expect(story.supply).toHaveLength(7);
    for (const route of story.supply) expect(route[0]).toMatchObject(scene.ownCapital);
    expect(story.ownRoads).toHaveLength(11);
  });
});

describe('the motion (#474, BG5 "Set")', () => {
  it('draws every phase, at every moment, without touching the text rail', () => {
    for (const phase of PHASES) {
      for (let t = 0; t < 30; t += 0.37) {
        for (const call of frame(phase, t, 5).calls) {
          const x = call.args[0] ?? RAIL_RIGHT;
          // Shapes drawn about a translated origin have small offsets; the rest are page points.
          if (Math.abs(x) > 40) expect(x).toBeGreaterThan(RAIL_RIGHT - 40);
        }
      }
    }
  });

  it('moves while idle, stands still while the queue is locked', () => {
    const idle = (t: number): string => JSON.stringify(frame('idle', t).calls);
    expect(idle(1)).not.toBe(idle(2));
    const banned = (t: number): string => JSON.stringify(frame('banned', t).calls);
    expect(banned(1)).toBe(banned(40));
    expect(frame('banned', 1).calls.length).toBeGreaterThan(0);
  });

  it('grows the stack at the front with the time in the queue', () => {
    const count = (waited: number): string | undefined =>
      frame('search', 0, waited)
        .calls.map((c) => c.name)
        .find((n) => n.startsWith('fillText'));
    expect(count(0)).toBe('fillText ×2');
    expect(count(60)).toBe('fillText ×7');
    expect(count(600)).toBe('fillText ×9');
  });

  it('fights in rounds once confirmed: a shot and a loss', () => {
    const names = new Set<string>();
    for (let t = 3; t < 12; t += 0.1) for (const c of frame('confirmed', t).calls) names.add(c.name);
    expect(names.has('fillText −1')).toBe(true);
  });

  it('shows one still frame with reduced motion', () => {
    for (const phase of PHASES) {
      const still = (g: number): string => {
        const recorder = new Recorder();
        const at = STILL_AT[phase];
        drawMotion(recorder as unknown as CanvasRenderingContext2D, FALLBACK_PALETTE, scene, story, {
          phase,
          t: at,
          g: at + g * 0,
          waited: 0,
          reduced: true,
        });
        return JSON.stringify(recorder.calls);
      };
      expect(still(1)).toBe(still(2));
    }
  });
});

describe('the sight of the scout', () => {
  const clock = (phase: BackdropPhase, t: number, waited = 0): MotionClock => ({
    phase,
    t,
    g: t,
    waited,
    reduced: false,
  });

  it('is there only while the queue runs', () => {
    expect(sightOf(scene, story, clock('idle', 3))).toBeNull();
    expect(sightOf(scene, story, clock('banned', 3))).toBeNull();
  });

  it('leaves the capital and waits at the end of its road', () => {
    const start = sightOf(scene, story, clock('search', 0));
    expect(start).toMatchObject({ x: scene.ownCapital.x, y: scene.ownCapital.y, waiting: false });
    const later = sightOf(scene, story, clock('search', 10, 5));
    expect(later?.x).toBeGreaterThan(scene.ownCapital.x);
    const end = sightOf(scene, story, clock('search', 0, 300));
    expect(end?.waiting).toBe(true);
    expect(end?.x).toBeGreaterThan(scene.fadeStart);
  });

  it('widens to the enemy capital once a pair is found', () => {
    const now = sightOf(scene, story, clock('found', 0));
    const then = sightOf(scene, story, clock('found', 2));
    if (now === null || then === null) throw new Error('no sight');
    expect(then.r).toBeGreaterThan(now.r);
    const reach = Math.hypot(scene.enemyCapital.x - then.x, scene.enemyCapital.y - then.y);
    expect(then.r).toBeGreaterThan(reach);
  });
});

describe('helpers', () => {
  it('picks stable numbers in [0, 1)', () => {
    const values = Array.from({ length: 200 }, (_, k) => pick(k, 3));
    expect(values).toEqual(Array.from({ length: 200 }, (_, k) => pick(k, 3)));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('walks along a path', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(along(path, 5)).toMatchObject({ x: 5, y: 0 });
    expect(along(path, 15)).toMatchObject({ x: 10, y: 5 });
    expect(along(path, 99)).toMatchObject({ x: 10, y: 10 });
  });
});
