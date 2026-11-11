import { describe, expect, it } from 'vitest';
import { capturedNodes } from './menuCaptures.ts';
import { MENU_WORLD } from './menuMap.ts';
import {
  FALLBACK_PALETTE,
  STILL_AT,
  along,
  drawMotion,
  pick,
  sightOf,
  type MotionClock,
} from './menuMotion.ts';
import { PIECES_PX, layoutScene, menuCityRadius, type BackdropPhase } from './menuScene.ts';
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
  clip(): void {}
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

const scene = layoutScene(MENU_WORLD.map, 1280, 800, MENU_WORLD.owners);
const story = storyOf(scene, capturedNodes(MENU_WORLD.script)) as Story;

function frame(
  phase: BackdropPhase,
  t: number,
  waited = 0,
  reduced = false,
  g = 1000 + t,
): Recorder {
  const recorder = new Recorder();
  const clock: MotionClock = { phase, t, g, waited, reduced };
  drawMotion(
    recorder as unknown as CanvasRenderingContext2D,
    FALLBACK_PALETTE,
    scene,
    story,
    clock,
    MENU_WORLD.script,
  );
  return recorder;
}

const PHASES: readonly BackdropPhase[] = ['idle', 'search', 'found', 'confirmed', 'banned'];

describe('the places of the story on the menu map (#474, #866)', () => {
  it('gathers at Ottergate, meets at Wheatgate, the opponent comes from Cragkeep', () => {
    expect(story).not.toBeNull();
    expect(story.frontCity.name).toBe('Ottergate');
    expect(story.meeting.name).toBe('Wheatgate');
    expect(story.entry.name).toBe('Cragkeep');
  });

  it('sends the scout down the front road into the fog edge, short of the enemy capital', () => {
    const end = story.scoutPath.at(-1) as { x: number; y: number };
    expect(story.scoutPath[0]).toMatchObject(scene.ownCapital);
    expect(end.x).toBeGreaterThan(scene.fadeStart);
    expect(scene.enemyCapital.x - end.x).toBeGreaterThanOrEqual(120);
  });

  it('rides the supply from the capital over own roads only, never to a node that changes hands', () => {
    const changing = capturedNodes(MENU_WORLD.script);
    const at = (p: { x: number; y: number }): number =>
      scene.nodes.find((n) => n.x === p.x && n.y === p.y)?.id ?? -1;
    expect(story.supply.length).toBeGreaterThan(10);
    for (const route of story.supply) {
      expect(route[0]).toMatchObject(scene.ownCapital);
      for (const point of route) expect(changing).not.toContain(at(point));
    }
    for (const road of story.ownRoads)
      for (const end of road) expect(changing).not.toContain(at(end));
  });
});

describe('the motion (#474, BG5 "Set")', () => {
  it('moves while idle, stands still while the queue is locked', () => {
    const idle = (t: number): string => JSON.stringify(frame('idle', t).calls);
    expect(idle(1)).not.toBe(idle(2));
    const banned = (t: number): string => JSON.stringify(frame('banned', t).calls);
    expect(banned(1)).toBe(banned(40));
    expect(frame('banned', 1).calls.length).toBeGreaterThan(0);
  });

  it('writes no number over a unit, in any phase (owner, #866)', () => {
    for (const phase of PHASES) {
      for (let t = 0; t < 40; t += 1.13) {
        for (const call of frame(phase, t, 60).calls) expect(call.name).not.toMatch(/Text/);
      }
    }
  });

  it('fights in rounds once confirmed: shots fly', () => {
    const names = new Set<string>();
    for (let t = 3; t < 12; t += 0.1)
      for (const c of frame('confirmed', t, 0, false, 5).calls) names.add(c.name);
    expect(names.has('fillRect')).toBe(true);
  });

  it('plays the captures of the loop over the idle motion, and none under reduced motion', () => {
    const calls = (g: number, script: boolean, reduced = false): number => {
      const recorder = new Recorder();
      const clock: MotionClock = { phase: 'idle', t: 0, g, waited: 0, reduced };
      drawMotion(
        recorder as unknown as CanvasRenderingContext2D,
        FALLBACK_PALETTE,
        scene,
        story,
        clock,
        script ? MENU_WORLD.script : null,
      );
      return recorder.calls.length;
    };
    // The first capture sets out at 1 s: at 4 s its group stands at the gate and the shots fly.
    expect(calls(4, true)).toBeGreaterThan(calls(4, false));
    // One loop later the same capture is under way again (the supply runs on its own clock).
    expect(calls(4 + MENU_WORLD.script.period, true)).toBeGreaterThan(
      calls(4 + MENU_WORLD.script.period, false),
    );
    expect(calls(4, true, true)).toBe(calls(4, false, true));
  });

  it('shows one still frame with reduced motion', () => {
    for (const phase of PHASES) {
      const still = (g: number): string => {
        const recorder = new Recorder();
        const at = STILL_AT[phase];
        drawMotion(
          recorder as unknown as CanvasRenderingContext2D,
          FALLBACK_PALETTE,
          scene,
          story,
          {
            phase,
            t: at,
            g: at + g * 0,
            waited: 0,
            reduced: true,
          },
        );
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

describe('a unit stands in its node as in the match (#945)', () => {
  it('puts the gathering group in the middle of its city, on the dark plate, fully inside it', () => {
    const city = story.frontCity;
    const radius = menuCityRadius(city.kind) * Math.min(scene.scale, PIECES_PX);
    const drawn = frame('banned', 1);
    // The plate disc is drawn on the city's centre, as wide as the city.
    const disc = drawn.calls.find(
      (c) =>
        c.name === 'arc' && c.args[0] === city.x && c.args[1] === city.y && c.args[2] === radius,
    );
    expect(disc).toBeDefined();
    // Every outline point of the helmet (the only thing drawn with moveTo) lies inside the city.
    const points = drawn.calls.filter((c) => c.name === 'moveTo');
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.hypot((p.args[0] ?? 0) - city.x, (p.args[1] ?? 0) - city.y)).toBeLessThan(radius);
    }
  });
});
