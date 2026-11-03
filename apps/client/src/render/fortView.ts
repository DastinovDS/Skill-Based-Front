import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { lighten } from './fightFx.ts';
import { borderPoint } from './fogLayout.ts';
import {
  FORT,
  borderRun,
  dashAlong,
  markScale,
  runLine,
  runPoint,
  runStrip,
  stackLevels,
  stubRun,
  tickFits,
  tickLayout,
  tickPolygon,
  type Run,
  type TickLayout,
} from './fortLayout.ts';
import type { FortPick } from './interaction.ts';
import { nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import type { CellEdge } from './regionLayout.ts';
import { BG, PAPER, ownerColor } from './style.ts';

type View = SnapshotMsg['view'];

/** The halo under the lines: near-black, kept inside the own cell. */
const HALO_COLOR = 0x05080c;
/** A building shows its progress in this many steps (a redraw per step, not per frame). */
const PROGRESS_STEPS = 48;

/** A fortification as the snapshot lists it. */
export interface FortSpec {
  readonly key: string;
  readonly node: number;
  readonly edge: number;
  readonly owner: PlayerId;
  readonly built: boolean;
  readonly doneTick: number | null;
}

/** Where the toll beam leaves a line, and the border point: the effects ask `lineAt`. */
export interface LineMark {
  /** The middle of the tick tips: where the beam starts. */
  readonly x: number;
  readonly y: number;
  /** Unit vector out of the cell (towards the border and the next node). */
  readonly nx: number;
  readonly ny: number;
}

/** A road the pick can reach: where the pointer hits it. */
export interface FortTarget {
  readonly edge: number;
  readonly line: readonly Point[];
}

/** The fortifications in a snapshot, ordered by node and road. */
export function fortsOf(view: Pick<View, 'edges'>): FortSpec[] {
  const out: FortSpec[] = [];
  for (const edge of view.edges) {
    for (const fort of edge.forts) {
      out.push({
        key: `${String(fort.node)}:${String(edge.id)}`,
        node: fort.node,
        edge: edge.id,
        owner: fort.owner,
        built: fort.built,
        doneTick: fort.done_tick,
      });
    }
  }
  return out.sort((a, b) => a.node - b.node || a.edge - b.edge);
}

/** Progress 0..1 of an own build at `tick`, in steps of `1 / PROGRESS_STEPS`. */
export function buildProgress(doneTick: number, tick: number, buildTicks: number): number {
  if (buildTicks <= 0) return 0;
  const p = 1 - (doneTick - tick) / buildTicks;
  return Math.floor(Math.max(0, Math.min(1, p)) * PROGRESS_STEPS) / PROGRESS_STEPS;
}

interface Placed {
  readonly spec: FortSpec;
  readonly run: Run;
  readonly level: number;
}

/**
 * The road fortifications (DEC-43, item D; #707): the look C7 "Long run" (ui-style 42). Each is a
 * flat stroke inside the own cell along the territory border at the road crossing, with fine ticks
 * on the border side and a soft dark halo kept inside the cell; two lines on the same stretch lie one
 * behind the other. The state comes from `EdgeView.forts` only: an own line always, an enemy one
 * only while the server shows it (it keeps no memory of enemy lines, so none is drawn in the fog).
 *
 * Two flat `Graphics` (the halos, then the lines) for all of them, redrawn when something they show
 * changes (a fortification, an owner, a build step, the mark scale of the zoom, the pick), never per
 * frame. The pick (P1 "Ghosts") adds a faint ghost of the real line on every pickable crossing, and
 * the hovered one is brighter with the price beside it. `destroy()` frees everything.
 */
export class FortView {
  private readonly root = new Container({ label: 'forts' });
  private readonly halos = this.root.addChild(new Graphics({ label: 'fort-halos' }));
  private readonly lines = this.root.addChild(new Graphics({ label: 'fort-lines' }));
  private readonly ghosts = this.root.addChild(new Graphics({ label: 'fort-ghosts' }));
  private readonly labels = this.root.addChild(new Container({ label: 'fort-labels' }));
  private readonly texts: Text[] = [];
  private readonly style = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: 11,
    fontWeight: '700',
    fill: PAPER,
    stroke: { color: BG, width: 3.5, join: 'round' },
  });
  private readonly rings = new Map<number, readonly CellEdge[]>();
  private runs = new Map<string, Run>();
  private runsKey = '';
  private marks = new Map<string, LineMark>();
  private targets: FortTarget[] = [];
  private mk = 1;
  private cameraScale = 1;
  private resolution = 1;
  private owners: readonly (PlayerId | null)[] = [];
  private forts: readonly FortSpec[] = [];
  private tick = 0;
  private buildTicks = 0;
  private tickHz = 10;
  private key = '';
  private pick: FortPick | null = null;
  private pickKey = '';

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly edges: () => readonly CellEdge[],
  ) {
    layers.layer.forts.addChild(this.root);
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const text of this.texts) text.resolution = resolution;
  }

  /** The camera scale (CSS px per world unit): the marks grow when zoomed out. */
  setCameraScale(scale: number): void {
    if (!(scale > 0)) return;
    this.cameraScale = scale;
    this.mk = markScale(scale);
  }

  setBuildTicks(ticks: number): void {
    this.buildTicks = ticks;
  }

  setTickHz(hz: number): void {
    if (hz > 0) this.tickHz = hz;
  }

  /** Where the beam of the toll starts on the line of `node` on `edge` (the tips of its ticks); `undefined`: not drawn now. */
  lineAt(node: number, edge: number): LineMark | undefined {
    return this.marks.get(`${String(node)}:${String(edge)}`);
  }

  /** The roads a click picks now (while the pick shows), with where the pointer hits each. */
  pickTargets(): readonly FortTarget[] {
    return this.targets;
  }

  /**
   * Called every frame: draws again only when something the lines show differs from the last draw.
   * `tick` is the render tick (a build advances with it).
   */
  update(view: View, tick: number, pick: FortPick | null): void {
    this.tick = tick;
    this.owners = view.nodes.map((n) => n.owner);
    const forts = fortsOf(view);
    this.forts = forts;
    const owned = this.owners.map((o) => String(o)).join('');
    const sec = (doneTick: number | null): string =>
      doneTick === null
        ? '-'
        : `${String(buildProgress(doneTick, tick, this.buildTicks))}/${String(
            Math.max(0, Math.ceil((doneTick - tick) / this.tickHz)),
          )}`;
    const key = `${String(this.mk)}|${owned}|${forts
      .map((f) => `${f.key}${String(f.owner)}${f.built ? 'b' : sec(f.doneTick)}`)
      .join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.drawAll();
    }
    // The pick: the ghosts follow the pick, the forts and the zoom.
    const pickKey =
      pick === null
        ? ''
        : `${String(pick.node)}|${pick.edges.join(',')}|${String(pick.hover)}|${pick.cost}|${key}`;
    if (pickKey !== this.pickKey) {
      this.pickKey = pickKey;
      this.pick = pick;
      this.drawGhosts();
    }
  }

  // --- Geometry ------------------------------------------------------------------------------

  private ringOf(node: number): readonly CellEdge[] {
    let ring = this.rings.get(node);
    if (ring === undefined) {
      ring = this.edges().filter((e) => e.cell === node);
      this.rings.set(node, ring);
    }
    return ring;
  }

  /** The run of the border the line of `node` on `edge` lies along (cached per zoom and owners). */
  private runFor(node: number, edge: number, lay: TickLayout): Run | undefined {
    const stamp = `${String(this.mk)}|${this.owners.map((o) => String(o)).join('')}`;
    if (stamp !== this.runsKey) {
      this.runsKey = stamp;
      this.runs = new Map();
    }
    const key = `${String(node)}:${String(edge)}`;
    const known = this.runs.get(key);
    if (known !== undefined) return known;
    const road = this.map.edges[edge];
    if (road === undefined) return undefined;
    const to = road.a === node ? road.b : road.b === node ? road.a : null;
    const cross = borderPoint(this.map, edge);
    const from = nodePoint(this.map, node);
    if (to === null || cross === undefined || from === undefined) return undefined;
    const ownerAcross = this.owners[to] ?? null;
    const half = lay.half + lay.reach;
    const run =
      borderRun({
        ring: this.ringOf(node),
        shared: (e) =>
          e.neighbour !== null &&
          (e.neighbour === to || (this.owners[e.neighbour] ?? null) === ownerAcross),
        cross,
        node: from,
        half,
      }) ?? stubRun(from, cross, half);
    this.runs.set(key, run);
    return run;
  }

  private place(forts: readonly FortSpec[], lay: TickLayout): Placed[] {
    const runs = forts.map((spec) => ({ spec, run: this.runFor(spec.node, spec.edge, lay) }));
    const found = runs.filter((r): r is { spec: FortSpec; run: Run } => r.run !== undefined);
    const levels = new Map<number, Map<string, number>>();
    for (const node of new Set(found.map((r) => r.spec.node))) {
      levels.set(
        node,
        stackLevels(
          found
            .filter((r) => r.spec.node === node)
            .map((r) => ({ key: r.spec.key, ringAt: r.run.ringAt, ringLength: r.run.ringLength })),
          lay.half,
        ),
      );
    }
    return found.map((r) => ({
      spec: r.spec,
      run: r.run,
      level: levels.get(r.spec.node)?.get(r.spec.key) ?? 0,
    }));
  }

  private colorOf(owner: PlayerId): number {
    return lighten(
      ownerColor(this.me, owner),
      owner === this.me ? FORT.lightenOwn : FORT.lightenEnemy,
    );
  }

  // --- Drawing -------------------------------------------------------------------------------

  private drawAll(): void {
    const lay = tickLayout(this.mk);
    const placed = this.place(this.forts, lay);
    this.halos.clear();
    this.lines.clear();
    this.marks = new Map();
    let label = 0;
    for (const p of placed) this.drawHalo(p, lay);
    for (const p of placed) {
      this.drawLine(p, lay);
      const d = lay.off + p.level * FORT.stackStep * this.mk;
      const at = runPoint(p.run, p.run.s0);
      this.marks.set(p.spec.key, {
        x: at.x + at.nx * (-d + lay.tl) * at.m,
        y: at.y + at.ny * (-d + lay.tl) * at.m,
        nx: at.nx,
        ny: at.ny,
      });
      if (p.spec.owner === this.me && !p.spec.built && p.spec.doneTick !== null) {
        const left = Math.max(0, Math.ceil((p.spec.doneTick - this.tick) / this.tickHz));
        const text = this.text(label++);
        text.text = `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, '0')}`;
        const out = -(d + lay.lw + 11 * this.mk);
        text.position.set(at.x + at.nx * out * at.m, at.y + at.ny * out * at.m);
        text.scale.set(Math.max(1, 1 / this.cameraScale) * 0.9);
        text.visible = true;
      }
    }
    this.hideTexts(label);
  }

  private text(index: number): Text {
    let text = this.texts[index];
    if (text === undefined) {
      text = this.labels.addChild(
        new Text({ text: '', style: this.style, anchor: 0.5, resolution: this.resolution }),
      );
      text.label = 'fort-time';
      this.texts.push(text);
    }
    return text;
  }

  private hideTexts(from: number): void {
    for (let i = from; i < this.texts.length; i++) {
      const text = this.texts[i];
      if (text !== undefined) text.visible = false;
    }
  }

  /** Which part of a line is built: from `lo` to `hi` (relative to the crossing), and whether it is known at all. */
  private stateOf(spec: FortSpec, lay: TickLayout): { lo: number; hi: number; known: boolean } {
    const half = lay.half + lay.reach;
    if (spec.built) return { lo: -half, hi: half, known: true };
    // An own build tells its progress; an enemy line being built is only known to exist.
    if (spec.owner !== this.me || spec.doneTick === null) return { lo: 0, hi: 0, known: false };
    const p = buildProgress(spec.doneTick, this.tick, this.buildTicks);
    return { lo: -half, hi: -half + 2 * half * p, known: true };
  }

  private drawHalo(p: Placed, lay: TickLayout): void {
    const { lo, hi, known } = this.stateOf(p.spec, lay);
    if (!known || hi - lo < 1) return;
    const d = lay.off + p.level * FORT.stackStep * this.mk;
    // A band round the stroke and its ticks, from just inside the real border line inwards.
    const centre = d - lay.tl * 0.5;
    const width = lay.lw + lay.tl + FORT.haloWidth * this.mk;
    const bands: [number, number][] = [
      [1, FORT.haloAlpha * 0.45],
      [0.74, FORT.haloAlpha * 0.6],
    ];
    for (const [k, alpha] of bands) {
      const near = Math.max(FORT.haloClear, centre - (width * k) / 2);
      const far = centre + (width * k) / 2;
      if (far <= near) continue;
      const strip = runStrip(p.run, lo - lay.tl * 0.4, hi + lay.tl * 0.4, -far, -near);
      this.halos.poly(strip.flatMap((q) => [q.x, q.y])).fill({ color: HALO_COLOR, alpha });
    }
  }

  private drawLine(p: Placed, lay: TickLayout): void {
    const { spec, run } = p;
    const g = this.lines;
    const { lo, hi, known } = this.stateOf(spec, lay);
    const d = lay.off + p.level * FORT.stackStep * this.mk;
    const color = this.colorOf(spec.owner);
    const half = lay.half + lay.reach;
    const rk = this.mk;
    const dash = (line: readonly Point[], width: number, on: number, off: number): void => {
      for (const piece of dashAlong(line, on, off)) {
        const first = piece[0];
        if (first === undefined) continue;
        g.moveTo(first.x, first.y);
        for (const q of piece.slice(1)) g.lineTo(q.x, q.y);
      }
      g.stroke({ width, color: PAPER, alpha: 0.85, cap: 'butt', join: 'round' });
    };
    if (!known) {
      // An enemy line being built: only that it exists, a dashed outline of the whole line.
      dash(runLine(run, -half, half, -d), 1.5 * rk, 4 * rk, 4 * rk);
      for (const a of lay.cs) {
        if (!tickFits(run, a, lay.tw)) continue;
        const poly = tickPolygon(run, a, lay.tw, d, lay.lw, lay.tl);
        dash([...poly, poly[0] as Point], 1.3 * rk, 2.6 * rk, 2.2 * rk);
      }
      return;
    }
    const built = hi - lo >= 2 * half - 0.01;
    if (hi - lo > 0.5) {
      const line = runLine(run, lo, hi, -d);
      const first = line[0];
      if (first !== undefined) {
        g.moveTo(first.x, first.y);
        for (const q of line.slice(1)) g.lineTo(q.x, q.y);
        g.stroke({ width: lay.lw, color, cap: 'butt', join: 'round' });
      }
    }
    if (!built) {
      // The part not built yet: a thin dashed line.
      dash(runLine(run, hi, half, -d), 1.5 * rk, 4 * rk, 4 * rk);
    }
    const unbuilt: Point[][] = [];
    for (const a of lay.cs) {
      if (!tickFits(run, a, lay.tw)) continue;
      const poly = tickPolygon(run, a, lay.tw, d, lay.lw, lay.tl);
      if (built || a + lay.tw / 2 <= hi + 0.01) {
        g.poly(poly.flatMap((q) => [q.x, q.y])).fill(color);
      } else unbuilt.push(poly);
    }
    for (const poly of unbuilt) dash([...poly, poly[0] as Point], 1.3 * rk, 2.6 * rk, 2.2 * rk);
    if (!built) {
      // The head of the build: a bright tick across the line where it has got to.
      const q = runPoint(run, run.s0 + Math.max(-run.s0, Math.min(run.len - run.s0, hi)));
      const inner = -d - lay.lw * 1.4;
      const outer = -d + lay.tl + lay.lw;
      g.moveTo(q.x + q.nx * inner * q.m, q.y + q.ny * inner * q.m)
        .lineTo(q.x + q.nx * outer * q.m, q.y + q.ny * outer * q.m)
        .stroke({ width: 2 * rk, color: PAPER });
    }
  }

  /** The pick: a faint ghost of the line on every pickable road, the hovered one bright with its price. */
  private drawGhosts(): void {
    const g = this.ghosts.clear();
    this.targets = [];
    const pick = this.pick;
    if (pick === null) {
      this.hidePrice();
      return;
    }
    const lay = tickLayout(this.mk);
    const own = this.forts.filter((f) => f.node === pick.node);
    const candidates = pick.edges.map((edge): FortSpec => ({
      key: `${String(pick.node)}:${String(edge)}`,
      node: pick.node,
      edge,
      owner: this.me,
      built: true,
      doneTick: null,
    }));
    const placed = this.place([...own, ...candidates], lay).filter(
      (p) => pick.edges.includes(p.spec.edge) && !own.some((f) => f.key === p.spec.key),
    );
    const color = this.colorOf(this.me);
    let hover: Placed | undefined;
    for (const p of placed) {
      const isHover = p.spec.edge === pick.hover;
      if (isHover) hover = p;
      const d = lay.off + p.level * FORT.stackStep * this.mk;
      const alpha = isHover ? FORT.ghostHoverAlpha : FORT.ghostAlpha;
      const half = lay.half + lay.reach;
      const line = runLine(p.run, -half, half, -d);
      const first = line[0];
      if (first !== undefined) {
        g.moveTo(first.x, first.y);
        for (const q of line.slice(1)) g.lineTo(q.x, q.y);
        g.stroke({ width: lay.lw, color, alpha, cap: 'butt', join: 'round' });
      }
      for (const a of lay.cs) {
        if (!tickFits(p.run, a, lay.tw)) continue;
        const poly = tickPolygon(p.run, a, lay.tw, d, lay.lw, lay.tl);
        g.poly(poly.flatMap((q) => [q.x, q.y])).fill({ color, alpha });
      }
      // Where the pointer counts as on this ghost: the line, a little way out.
      this.targets.push({ edge: p.spec.edge, line: runLine(p.run, -half, half, -d + lay.tl / 2) });
    }
    if (hover === undefined) {
      this.hidePrice();
      return;
    }
    const d = lay.off + hover.level * FORT.stackStep * this.mk;
    const at = runPoint(hover.run, hover.run.s0);
    const out = -(d + lay.lw + 14 * this.mk);
    const text = this.priceText();
    text.text = pick.cost;
    text.position.set(at.x + at.nx * out * at.m, at.y + at.ny * out * at.m);
    text.scale.set(Math.max(1, 1 / this.cameraScale));
    text.visible = true;
  }

  private price: Text | null = null;

  private priceText(): Text {
    if (this.price === null) {
      this.price = this.labels.addChild(
        new Text({ text: '', style: this.style, anchor: 0.5, resolution: this.resolution }),
      );
      this.price.label = 'fort-price';
    }
    return this.price;
  }

  private hidePrice(): void {
    if (this.price !== null) this.price.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.style.destroy();
  }
}
