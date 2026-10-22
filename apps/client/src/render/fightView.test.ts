import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { EventMsg, FightView as WireFight, SnapshotMsg } from '../protocol.gen.ts';
import { PLATE, arenaCenter, fightPlace } from './fightFx.ts';
import { FightView } from './fightView.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';

const map = DEFAULT_MAP;
const radiusOf = (): number => 14;
const ROUND = DEV_RULES.combat.round_ticks;
const city = map.nodes[1]?.id ?? 1;
function snapshot(fights: SnapshotMsg['view']['fights'], tick = 150): SnapshotMsg {
  const base = devSnapshot(map, DEV_RULES, tick);
  return { ...base, view: { ...base.view, fights } };
}

const fightAt = (patch: Partial<WireFight> = {}): WireFight => ({
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
  ...patch,
});

const running = snapshot([fightAt()]);

function snapshotAt(snap: SnapshotMsg, tick: number): SnapshotMsg {
  return { ...snap, tick };
}

const roundOf = (
  tick: number,
  shots: [number, number],
  virtual: [number, number] = [0, 0],
  spent: [number, number] = [0, 0],
  losses: [number, number] = [0, 0],
): NonNullable<WireFight['last_round']> => ({ tick, shots, virtual, spent, losses });

/** The own group of a fight (listed in it), standing in the city. */
function withOwn(fights: WireFight[], units: number, charged: number, tick = 150): SnapshotMsg {
  const base = snapshot(
    fights.map((f) => ({ ...f, groups: ['g'] })),
    tick,
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

/** Pixi's label is `null` until set, whatever its type says. */
const labelOf = (node: { label: string | null }): string => node.label ?? '';

function setup() {
  const layers = createLayers();
  const view = new FightView(map, layers, 0, 1, radiusOf);
  const frame = (snap: SnapshotMsg) => interpolateFrame(snap, null, snap.tick);
  /** Every visible node, top down; the children of a node `leaf` accepts are left out. */
  const walk = (visit: (node: Container) => void, leaf?: (node: Container) => boolean): void => {
    const go = (node: Container): void => {
      if (!node.visible) return;
      visit(node);
      if (leaf?.(node) === true) return;
      for (const child of node.children) go(child);
    };
    go(layers.layer.effects);
  };
  const texts = (): string[] => {
    const found: string[] = [];
    walk((node) => {
      if (node instanceof Text && node.text !== '') found.push(node.text);
    });
    return found;
  };
  /** The chips drawn: their kind (from the label) and where they sit on the plate. */
  const chips = (): { state: string; x: number; y: number; scale: number }[] => {
    const found: { state: string; x: number; y: number; scale: number }[] = [];
    walk((node) => {
      if (labelOf(node).startsWith('chip:')) {
        found.push({
          state: labelOf(node).slice(5),
          x: node.x,
          y: node.y,
          scale: node.scale.x,
        });
      }
    });
    return found;
  };
  const badges = (): number => {
    let count = 0;
    walk((node) => {
      if (labelOf(node) === 'mute-badge') count++;
    });
    return count;
  };
  const arenaViews = (): Container[] => {
    const found: Container[] = [];
    walk(
      (node) => {
        if (labelOf(node) === 'arena') found.push(node);
      },
      (node) => labelOf(node) === 'arena',
    );
    return found;
  };
  /** The box of what is drawn (an empty Graphics sits at the origin and would count in a Container's). */
  const extent = (): { width: number; height: number } => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    walk((node) => {
      const b = node.children.length === 0 ? node.getBounds() : null;
      if (b !== null && (b.width > 0 || b.height > 0)) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
    });
    return { width: maxX - minX, height: maxY - minY };
  };
  return { layers, view, frame, texts, chips, badges, arenaViews, extent, walk };
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

  it('floats an arena over a fight going on, centred where the place says', () => {
    const { layers, view, frame } = setup();
    view.update(frame(running), [], ROUND, false);
    const place = fightPlace(map, city, null, null, radiusOf);
    if (place === undefined) throw new Error('no place');
    const centre = arenaCenter(place, 1);
    const bounds = layers.layer.effects.getLocalBounds();
    expect(bounds.x).toBeLessThan(centre.x - PLATE.halfWidth + 1);
    expect(bounds.x + bounds.width).toBeGreaterThan(centre.x + PLATE.halfWidth - 1);
    expect(bounds.y).toBeLessThan(centre.y);
    expect(bounds.y + bounds.height).toBeGreaterThan(centre.y);
    view.destroy();
  });

  it('moves the arenas of fights in one place apart, so that the plates do not cover each other (#360)', () => {
    const { view, frame, arenaViews } = setup();
    const snap = snapshot([fightAt({ id: 'a' }), fightAt({ id: 'b' }), fightAt({ id: 'c' })]);
    view.update(frame(snap), [], ROUND, false);
    const arenas = arenaViews();
    expect(arenas).toHaveLength(3);
    const k = arenas[0]?.scale.x ?? 1;
    const plates = arenas.map((arena) => ({
      left: arena.x - PLATE.halfWidth * k,
      right: arena.x + PLATE.halfWidth * k,
      top: arena.y - PLATE.halfHeight * k,
      bottom: arena.y + PLATE.halfHeight * k,
    }));
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const a = plates[i];
        const b = plates[j];
        if (a === undefined || b === undefined) throw new Error('no plate');
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart).toBe(true);
      }
    }
    // The first fight stays where a lone fight would stand.
    const place = fightPlace(map, city, null, null, radiusOf);
    if (place === undefined) throw new Error('no place');
    const usual = arenaCenter(place, 1);
    expect(arenas[0]?.x).toBeCloseTo(usual.x);
    expect(arenas[0]?.y).toBeCloseTo(usual.y);
    view.destroy();
  });

  it('keeps the plate of a fight that has just ended clear of the live one at the same city (#360)', () => {
    const { view, frame, arenaViews } = setup();
    // One fight goes on in the city, another has just ended there.
    view.update(frame(snapshot([fightAt({ id: 'a' })], 160)), [ended(160, 0, true)], ROUND, false);
    const arenas = arenaViews();
    expect(arenas).toHaveLength(2);
    const k = arenas[0]?.scale.x ?? 1;
    const [live, end] = arenas;
    if (live === undefined || end === undefined) throw new Error('no arena');
    const apartX = Math.abs(live.x - end.x) >= 2 * PLATE.halfWidth * k;
    const apartY = Math.abs(live.y - end.y) >= 2 * PLATE.halfHeight * k;
    expect(apartX || apartY).toBe(true);
    // The live fight keeps the usual spot; the one that ended moved off it.
    const place = fightPlace(map, city, null, null, radiusOf);
    if (place === undefined) throw new Error('no place');
    const usual = arenaCenter(place, 1);
    expect(live.x).toBeCloseTo(usual.x);
    expect(live.y).toBeCloseTo(usual.y);
    view.destroy();
  });

  it('draws a chip per unit: charged, discharged and dead, own on the left, the enemy on the right', () => {
    const { view, frame, chips } = setup();
    // Own: 5 units, 2 charged, 1 dead; the enemy: 4 units, all charged.
    const snap = withOwn([fightAt({ enemy_units: 4, enemy_charged: 4, losses: [1, 0] })], 5, 2);
    view.update(frame(snap), [], ROUND, false);
    const all = chips();
    const own = all.filter((chip) => chip.x < 0).map((chip) => chip.state);
    const enemy = all.filter((chip) => chip.x > 0).map((chip) => chip.state);
    expect(own.sort()).toEqual(['charged', 'charged', 'empty', 'empty', 'empty', 'killed']);
    expect(enemy).toEqual(['charged', 'charged', 'charged', 'charged']);
    // The count of chips follows the view: a unit less, a chip less.
    view.update(
      frame(withOwn([fightAt({ enemy_units: 4, enemy_charged: 4 })], 3, 0)),
      [],
      ROUND,
      false,
    );
    expect(chips().filter((chip) => chip.x < 0)).toHaveLength(3);
    view.destroy();
  });

  it('shows eight chips at most and "+N" with the exact number of the rest', () => {
    const { view, frame, chips, texts } = setup();
    // Eleven units, nine charged: three chips do not fit, one of them is charged.
    view.update(
      frame(withOwn([fightAt({ enemy_units: 2, enemy_charged: 0 })], 11, 9)),
      [],
      ROUND,
      false,
    );
    expect(chips().filter((chip) => chip.x < 0)).toHaveLength(8);
    expect(texts()).toContain('+3');
    // The small number: how many of the hidden chips are charged.
    expect(texts()).toContain('1');
    // The enemy's two units are two chips and no "+N".
    expect(chips().filter((chip) => chip.x > 0)).toHaveLength(2);
    expect(texts().filter((text) => text.startsWith('+'))).toEqual(['+3']);
    view.destroy();
  });

  it('shows no "+N" when everything fits', () => {
    const { view, frame, texts } = setup();
    view.update(frame(withOwn([fightAt()], 8, 4)), [], ROUND, false);
    expect(texts().filter((text) => text.startsWith('+'))).toEqual([]);
    view.destroy();
  });

  it('shows the bonus stock of both sides from the view, dim at zero, and drops it with the fight', () => {
    const { view, frame, texts, layers } = setup();
    const alphaOf = (label: string): number => {
      let alpha = Number.NaN;
      const visit = (node: Container): void => {
        if (node instanceof Text && node.visible && node.text === label) alpha = node.alpha;
        for (const child of node.children) visit(child);
      };
      visit(layers.layer.effects);
      return alpha;
    };
    view.update(frame(snapshot([fightAt({ virtual_left: [2, 0] })])), [], ROUND, false);
    expect(texts()).toContain('×2');
    expect(texts()).toContain('×0');
    expect(alphaOf('×2')).toBe(1);
    expect(alphaOf('×0')).toBeLessThan(1);
    // The stock follows the view round after round.
    view.update(frame(snapshot([fightAt({ virtual_left: [1, 3] })])), [], ROUND, false);
    expect(texts()).toContain('×1');
    expect(texts()).toContain('×3');
    // Seen from the other player the pairs swap sides: the view's pairs are by player id.
    const layers1 = createLayers();
    const other = new FightView(map, layers1, 1, 1, radiusOf);
    other.update(frame(snapshot([fightAt({ virtual_left: [5, 4] })])), [], ROUND, false);
    const xOf = (label: string): number => {
      let x = Number.NaN;
      const visit = (node: Container): void => {
        if (node instanceof Text && node.visible && node.text === label) x = node.x;
        for (const child of node.children) visit(child);
      };
      visit(layers1.layer.effects);
      return x;
    };
    expect(xOf('×4')).toBeLessThan(0);
    expect(xOf('×5')).toBeGreaterThan(0);
    other.destroy();
    // No fight, no stock.
    view.update(frame(snapshot([])), [], ROUND, false);
    expect(texts().filter((text) => text.startsWith('×'))).toEqual([]);
    view.destroy();
  });

  it('badges the silent charges: the last charged chips of the side, per the view', () => {
    const { view, frame, badges } = setup();
    view.update(
      frame(withOwn([fightAt({ enemy_units: 3, enemy_charged: 3 })], 2, 2)),
      [],
      ROUND,
      false,
    );
    expect(badges()).toBe(0);
    view.update(
      frame(withOwn([fightAt({ enemy_units: 3, enemy_charged: 3, mute: [0, 1] })], 2, 2)),
      [],
      ROUND,
      false,
    );
    expect(badges()).toBe(1);
    view.update(
      frame(withOwn([fightAt({ enemy_units: 3, enemy_charged: 3, mute: [1, 2] })], 2, 2)),
      [],
      ROUND,
      false,
    );
    expect(badges()).toBe(3);
    view.destroy();
  });

  it('draws no arrows and no labels of the shots over the plate: the shots are the tracers on the map', () => {
    const { view, frame, texts, walk } = setup();
    const withRound = (shots: [number, number], virtual: [number, number]): SnapshotMsg =>
      snapshot([
        fightAt({ enemy_units: 0, enemy_charged: 0, last_round: roundOf(146, shots, virtual) }),
      ]);
    view.update(frame(withRound([3, 1], [1, 0])), [], ROUND, false);
    // Nothing but the stocks and the caption of the bonus shot: no "2", "1", "1" of the labels of shots.
    expect(texts().filter((text) => !text.startsWith('×'))).toEqual(['bonus attack']);
    walk((node) => {
      expect(labelOf(node).startsWith('arrows')).toBe(false);
    });
    view.destroy();
  });

  it('writes "bonus attack" over the plate only in a round with a virtual shot', () => {
    const { view, frame, texts } = setup();
    const at = (virtual: [number, number], shots: [number, number] = [1, 1]): SnapshotMsg =>
      snapshot([fightAt({ last_round: roundOf(146, shots, virtual) })]);
    view.update(frame(at([0, 0])), [], ROUND, false);
    expect(texts()).not.toContain('bonus attack');
    view.update(frame(at([1, 0])), [], ROUND, false);
    expect(texts()).toContain('bonus attack');
    // The enemy's bonus shot counts as well: the caption does not tell whose it is, or where from.
    view.update(frame(at([0, 1])), [], ROUND, false);
    expect(texts()).toContain('bonus attack');
    setLocale('ru');
    view.update(frame(at([1, 0])), [], ROUND, false);
    expect(texts()).toContain('бонусная атака');
    // A round without shots has no caption even if the stock is there.
    view.update(frame(at([0, 0], [0, 0])), [], ROUND, false);
    expect(texts()).not.toContain('бонусная атака');
    view.destroy();
  });

  it('shows a fight without data of rounds (an old replay) with chips and no caption', () => {
    const { view, frame, texts, chips } = setup();
    view.update(frame(running), [], ROUND, false);
    expect(chips()).toHaveLength(3);
    // Nothing but the stock at zero: no caption.
    expect(texts().sort()).toEqual(['×0', '×0']);
    view.destroy();
  });

  it('draws the arena in screen pixels: the same size at 60% and at 200%, and chips of one size', () => {
    const size = (scale: number): { width: number; height: number; chip: number } => {
      const { view, frame, extent, arenaViews } = setup();
      view.setCameraScale(scale);
      view.update(frame(withOwn([fightAt()], 6, 3)), [], ROUND, false);
      const [arena] = arenaViews();
      if (arena === undefined) throw new Error('no arena');
      expect(arena.scale.x).toBeCloseTo(1 / scale);
      const box = extent();
      const chip = arena.scale.x * scale;
      view.destroy();
      // The world box times the zoom is the box on screen.
      return { width: box.width * scale, height: box.height * scale, chip };
    };
    const small = size(0.6);
    const big = size(2);
    expect(small.width).toBeCloseTo(big.width, 0);
    expect(small.height).toBeCloseTo(big.height, 0);
    expect(small.chip).toBeCloseTo(1);
    expect(big.chip).toBeCloseTo(1);
  });

  it('keeps the arena at a gap of the same px over the city at any zoom', () => {
    const gap = (scale: number): number => {
      const { view, frame, arenaViews } = setup();
      view.setCameraScale(scale);
      view.update(frame(running), [], ROUND, false);
      const [arena] = arenaViews();
      if (arena === undefined) throw new Error('no arena');
      const at = fightPlace(map, city, null, null, radiusOf);
      const above = ((at?.at.y ?? 0) - arena.y - (at?.ring ?? 0)) * scale;
      view.destroy();
      return above;
    };
    expect(gap(0.6)).toBeCloseTo(gap(2));
    expect(gap(1)).toBeGreaterThan(PLATE.halfHeight);
  });

  it('keeps the caption of a bonus shot from the tick of the round, whatever its length (10 and 20 ticks)', () => {
    for (const ticks of [10, 20]) {
      const { view, frame, texts } = setup();
      const at = (tick: number): SnapshotMsg =>
        snapshot(
          [fightAt({ enemy_units: 0, enemy_charged: 0, last_round: roundOf(150, [1, 0], [1, 0]) })],
          tick,
        );
      const caption = (): boolean => texts().includes('bonus attack');
      // Before the round nothing is said; at its tick the caption is there.
      view.update(frame(at(149)), [], ticks, false);
      expect(caption()).toBe(false);
      view.update(frame(at(150)), [], ticks, false);
      expect(caption()).toBe(true);
      // It holds until the next round is due and is gone two rounds after the shots.
      view.update(frame(at(150 + ticks * 0.9)), [], ticks, false);
      expect(caption()).toBe(true);
      view.update(frame(at(150 + ticks * 2)), [], ticks, false);
      expect(caption()).toBe(false);
      view.destroy();
    }
  });

  it('with less motion the caption is there at once too', () => {
    const { view, frame, texts } = setup();
    const snap = snapshot([
      fightAt({ enemy_units: 0, enemy_charged: 0, last_round: roundOf(150, [1, 2], [1, 0]) }),
    ]);
    view.update(frame(snap), [], ROUND, true);
    expect(texts()).toContain('bonus attack');
    view.destroy();
  });

  it('pulses the chip that went out in the round once, and not with less motion', () => {
    const { view, frame, chips } = setup();
    // One of own two units lost its charge in the round: the first discharged chip swells.
    const at = (tick: number): SnapshotMsg =>
      withOwn(
        [
          fightAt({
            enemy_units: 0,
            enemy_charged: 0,
            last_round: roundOf(150, [1, 0], [0, 0], [1, 0]),
          }),
        ],
        2,
        1,
        tick,
      );
    view.update(frame(at(150)), [], ROUND, false);
    expect(chips().map((chip) => chip.scale)).toEqual([1, 1]);
    view.update(frame(at(154.5)), [], ROUND, false);
    const swell = chips().map((chip) => chip.scale);
    expect(swell[0]).toBe(1);
    expect(swell[1]).toBeGreaterThan(1);
    // The swell is over after a share of the round.
    view.update(frame(at(150 + ROUND)), [], ROUND, false);
    expect(chips().map((chip) => chip.scale)).toEqual([1, 1]);
    view.update(frame(at(154.5)), [], ROUND, true);
    expect(chips().map((chip) => chip.scale)).toEqual([1, 1]);
    view.destroy();
  });

  it('pulses the chips of a reinforcement that joined the fight', () => {
    const { view, frame, chips } = setup();
    const at = (units: number, tick: number): SnapshotMsg =>
      withOwn([fightAt({ enemy_units: 0, enemy_charged: 0 })], units, units, tick);
    view.update(frame(at(2, 150)), [], ROUND, false);
    expect(chips().map((chip) => chip.scale)).toEqual([1, 1]);
    // Two units joined: the third and the fourth chip are new and swell.
    view.update(frame(at(4, 151)), [], ROUND, false);
    view.update(frame(at(4, 155.5)), [], ROUND, false);
    const swell = chips().map((chip) => chip.scale);
    expect(swell.slice(0, 2)).toEqual([1, 1]);
    expect(swell[2]).toBeGreaterThan(1);
    expect(swell[3]).toBeGreaterThan(1);
    view.destroy();
  });

  it('shows several fights at once, each with its own arena', () => {
    const { view, frame, arenaViews, texts } = setup();
    const other = map.nodes[2]?.id ?? 2;
    const snap = snapshot([
      fightAt({
        id: 'a',
        enemy_units: 0,
        enemy_charged: 0,
        virtual_left: [1, 0],
        last_round: roundOf(146, [1, 0]),
      }),
      fightAt({
        id: 'b',
        node: other,
        enemy_units: 0,
        enemy_charged: 0,
        virtual_left: [0, 2],
        last_round: roundOf(146, [0, 2]),
      }),
    ]);
    view.update(frame(snap), [], ROUND, false);
    expect(arenaViews()).toHaveLength(2);
    expect(
      texts()
        .filter((text) => text.startsWith('×'))
        .sort(),
    ).toEqual(['×0', '×0', '×1', '×2']);
    view.destroy();
  });

  it('draws nothing without a fight, a round or an end', () => {
    const { layers, view, frame } = setup();
    view.update(frame(snapshot([], 150)), [], ROUND, false);
    const bounds = layers.layer.effects.getLocalBounds();
    expect(bounds.width).toBe(0);
    view.destroy();
  });

  it('pops up the losses of a round, own on the left and the enemy on the right', () => {
    const { view, frame, texts } = setup();
    // The shot lands 0.3 of a round after the tick: the numbers are there from then on.
    view.update(frame(snapshot([], 151)), [round(150, 1, 2, 1)], ROUND, false);
    expect(texts()).toEqual([]);
    view.update(frame(snapshot([], 157)), [round(150, 1, 2, 1)], ROUND, false);
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
    view.update(frame(snapshot([], 157)), events, ROUND, false);
    const early = yOf();
    view.update(frame(snapshot([], 163)), events, ROUND, false);
    expect(yOf()).toBeLessThan(early);
    view.update(frame(snapshot([], 157)), events, ROUND, true);
    const still = yOf();
    view.update(frame(snapshot([], 163)), events, ROUND, true);
    expect(yOf()).toBe(still);
    // After the numbers' life (0.5 of a round after the hit) nothing is left to read.
    view.update(frame(snapshot([], 150 + ROUND)), events, ROUND, false);
    expect(texts()).toEqual([]);
    view.destroy();
  });

  it('keeps the numbers of a round for 0.5 of the round after the hit: longer when rounds are longer', () => {
    for (const [ticks, alive] of [
      [10, false],
      [20, true],
    ] as const) {
      const { view, frame, texts } = setup();
      view.update(frame(snapshot([], 162)), [round(150, 1, 0, 1)], ticks, false);
      expect(texts().includes('−1')).toBe(alive);
      view.destroy();
    }
  });

  it('tells the end: captured, held, both bounced, in the page language', () => {
    const { view, frame, texts } = setup();
    view.update(frame(snapshot([], 160)), [ended(160, 0, true)], ROUND, false);
    expect(texts()).toContain('Captured');
    view.update(frame(snapshot([], 160)), [ended(160, 1, false)], ROUND, false);
    expect(texts()).toContain('Held');
    view.update(frame(snapshot([], 160)), [ended(160, null, false)], ROUND, false);
    expect(texts()).toContain('Both retreated');
    setLocale('ru');
    view.update(frame(snapshot([], 160)), [ended(160, null, false)], ROUND, false);
    expect(texts()).toContain('Оба отошли');
    // The losses of the whole fight sit in the halves of the plate: own left, enemy right.
    expect(texts()).toContain('−1');
    expect(texts()).toContain('−2');
    view.destroy();
  });

  it('shows the end for a while that follows the round, then drops it', () => {
    const { view, frame, texts } = setup();
    const events = [ended(160, 0, true)];
    view.update(frame(snapshot([], 160 + ROUND)), events, ROUND, false);
    expect(texts()).toContain('Captured');
    view.update(frame(snapshot([], 160 + ROUND * 2)), events, ROUND, false);
    expect(texts()).toEqual([]);
    view.destroy();
  });

  it('reuses its objects frame after frame (no growth once the pools are warm)', () => {
    const { layers, view, frame } = setup();
    const events = [round(150), ended(152, 0, false)];
    const fights = [
      fightAt({
        enemy_units: 9,
        enemy_charged: 4,
        mute: [0, 1],
        virtual_left: [1, 1],
        last_round: roundOf(150, [1, 1], [1, 0]),
      }),
    ];
    const count = (node: Container): number =>
      1 + node.children.reduce((sum, child) => sum + count(child), 0);
    // The pools are warm when the loss numbers have shown once (the hit lands 6 ticks after the round).
    view.update(frame(snapshotAt(withOwn(fights, 9, 5), 158)), events, ROUND, false);
    const warm = count(layers.layer.effects);
    for (let tick = 152; tick < 170; tick++) {
      view.update(frame(snapshotAt(withOwn(fights, 9, 5), tick)), events, ROUND, false);
    }
    expect(count(layers.layer.effects)).toBe(warm);
    view.destroy();
  });

  it('destroys everything it made', () => {
    const { layers, view, frame } = setup();
    view.update(frame(withOwn([fightAt()], 3, 1)), [round(150), ended(150, 0, true)], ROUND, false);
    view.destroy();
    expect(layers.layer.effects.children).toHaveLength(0);
  });
});
