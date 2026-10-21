import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { EventMsg, SnapshotMsg } from '../protocol.gen.ts';
import { fightPlace } from './fightFx.ts';
import { FightView } from './fightView.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';

const map = DEFAULT_MAP;
const radiusOf = (): number => 14;
const TICK_HZ = 10;
const ROUND = DEV_RULES.combat.round_ticks;
const city = map.nodes[1]?.id ?? 1;
function snapshot(fights: SnapshotMsg['view']['fights'], tick = 150): SnapshotMsg {
  const base = devSnapshot(map, DEV_RULES, tick);
  return { ...base, view: { ...base.view, fights } };
}

const running = snapshot([
  {
    id: 'f',
    node: city,
    edge: null,
    point: null,
    attacker: 1,
    start_tick: 120,
    next_round_tick: 155,
    groups: [],
    enemy_units: 3,
    enemy_charged: 2,
    shots: [0, 0],
    losses: [0, 0],
    virtual_left: [0, 0],
    mute: [0, 0],
    last_round: null,
  },
]);

const [running0] = running.view.fights;
if (running0 === undefined) throw new Error('no fight');

function snapshotAt(snap: SnapshotMsg, tick: number): SnapshotMsg {
  return { ...snap, tick };
}

const round = (tick: number, shots = 1, l0 = 0, l1 = 1): EventMsg => ({
  type: 'event',
  tick,
  kind: 'fight_round',
  data: { node: city, edge: null, point: null, shots_0: shots, losses_0: l0, losses_1: l1 },
});

const ended = (tick: number, winner: 0 | 1 | null, captured: boolean): EventMsg => ({
  type: 'event',
  tick,
  kind: 'fight_ended',
  data: { node: city, edge: null, point: null, winner, captured, losses_0: 1, losses_1: 2 },
});

function setup() {
  const layers = createLayers();
  const view = new FightView(map, layers, 0, 1, radiusOf);
  const frame = (snap: SnapshotMsg) => interpolateFrame(snap, null, snap.tick);
  const texts = (): string[] => {
    const found: string[] = [];
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (node instanceof Text && node.text !== '') found.push(node.text);
      for (const child of node.children) visit(child);
    };
    visit(layers.layer.effects);
    return found;
  };
  /** The box of what is drawn (an empty Graphics sits at the origin and would count in a Container's). */
  const extent = (): { width: number; height: number } => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const visit = (node: Container): void => {
      if (!node.visible) return;
      const b = node.children.length === 0 ? node.getBounds() : null;
      if (b !== null && (b.width > 0 || b.height > 0)) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      for (const child of node.children) visit(child);
    };
    visit(layers.layer.effects);
    return { width: maxX - minX, height: maxY - minY };
  };
  return { layers, view, frame, texts, extent };
}

describe('FightView', () => {
  beforeEach(() => {
    // jsdom has no canvas to measure text on: seven units a letter.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
    setLocale('en');
  });

  it('floats an arena over a fight going on, with the units of both sides', () => {
    const { layers, view, frame, texts } = setup();
    view.update(frame(running), [], TICK_HZ, ROUND, false);
    const place = fightPlace(map, city, null, null, radiusOf);
    if (place === undefined) throw new Error('no place');
    const bounds = layers.layer.effects.getLocalBounds();
    expect(bounds.x).toBeLessThan(place.arena.x);
    expect(bounds.x + bounds.width).toBeGreaterThan(place.arena.x);
    expect(bounds.y).toBeLessThan(place.arena.y);
    // Own: none of the fight's groups here, so no number; the enemy's exact units from the view:
    // the discharged one (above) and the two charged ones (below).
    expect(texts()).toEqual(['1', '2']);
    view.destroy();
  });

  it('numbers the charged and the discharged units of both sides, none for zero', () => {
    const { view, frame, texts } = setup();
    const here = (units: number, charged: number): SnapshotMsg => {
      const base = snapshot(
        [{ ...running0, groups: ['g'], enemy_units: 4, enemy_charged: 4 }],
        150,
      );
      return {
        ...base,
        view: {
          ...base.view,
          groups: [
            {
              id: 'g',
              units,
              charged,
              mode: 'attack',
              location: { kind: 'node', node: city },
              order: null,
              defense_bonus: null,
              defense_cap: null,
            },
          ],
        },
      };
    };
    view.update(frame(here(5, 2)), [], TICK_HZ, ROUND, false);
    // Own: 3 discharged, 2 charged; the enemy: all 4 charged, no discharged number.
    expect(texts()).toEqual(['3', '2', '4']);
    view.update(frame(here(2, 0)), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['2', '4']);
    view.destroy();
  });

  it('draws the arrows of the last round: only a side that shot, the labels tell real and virtual', () => {
    const { view, frame, texts, extent } = setup();
    const fight = { ...running0, enemy_units: 0, enemy_charged: 0 };
    const withRound = (
      shots: [number, number],
      virtual: [number, number],
      tick = 150,
    ): SnapshotMsg => {
      const base = snapshot(
        [{ ...fight, last_round: { tick: 146, shots, virtual, spent: [0, 0], losses: [0, 0] } }],
        tick,
      );
      return base;
    };
    // Both sides shot, own with one virtual shot: own `2` real and `1` virtual, enemy `1` real.
    view.update(frame(withRound([3, 1], [1, 0])), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['2', '1', '1']);
    // The enemy did not shoot: no arrow and no label for it.
    view.update(frame(withRound([3, 0], [1, 0])), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['2', '1']);
    // Nobody shot: the circle alone.
    const shooting = extent();
    view.update(frame(withRound([0, 0], [0, 0])), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual([]);
    expect(extent().height).toBeLessThan(shooting.height);
    view.destroy();
  });

  it('shows a fight without data of rounds (an old replay) as a circle without arrows', () => {
    const { view, frame, texts, extent } = setup();
    view.update(frame(running), [], TICK_HZ, ROUND, false);
    // Nothing but the circle and its arc: the arena is no taller than a disc with its ring.
    expect(extent().height).toBeLessThan(2 * (24 + 8));
    expect(texts()).toEqual(['1', '2']);
    view.destroy();
  });

  it('lets an arrow grow, holds it to the next round and drops it when no round comes', () => {
    const { view, frame, texts, extent } = setup();
    const fight = { ...running0, enemy_units: 0, enemy_charged: 0 };
    const at = (tick: number): SnapshotMsg =>
      snapshot(
        [
          {
            ...fight,
            last_round: {
              tick: 150,
              shots: [1, 0],
              virtual: [0, 0],
              spent: [0, 0],
              losses: [0, 0],
            },
          },
        ],
        tick,
      );
    const height = (): number => extent().height;
    view.update(frame(at(150)), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual([]);
    const sprouting = height();
    view.update(frame(at(151)), [], TICK_HZ, ROUND, false);
    expect(height()).toBeGreaterThan(sprouting);
    expect(texts()).toEqual([]);
    // Grown whole: the label is there, and stays until the next round is due.
    view.update(frame(at(154)), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['1']);
    view.update(frame(at(159)), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['1']);
    // No round came for two rounds: the exchange is gone.
    view.update(frame(at(150 + 2 * ROUND + 5)), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual([]);
    view.destroy();
  });

  it('with less motion shows the arrow whole at once', () => {
    const { view, frame, texts } = setup();
    const fight = { ...running0, enemy_units: 0, enemy_charged: 0 };
    const snap = snapshot(
      [
        {
          ...fight,
          last_round: { tick: 150, shots: [1, 2], virtual: [0, 0], spent: [0, 0], losses: [0, 0] },
        },
      ],
      150,
    );
    view.update(frame(snap), [], TICK_HZ, ROUND, true);
    expect(texts()).toEqual(['1', '2']);
    view.destroy();
  });

  it('shows several fights at once, each with its own arena and arrows', () => {
    const { view, frame, texts } = setup();
    const other = map.nodes[2]?.id ?? 2;
    const one = running0;
    const round = (shots: [number, number]) => ({
      tick: 146,
      shots,
      virtual: [0, 0] as [number, number],
      spent: [0, 0] as [number, number],
      losses: [0, 0] as [number, number],
    });
    const snap = snapshot(
      [
        { ...one, id: 'a', enemy_units: 0, enemy_charged: 0, last_round: round([1, 0]) },
        {
          ...one,
          id: 'b',
          node: other,
          enemy_units: 0,
          enemy_charged: 0,
          last_round: round([0, 2]),
        },
      ],
      150,
    );
    view.update(frame(snap), [], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['1', '2']);
    view.destroy();
  });

  it('draws nothing without a fight, a round or an end', () => {
    const { layers, view, frame } = setup();
    view.update(frame(snapshot([], 150)), [], TICK_HZ, ROUND, false);
    const bounds = layers.layer.effects.getLocalBounds();
    expect(bounds.width).toBe(0);
    view.destroy();
  });

  it('pops up the losses of a round, own on the left and the enemy on the right', () => {
    const { view, frame, texts } = setup();
    view.update(frame(snapshot([], 151)), [round(150, 1, 2, 1)], TICK_HZ, ROUND, false);
    expect(texts()).toEqual(['−2', '−1']);
    view.destroy();
  });

  it('lets the numbers rise, and not with reduced motion', () => {
    const { view, frame, texts, layers } = setup();
    const yOf = (): number => {
      let y = Number.NaN;
      const visit = (node: Container): void => {
        if (node instanceof Text && node.visible && node.text === '−1') y = node.y;
        for (const child of node.children) visit(child);
      };
      visit(layers.layer.effects);
      return y;
    };
    const events = [round(150, 1, 0, 1)];
    view.update(frame(snapshot([], 151)), events, TICK_HZ, ROUND, false);
    const early = yOf();
    view.update(frame(snapshot([], 160)), events, TICK_HZ, ROUND, false);
    expect(yOf()).toBeLessThan(early);
    view.update(frame(snapshot([], 151)), events, TICK_HZ, ROUND, true);
    const still = yOf();
    view.update(frame(snapshot([], 160)), events, TICK_HZ, ROUND, true);
    expect(yOf()).toBe(still);
    // After the numbers' life nothing is left to read.
    view.update(frame(snapshot([], 190)), events, TICK_HZ, ROUND, false);
    expect(texts()).toEqual([]);
    view.destroy();
  });

  it('tells the end: captured, held, both bounced, in the page language', () => {
    const { view, frame, texts } = setup();
    view.update(frame(snapshot([], 160)), [ended(160, 0, true)], TICK_HZ, ROUND, false);
    expect(texts()).toContain('Captured');
    view.update(frame(snapshot([], 160)), [ended(160, 1, false)], TICK_HZ, ROUND, false);
    expect(texts()).toContain('Held');
    view.update(frame(snapshot([], 160)), [ended(160, null, false)], TICK_HZ, ROUND, false);
    expect(texts()).toContain('Both retreated');
    setLocale('ru');
    view.update(frame(snapshot([], 160)), [ended(160, null, false)], TICK_HZ, ROUND, false);
    expect(texts()).toContain('Оба отошли');
    // The losses of the whole fight sit in the halves of the arena: own left, enemy right.
    expect(texts()).toContain('−1');
    expect(texts()).toContain('−2');
    view.destroy();
  });

  it('reuses its objects frame after frame (no growth once the pools are warm)', () => {
    const { layers, view, frame } = setup();
    const events = [round(150), ended(152, 0, false)];
    const count = (node: Container): number =>
      1 + node.children.reduce((sum, child) => sum + count(child), 0);
    view.update(frame(snapshotAt(running, 152)), events, TICK_HZ, ROUND, false);
    const warm = count(layers.layer.effects);
    for (let tick = 152; tick < 170; tick++) {
      view.update(frame(snapshotAt(running, tick)), events, TICK_HZ, ROUND, false);
    }
    expect(count(layers.layer.effects)).toBe(warm);
    view.destroy();
  });

  it('destroys everything it made', () => {
    const { layers, view, frame } = setup();
    view.update(frame(running), [round(150), ended(150, 0, true)], TICK_HZ, ROUND, false);
    view.destroy();
    expect(layers.layer.effects.children).toHaveLength(0);
  });
});
