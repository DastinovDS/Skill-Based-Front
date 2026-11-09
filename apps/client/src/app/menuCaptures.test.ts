import { describe, expect, it } from 'vitest';
import { CAPTURE } from '../render/style.ts';
import {
  CAPTURE_LENGTH,
  FLIP,
  LAST_SHOT,
  WALK_START,
  captureLook,
  capturedNodes,
  capturesAt,
  ownersAt,
} from './menuCaptures.ts';
import { ENTRY_WORLD, MENU_WORLD, type MenuWorld } from './menuMap.ts';
import { menuTerritory } from './menuPieces.ts';
import { floodBox } from './menuPaint.ts';
import { layoutScene } from './menuScene.ts';

const WORLDS: readonly [string, MenuWorld][] = [
  ['menu', MENU_WORLD],
  ['entry', ENTRY_WORLD],
];

const neighbours = (world: MenuWorld, a: number, b: number): boolean =>
  world.map.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

describe('the loop of captures behind the screens (#866)', () => {
  for (const [name, world] of WORLDS) {
    describe(`on the ${name} map (${world.map.meta.name})`, () => {
      const { script, owners } = world;

      it('takes cities and provinces of the front, each from a neighbour the taker holds then', () => {
        expect(script.captures.length).toBeGreaterThanOrEqual(4);
        const kinds = new Set(
          script.captures.map((c) => world.map.nodes[c.node]?.kind === 'province'),
        );
        expect(kinds).toEqual(new Set([true, false]));
        for (const capture of script.captures) {
          expect(neighbours(world, capture.from, capture.node)).toBe(true);
          const before = ownersAt(owners, script, capture.at);
          expect(before[capture.from]).toBe(capture.by);
          expect(before[capture.node]).toBe(capture.by === 0 ? 1 : 0);
          // The taker still holds its side when it walks in, and the node changes hands then.
          expect(ownersAt(owners, script, capture.at + FLIP - 0.01)[capture.node]).toBe(
            capture.by === 0 ? 1 : 0,
          );
          expect(ownersAt(owners, script, capture.at + FLIP + 0.01)[capture.node]).toBe(capture.by);
        }
      });

      it('never takes a capital, and leaves the story of the menu alone', () => {
        for (const node of capturedNodes(script))
          expect(world.map.nodes[node]?.kind).not.toBe('capital');
      });

      it('returns to its owners at the end of the loop: every capture is taken back', () => {
        expect(ownersAt(owners, script, 0)).toEqual([...owners]);
        expect(ownersAt(owners, script, script.period - 1e-6)).toEqual([...owners]);
        for (const node of capturedNodes(script)) {
          const flips = script.captures.filter((c) => c.node === node);
          expect(flips.length % 2).toBe(0);
        }
      });

      it('has no seam: nothing is under way at the turn of the loop and every moment repeats', () => {
        expect(capturesAt(script, script.period - 1e-6)).toEqual([]);
        expect(capturesAt(script, 0)).toEqual([]);
        for (let g = 0; g < script.period; g += 0.25) {
          expect(ownersAt(owners, script, g + script.period)).toEqual(ownersAt(owners, script, g));
          expect(capturesAt(script, g + 3 * script.period).map((m) => m.u)).toEqual(
            capturesAt(script, g).map((m) => m.u),
          );
        }
      });

      it('runs one capture at a time', () => {
        for (let g = 0; g < script.period; g += 0.1) {
          expect(capturesAt(script, g).length).toBeLessThanOrEqual(1);
        }
        const starts = script.captures.map((c) => c.at).sort((a, b) => a - b);
        starts.forEach((at, i) => {
          const next = starts[(i + 1) % starts.length] ?? at;
          expect((next - at + script.period) % script.period).toBeGreaterThanOrEqual(
            CAPTURE_LENGTH,
          );
        });
      });

      it('repaints a box round each capture that holds its area and the roads of its city', () => {
        const scene = layoutScene(world.map, 1280, 800, owners);
        const cells = menuTerritory(world.map, world.geo).cells;
        for (const node of capturedNodes(script)) {
          const box = floodBox(scene, cells, node, 1);
          expect(box).not.toBeNull();
          const at = scene.nodes.find((n) => n.id === node);
          if (box === null || at === undefined) continue;
          expect(at.x).toBeGreaterThan(box.x);
          expect(at.x).toBeLessThan(box.x + box.w);
          expect(box.w).toBeLessThan(scene.width);
        }
      });
    });
  }

  it('lays the menu front through the window, the meeting city neutral', () => {
    // Wheatgate: the orders of a found pair meet there (menuStory.ts).
    expect(MENU_WORLD.owners[8]).toBeNull();
    expect(MENU_WORLD.owners.filter((o) => o === null)).toHaveLength(1);
  });
});

describe('captureLook (the capture of the match, #856, #857)', () => {
  it('walks to the gate, fights two rounds, then walks in after the last shot landed', () => {
    expect(captureLook(1, false).approach).not.toBeNull();
    expect(captureLook(1, false).round).toBeNull();
    expect(captureLook(2.5, false).round?.index).toBe(0);
    expect(captureLook(3.5, false).round?.index).toBe(1);
    expect(WALK_START).toBeGreaterThan(LAST_SHOT);
    expect(captureLook(WALK_START - 0.01, false).walk?.share).toBe(0);
    expect(captureLook(WALK_START + 0.6, false).walk?.share).toBe(1);
  });

  it('beats the garrison with the last shot: it loses its charge and fades', () => {
    expect(captureLook(LAST_SHOT - 0.01, false).guard?.share).toBe(1);
    expect(captureLook(LAST_SHOT + 0.01, false).guard?.share).toBe(0);
    expect(captureLook(LAST_SHOT + 1, false).guard).toBeNull();
  });

  it('floods the area, rings the city and raises the flag as the winner crosses the ring', () => {
    const before = captureLook(FLIP - 0.01, false);
    expect(before.flood).toBeNull();
    expect(before.flag).toBeNull();
    const after = captureLook(FLIP + 0.3, false);
    expect(after.flood?.pos).toBeGreaterThan(0);
    expect(after.ring?.ring).toBeGreaterThan(0);
    expect(after.flag).toBe(1);
    expect(captureLook(FLIP + CAPTURE.clean.to / 1000 + 0.01, false).flood).toBeNull();
    expect(captureLook(CAPTURE_LENGTH - 0.01, false).flag ?? 0).toBeLessThan(0.05);
  });

  it('draws the capture of the opponent at half strength, as the match does', () => {
    const own = captureLook(FLIP + 0.3, false);
    const theirs = captureLook(FLIP + 0.3, true);
    expect(theirs.flood?.rim).toBeCloseTo((own.flood?.rim ?? 0) * CAPTURE.calm, 6);
  });
});
