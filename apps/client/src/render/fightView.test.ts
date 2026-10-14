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
  },
]);

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
  return { layers, view, frame, texts };
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
    // Own: none of the fight's groups here; the enemy's exact total from the view.
    expect(texts()).toEqual(['0', '3']);
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
