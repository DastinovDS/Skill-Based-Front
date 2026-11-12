import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BakeSpec } from './bake.ts';
import {
  chordsAt,
  doneRingSpec,
  foundationAlertSpec,
  foundationSpec,
  iconBackSpec,
  iconFillSpec,
  iconFrontSpec,
  iconHeadSpec,
  iconSpan,
  owedSpec,
  socketFillSpec,
  socketGlowSpec,
  socketHeadSpec,
  socketRuleSpec,
  socketSpec,
} from './pieceShapes.ts';
import { solidCorners } from './cutPath.ts';
import { CUT_SOLIDS } from '../theme/cutIcons.ts';

/** How many instructions of each kind a spec draws (nothing needs WebGL: `draw` only fills a container). */
function drawn(spec: BakeSpec): Record<string, number> {
  const into = new Container();
  spec.draw(into, { gradient: (color) => color, ramp: (top) => top, hair: (width) => width });
  const count: Record<string, number> = {};
  for (const child of into.children) {
    if (!(child instanceof Graphics)) continue;
    for (const i of child.context.instructions as unknown as { action: string }[]) {
      count[i.action] = (count[i.action] ?? 0) + 1;
    }
  }
  return count;
}

describe('chordsAt: the rules across a solid', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('cuts a horizontal chord at each height inside the outline', () => {
    const chords = chordsAt(square, [2, 5, 12]);
    expect(chords).toEqual([
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
      ],
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
    ]);
  });

  it('breaks a chord where the outline does: the factory has a gap between its saw teeth', () => {
    const factory = solidCorners(CUT_SOLIDS.factory ?? '');
    // Above the roof line of the saw teeth (y = -5) only the chimney (x 5..8.5) is solid.
    const [chimney, ...rest] = chordsAt(factory, [-7]);
    expect(rest).toEqual([]);
    expect(chimney?.[0].x).toBeCloseTo(5);
    expect(chimney?.[1].x).toBeCloseTo(8.5);
  });
});

describe('the icons of the barracks and the factory on the map (#954)', () => {
  it('spans the solid of each icon: its fill rises from the bottom', () => {
    expect(iconSpan('barracks')).toEqual({ top: -8.5, bottom: 9 });
    expect(iconSpan('factory')).toEqual({ top: -10, bottom: 9 });
  });

  it('has one look per kind, state, colour and side: the keys differ', () => {
    const keys = new Set<string>();
    for (const kind of ['barracks', 'factory'] as const) {
      for (const look of ['built', 'plan', 'rising'] as const) {
        keys.add(iconBackSpec(kind, look, 0x86a6ea, false).key);
        keys.add(iconFrontSpec(kind, look).key);
      }
      keys.add(iconBackSpec(kind, 'built', 0x86a6ea, true).key);
      keys.add(iconBackSpec(kind, 'built', 0xe5785e, false).key);
      keys.add(iconFillSpec(kind, 0x86a6ea).key);
      keys.add(iconHeadSpec(kind).key);
    }
    expect(keys.size).toBe(2 * (3 + 3 + 1 + 1 + 1 + 1));
  });

  it('draws the ruled solid of a built icon, the enemy hatched across and the own flat', () => {
    const own = drawn(iconBackSpec('barracks', 'built', 0x86a6ea, false));
    const enemy = drawn(iconBackSpec('barracks', 'built', 0x86a6ea, true));
    const plan = drawn(iconBackSpec('barracks', 'plan', 0x86a6ea, false));
    // The ground of the solid, then the rules in the owner's colour; a plan has no rules.
    expect(own['fill']).toBe(1);
    expect(own['stroke']).toBe(1);
    expect(enemy['stroke']).toBe(1);
    expect(plan['stroke']).toBeUndefined();
  });

  it('draws the outline of the menu icon: a casing, then the ink line; a plan has a dotted one', () => {
    expect(drawn(iconFrontSpec('factory', 'built'))['stroke']).toBe(2);
    expect(drawn(iconFrontSpec('factory', 'plan'))['stroke']).toBe(2);
  });

  it('bakes the fill over the whole solid and the head line across it', () => {
    const fill = iconFillSpec('barracks', 0x86a6ea);
    expect(fill.box.y).toBe(-8.5);
    expect(fill.box.height).toBeCloseTo(17.5);
    expect(iconHeadSpec('barracks').box.width).toBeGreaterThan(18);
  });

  it('bakes one owed or paid charge and the ring of a finished build', () => {
    expect(owedSpec(true, 0x86a6ea, 1.7).key).not.toBe(owedSpec(false, 0x86a6ea, 1.7).key);
    expect(drawn(owedSpec(false, 0x86a6ea, 1.7))['fill']).toBe(2);
    expect(doneRingSpec(10).box.width).toBeGreaterThan(20);
  });
});

describe('the barracks foundation (#1005, D2)', () => {
  it('draws the base, the amber rim and every socket look, one key per look', () => {
    const specs = [
      foundationSpec(3),
      foundationAlertSpec(3),
      socketSpec('empty', 0x86a6ea),
      socketSpec('free', 0x86a6ea),
      socketSpec('queued', 0x86a6ea),
      socketSpec('under', 0x86a6ea),
      socketRuleSpec('empty'),
      socketRuleSpec('free'),
      socketRuleSpec('filled'),
      socketFillSpec(0x86a6ea),
      socketHeadSpec(),
      socketGlowSpec(),
    ];
    for (const spec of specs) expect(Object.keys(drawn(spec)).length).toBeGreaterThan(0);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
    // A recess has no colour of a player: one texture for every owner.
    expect(socketSpec('empty', 1).key).toBe(socketSpec('empty', 2).key);
    expect(socketSpec('queued', 1).key).not.toBe(socketSpec('queued', 2).key);
  });

  it('hatches an ordered unit and dashes a free slot', () => {
    expect(drawn(socketSpec('queued', 1)).stroke).toBeGreaterThan(0);
    expect(drawn(socketSpec('empty', 1)).stroke ?? 0).toBe(0);
    expect(drawn(socketRuleSpec('free')).stroke).toBe(1);
  });
});
