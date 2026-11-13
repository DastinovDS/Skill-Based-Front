import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import { FONT, ENGRAVED } from '../theme/tokens.ts';
import type { SpriteCache } from './bake.ts';
import type { Point } from './camera.ts';
import { ringRadius, vpBadgeAt } from './cityLayout.ts';
import { COMPASS, compassGlow, compassTurn, turnPhase, type CoachMarks } from './coachMarks.ts';
import {
  compassGlowSpec,
  compassPointsSpec,
  compassRingSpec,
  turnRingSpec,
} from './compassShapes.ts';
import type { MapLayers } from './layers.ts';
import { reducedMotion } from './motion.ts';
import { CASING } from './style.ts';

/** One Compass mark: the glow, the rings and the points, each a baked sprite. */
interface Compass {
  readonly root: Container;
  readonly glow: ReturnType<SpriteCache['sprite']>;
  readonly ring: ReturnType<SpriteCache['sprite']>;
  readonly points: ReturnType<SpriteCache['sprite']>;
}

/**
 * The goal marks of a tutorial card on the map (`docs/design/tutorial.md`, sections 7.7 and 8,
 * "Compass"), in the effects layer: a place, the own group standing in one, a city's VP badge (a
 * double ring whose four points turn once), a road (two rails and a chevron), and the marks in turn
 * of I.7 (each terrain's places ringed in turn, then all with their labels). Baked sprites, one
 * texture per radius (`AGENTS.md` 7.2); the motion stops by itself and "less motion" holds it still.
 */
export class CoachMarkView {
  private readonly root = new Container({ label: 'coach-marks' });
  private readonly roads = new Graphics({ label: 'coach-roads' });
  private readonly turnRoot = new Container({ label: 'coach-turns' });
  private readonly compasses: Compass[] = [];
  private readonly turnRings: ReturnType<SpriteCache['sprite']>[] = [];
  /** The terrain each ring of `turnRings` belongs to; -1: unused. */
  private turnOf: number[] = [];
  private readonly turnLabels: Text[] = [];
  private readonly labelStyle: TextStyle;
  private marks: CoachMarks | null = null;
  private roadKey = '';
  private turnKey = '';

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
    private readonly sprites: SpriteCache,
  ) {
    this.labelStyle = new TextStyle({
      fontFamily: FONT.display,
      fontSize: 10.5,
      fontWeight: '500',
      letterSpacing: 2,
      fill: ENGRAVED.ink,
      stroke: { color: CASING, width: 3.5, join: 'round' },
    });
    this.root.addChild(this.turnRoot, this.roads);
    layers.layer.effects.addChild(this.root);
  }

  setLabelResolution(resolution: number): void {
    for (const label of this.turnLabels) label.resolution = resolution;
  }

  /**
   * The marks of the card now (`null`: none, a normal match) and where each own group's token is
   * drawn this frame; `nowMs` is `performance.now()`.
   */
  update(marks: CoachMarks | null, groupAt: (node: number) => Point | null, nowMs: number): void {
    if (marks !== this.marks) {
      this.marks = marks;
      this.roadKey = '';
      this.turnKey = '';
    }
    if (marks === null) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const reduced = reducedMotion();
    const age = nowMs - marks.since;
    const turn = compassTurn(age, reduced);
    const glow = compassGlow(age, reduced);
    let used = 0;
    const place = (at: Point, inner: number): void => {
      const mark = this.compass(used++);
      mark.root.visible = true;
      mark.root.position.set(at.x, at.y);
      mark.glow.set(compassGlowSpec(inner));
      mark.ring.set(compassRingSpec(inner));
      mark.points.set(compassPointsSpec(inner));
      mark.glow.alpha = glow;
      mark.points.rotation = turn;
    };
    for (const { id, ring } of marks.nodes) {
      const node = this.map.nodes[id];
      if (node === undefined) continue;
      place(node, ringRadius(this.radiusOf(id)) + COMPASS.gap + (ring ? COMPASS.wide : 0));
    }
    // The own group standing in a place: the ring of the place, centred on its helmet.
    for (const id of marks.groupsAt) {
      const at = groupAt(id);
      if (at !== null) place(at, ringRadius(this.radiusOf(id)) + COMPASS.gap);
    }
    for (const id of marks.vpBadges) {
      const node = this.map.nodes[id];
      if (node === undefined) continue;
      const v = vpBadgeAt(this.radiusOf(id));
      place({ x: node.x + v.x, y: node.y + v.y }, COMPASS.badge);
    }
    for (let i = used; i < this.compasses.length; i++) {
      const mark = this.compasses[i];
      if (mark !== undefined) mark.root.visible = false;
    }
    this.drawRoads(marks, age, reduced);
    this.drawTurns(marks, age, reduced);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.compasses.length = 0;
    this.turnRings.length = 0;
    this.turnOf = [];
    this.turnLabels.length = 0;
  }

  private compass(index: number): Compass {
    const existing = this.compasses[index];
    if (existing !== undefined) return existing;
    const root = new Container({ label: 'coach-compass' });
    const glow = root.addChild(this.sprites.sprite());
    const ring = root.addChild(this.sprites.sprite());
    const points = root.addChild(this.sprites.sprite());
    this.root.addChild(root);
    const made = { root, glow, ring, points };
    this.compasses.push(made);
    return made;
  }

  /** The road marks: two ivory rails on a casing either side of the road and a chevron at its middle. */
  private drawRoads(marks: CoachMarks, age: number, reduced: boolean): void {
    const g = this.roads;
    const key = marks.roads.map(([a, b]) => `${String(a)}-${String(b)}`).join(',');
    if (key !== this.roadKey) {
      this.roadKey = key;
      g.clear();
      for (const [a, b] of marks.roads) {
        const p = this.map.nodes[a];
        const q = this.map.nodes[b];
        if (p === undefined || q === undefined) continue;
        const angle = Math.atan2(q.y - p.y, q.x - p.x);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        // The rails stop clear of both places' rings.
        const from = ringRadius(this.radiusOf(a)) + 6;
        const to = Math.hypot(q.x - p.x, q.y - p.y) - ringRadius(this.radiusOf(b)) - 6;
        if (to <= from) continue;
        for (const side of [1, -1]) {
          const ox = -uy * COMPASS.rail * side;
          const oy = ux * COMPASS.rail * side;
          const x0 = p.x + ux * from + ox;
          const y0 = p.y + uy * from + oy;
          const x1 = p.x + ux * to + ox;
          const y1 = p.y + uy * to + oy;
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3.2, color: CASING, cap: 'round' });
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.3, color: ENGRAVED.ink, cap: 'round' });
        }
        // The chevron points from the first place to the second.
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const tip = { x: mx + ux * 4, y: my + uy * 4 };
        const wing = (s: number): Point => ({
          x: tip.x - ux * 8 - uy * 8 * s,
          y: tip.y - uy * 8 + ux * 8 * s,
        });
        const left = wing(1);
        const right = wing(-1);
        for (const [width, color] of [
          [4, CASING],
          [1.6, ENGRAVED.ink],
        ] as const) {
          g.moveTo(left.x, left.y)
            .lineTo(tip.x, tip.y)
            .lineTo(right.x, right.y)
            .stroke({ width, color, cap: 'round', join: 'round' });
        }
      }
    }
    // The rails breathe with the glow of the rings, then rest.
    g.alpha = reduced ? 1 : 0.7 + 0.3 * ((compassGlow(age, false) - 0.25) / 0.6);
  }

  /**
   * The marks in turn (I.7): each terrain's places ringed for `COMPASS.turnMs`, one pass; then every
   * terrain stays ringed, each with its label over its first place.
   */
  private drawTurns(marks: CoachMarks, age: number, reduced: boolean): void {
    const turns = marks.turns ?? [];
    const key = turns.map((t) => `${t.label}:${t.nodes.join('.')}`).join('|');
    if (key !== this.turnKey) {
      this.turnKey = key;
      let ring = 0;
      turns.forEach((turn, i) => {
        const look = Math.min(i, 2) as 0 | 1 | 2;
        for (const id of turn.nodes) {
          const node = this.map.nodes[id];
          if (node === undefined) continue;
          const sprite = this.turnRing(ring++);
          sprite.set(turnRingSpec(ringRadius(this.radiusOf(id)) + COMPASS.gap, look));
          sprite.position.set(node.x, node.y);
          this.turnOf[ring - 1] = i;
        }
      });
      for (let i = ring; i < this.turnRings.length; i++) {
        this.turnRings[i]?.set(null);
        this.turnOf[i] = -1;
      }
      turns.forEach((turn, i) => {
        const label = this.turnLabel(i);
        label.text = turn.label.toUpperCase();
        const first = turn.nodes[0];
        const node = first === undefined ? undefined : this.map.nodes[first];
        if (node !== undefined && first !== undefined) {
          label.position.set(node.x, node.y - ringRadius(this.radiusOf(first)) - COMPASS.gap - 14);
        }
      });
      for (let i = turns.length; i < this.turnLabels.length; i++) {
        const label = this.turnLabels[i];
        if (label !== undefined) label.visible = false;
      }
    }
    const phase = turnPhase(age, turns.length, reduced);
    this.turnRings.forEach((sprite, i) => {
      const index = this.turnOf[i] ?? -1;
      sprite.visible = index >= 0 && (phase === 'all' || phase === index);
    });
    turns.forEach((_turn, i) => {
      const label = this.turnLabels[i];
      if (label !== undefined) label.visible = phase === 'all';
    });
  }

  private turnRing(index: number): ReturnType<SpriteCache['sprite']> {
    const existing = this.turnRings[index];
    if (existing !== undefined) return existing;
    const sprite = this.turnRoot.addChild(this.sprites.sprite());
    this.turnRings.push(sprite);
    return sprite;
  }

  private turnLabel(index: number): Text {
    const existing = this.turnLabels[index];
    if (existing !== undefined) {
      existing.visible = true;
      return existing;
    }
    const label = this.turnRoot.addChild(
      new Text({ text: '', style: this.labelStyle, anchor: { x: 0.5, y: 1 } }),
    );
    this.turnLabels.push(label);
    return label;
  }
}
