import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import { CP_MARK } from '../theme/cpMark.ts';
import type { Point } from './camera.ts';
import { hairFloor } from './engraving.ts';
import { borderPoint } from './fogLayout.ts';
import {
  borderRun,
  ringOrder,
  ringStretch,
  stackLevels,
  stretchRun,
  stubRun,
  type Run,
} from './fortLayout.ts';
import type { FortPick } from './interaction.ts';
import { nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { reducedMotion } from './motion.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import type { CellEdge } from './regionLayout.ts';
import { CASING, CUT, INK, ownerColor } from './style.ts';
import {
  WALL,
  buildSpan,
  dotArcs,
  fallPieces,
  gateOnRun,
  squareAt,
  wallLine,
  wallParts,
  wallPoint,
  wallScale,
  wallTeeth,
  type Masonry,
  type WallGate,
} from './wallLayout.ts';

type View = SnapshotMsg['view'];

/** A building shows its progress in this many steps (a redraw per step, not per frame). */
const PROGRESS_STEPS = 48;
/** Half the length of a straight stub across the road, when the cell shares no border with the cell across. */
const STUB_HALF = 36;

/** A fortification as the snapshot lists it. */
export interface FortSpec {
  readonly key: string;
  readonly node: number;
  readonly edge: number;
  readonly owner: PlayerId;
  readonly built: boolean;
  readonly doneTick: number | null;
}

/** Where the toll leaves a wall: its gate on the road, and the way out of the cell. */
export interface LineMark {
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

/** A fortification placed on its run: its stack level, its depth inside the border and its gate. */
interface Placed {
  readonly spec: FortSpec;
  readonly run: Run;
  readonly level: number;
  readonly depth: number;
  readonly gate: WallGate;
}

/** One stroke of wall to draw: a run from `from` to `to`, its gates, and whether its ends are open. */
interface Stroke {
  readonly run: Run;
  readonly depth: number;
  readonly gates: readonly WallGate[];
  readonly from: number;
  readonly to: number;
  readonly ends: readonly [boolean, boolean];
}

/** A wall that falls (a capture): what it was, and the clock (ms) when it starts to fall. */
interface Fall {
  readonly placed: Placed;
  readonly masonry: Masonry;
  readonly color: number;
  readonly start: number;
}

/** How a stroke is drawn: a ghost of the pick is an outline, a fall moves its pieces. */
interface Ink {
  readonly ghost: boolean;
  readonly alpha: number;
  readonly dx: number;
  readonly dy: number;
}

const SOLID: Ink = { ghost: false, alpha: 1, dx: 0, dy: 0 };

/**
 * The road fortifications (DEC-43, item D; #707), "Set back, two masonries" (#858; #829 round 4,
 * ui-style 55c): each wall keeps to its owner's half, `WALL.offset` inside the land border along the
 * border with the cell its road leads to, the road through its gate short of the border point. The own
 * wall is a battlement with square towers, the enemy's a palisade with round posts; the enemy's are
 * drawn first, so an own wall is never under one. Built walls of one node on neighbouring stretches
 * are one stroke, and open ends stop in a tower. An own build grows from its gate both ways over a row
 * of points; an enemy wall being built is only known to exist (its points and its gate). A capture
 * breaks the walls of the node into lengths that sink, once the winner has walked in. The state comes
 * from `EdgeView.forts` only: an own wall always, an enemy one only while the server shows it (it keeps
 * no memory of enemy walls, so none is drawn in the fog).
 *
 * One `Graphics` for every wall, redrawn when something it shows changes (a fortification, an owner, a
 * build step, the masonry scale of the zoom, the hairline floor), never per frame; a second one for the
 * pick's ghosts, and a third that is redrawn per frame only while a wall falls. `destroy()` frees all.
 */
export class FortView {
  private readonly root = new Container({ label: 'forts' });
  private readonly walls = this.root.addChild(new Graphics({ label: 'fort-walls' }));
  private readonly falls = this.root.addChild(new Graphics({ label: 'fort-falls' }));
  private readonly ghosts = this.root.addChild(new Graphics({ label: 'fort-ghosts' }));
  private readonly labels = this.root.addChild(new Container({ label: 'fort-labels' }));
  private readonly style = new TextStyle({
    fontFamily: pieceFamily(),
    fontSize: 13,
    fontWeight: '600',
    fill: INK,
    stroke: { color: CUT, width: 3.5, join: 'round' },
  });
  private readonly rings = new Map<number, readonly CellEdge[]>();
  private runs = new Map<string, Run>();
  private runsKey = '';
  private marks = new Map<string, LineMark>();
  private targets: FortTarget[] = [];
  private s = 1;
  private cameraScale = 1;
  private resolution = 1;
  private deviceResolution = 1;
  private floor = hairFloor(1, 1);
  private owners: readonly (PlayerId | null)[] = [];
  private forts: readonly FortSpec[] = [];
  private placed: readonly Placed[] = [];
  private tick = 0;
  private buildTicks = 0;
  private key = '';
  private pick: FortPick | null = null;
  private pickKey = '';
  private fallen: Fall[] = [];
  private delays: ReadonlyMap<number, number> = new Map();
  private clock = 0;
  private drewFalls = false;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly edges: () => readonly CellEdge[],
  ) {
    layers.layer.forts.addChild(this.root);
    usePieceFont([this.style]);
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    if (this.price !== null) this.price.resolution = resolution;
  }

  /** The device pixel ratio: no hairline is drawn thinner than one device pixel. */
  setDeviceResolution(resolution: number): void {
    if (!(resolution > 0)) return;
    this.deviceResolution = resolution;
    this.floor = hairFloor(this.cameraScale, resolution);
  }

  /** The camera scale (CSS px per world unit): the masonry keeps its screen size zoomed out. */
  setCameraScale(scale: number): void {
    if (!(scale > 0)) return;
    this.cameraScale = scale;
    this.s = wallScale(scale);
    this.floor = hairFloor(scale, this.deviceResolution);
  }

  setBuildTicks(ticks: number): void {
    this.buildTicks = ticks;
  }

  /**
   * Per node, how long a capture waits for its winner to walk in (`floodDelayMs`, #856): the walls of
   * a node that changed hands in the next snapshot fall after that long.
   */
  setCaptureDelays(delays: ReadonlyMap<number, number>): void {
    this.delays = delays;
  }

  /** Where the toll of the wall of `node` on `edge` leaves it (its gate); `undefined`: not drawn now. */
  lineAt(node: number, edge: number): LineMark | undefined {
    return this.marks.get(`${String(node)}:${String(edge)}`);
  }

  /** The roads a click picks now (while the pick shows), with where the pointer hits each. */
  pickTargets(): readonly FortTarget[] {
    return this.targets;
  }

  /** How many walls are falling now (tests). */
  falling(): number {
    return this.fallen.length;
  }

  /**
   * Called every frame: draws again only when something the walls show differs from the last draw.
   * `tick` is the render tick (a build advances with it).
   */
  update(view: View, tick: number, pick: FortPick | null): void {
    this.tick = tick;
    const owners = view.nodes.map((n) => n.owner);
    const forts = fortsOf(view);
    this.startFalls(forts, owners);
    this.owners = owners;
    this.forts = forts;
    const owned = owners.map((o) => String(o)).join('');
    const step = (doneTick: number | null): string =>
      doneTick === null ? '-' : String(buildProgress(doneTick, tick, this.buildTicks));
    const key = `${String(this.s)}|${String(this.floor)}|${owned}|${forts
      .map((f) => `${f.key}${String(f.owner)}${f.built ? 'b' : step(f.doneTick)}`)
      .join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.drawAll();
    }
    // The pick: the ghosts follow the pick, the walls and the zoom.
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

  /** Advances the falls of captured walls by `dtMs` of real time; draws only while one falls. */
  advance(dtMs: number): void {
    this.clock += Math.max(0, dtMs);
    if (this.fallen.length === 0) {
      if (this.drewFalls) {
        this.falls.clear();
        this.drewFalls = false;
      }
      return;
    }
    this.fallen = this.fallen.filter((fall) => this.clock - fall.start < WALL.fall.ms);
    this.drawFalls();
  }

  // --- Geometry ------------------------------------------------------------------------------

  private ringOf(node: number): readonly CellEdge[] {
    let ring = this.rings.get(node);
    if (ring === undefined) {
      ring = ringOrder(this.edges().filter((e) => e.cell === node));
      this.rings.set(node, ring);
    }
    return ring;
  }

  /** The run of the border the wall of `node` on `edge` lies along (cached per owners). */
  private runFor(node: number, edge: number): Run | undefined {
    const stamp = this.owners.map((o) => String(o)).join('');
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
    const ring = this.ringOf(node);
    // The whole border with the cell the road leads to (#734). A road between cells that do not
    // touch (only some test maps have one) falls back to the border with a cell of the same owner,
    // as long as a stub, then to a straight stub.
    const run =
      borderRun({ ring, shared: (e) => e.neighbour === to, cross, node: from }) ??
      borderRun({
        ring,
        shared: (e) => e.neighbour !== null && (this.owners[e.neighbour] ?? null) === ownerAcross,
        cross,
        node: from,
        half: STUB_HALF,
      }) ??
      stubRun(from, cross, STUB_HALF);
    this.runs.set(key, run);
    return run;
  }

  /** The road out of `node` along `edge` as a unit vector (from the node to the border point). */
  private roadOut(node: number, edge: number): Point {
    const from = nodePoint(this.map, node);
    const cross = borderPoint(this.map, edge);
    if (from === undefined || cross === undefined) return { x: 1, y: 0 };
    const dx = cross.x - from.x;
    const dy = cross.y - from.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  private place(forts: readonly FortSpec[]): Placed[] {
    const runs = forts.map((spec) => ({ spec, run: this.runFor(spec.node, spec.edge) }));
    const found = runs.filter((r): r is { spec: FortSpec; run: Run } => r.run !== undefined);
    const levels = new Map<number, Map<string, number>>();
    for (const node of new Set(found.map((r) => r.spec.node))) {
      levels.set(
        node,
        stackLevels(
          found
            .filter((r) => r.spec.node === node)
            .map((r) => ({ key: r.spec.key, ringLength: r.run.ringLength, ...ringStretch(r.run) })),
        ),
      );
    }
    return found.map((r) => {
      const level = levels.get(r.spec.node)?.get(r.spec.key) ?? 0;
      const depth = (WALL.offset + level * WALL.stack) * this.s;
      const gate = gateOnRun(
        r.run,
        r.run.s0,
        this.roadOut(r.spec.node, r.spec.edge),
        depth,
        WALL.gate * this.s,
      );
      return { spec: r.spec, run: r.run, level, depth, gate };
    });
  }

  /**
   * The strokes of the built walls of one owner: walls of one node on neighbouring stretches of its
   * ring (level 0) are one stroke along the ring, the others one each.
   */
  private strokes(built: readonly Placed[]): Stroke[] {
    const out: Stroke[] = [];
    const single = (p: Placed): Stroke => ({
      run: p.run,
      depth: p.depth,
      gates: [p.gate],
      from: 0,
      to: p.run.len,
      ends: [true, true],
    });
    for (const node of [...new Set(built.map((p) => p.spec.node))].sort((a, b) => a - b)) {
      const mine = built.filter((p) => p.spec.node === node);
      const ringed = mine.filter((p) => p.level === 0 && p.run.ringLength > 0);
      for (const p of mine) if (!ringed.includes(p)) out.push(single(p));
      if (ringed.length === 0) continue;
      const ringLength = ringed[0]?.run.ringLength ?? 0;
      const spans = ringed
        .map((p) => {
          const { from, to } = ringStretch(p.run);
          const k = Math.floor(from / ringLength);
          return { p, from: from - k * ringLength, to: to - k * ringLength };
        })
        .sort((a, b) => a.from - b.from);
      // Chains of walls whose stretches meet (closer than `joinGap`), the last one joined round to the first.
      const chains: { members: typeof spans; from: number; to: number }[] = [];
      for (const span of spans) {
        const last = chains[chains.length - 1];
        if (last !== undefined && span.from - last.to < WALL.joinGap) {
          last.members.push(span);
          last.to = Math.max(last.to, span.to);
        } else chains.push({ members: [span], from: span.from, to: span.to });
      }
      const first = chains[0];
      const last = chains[chains.length - 1];
      if (chains.length > 1 && first !== undefined && last !== undefined) {
        if (first.from + ringLength - last.to < WALL.joinGap) {
          chains.pop();
          first.members.unshift(...last.members);
          first.from = last.from - ringLength;
        }
      }
      const node0 = nodePoint(this.map, node);
      for (const chain of chains) {
        const ring = this.ringOf(node);
        const closed =
          chain.to - chain.from >= ringLength - WALL.joinGap && chain.members.length > 1;
        const run =
          chain.members.length > 1 && node0 !== undefined
            ? stretchRun(ring, node0, chain.from, closed ? chain.from + ringLength : chain.to)
            : null;
        if (run === null) {
          for (const m of chain.members) out.push(single(m.p));
          continue;
        }
        const gates = chain.members.map((m) => {
          const at = (((m.p.run.ringAt - chain.from) % ringLength) + ringLength) % ringLength;
          return gateOnRun(
            run,
            at,
            this.roadOut(m.p.spec.node, m.p.spec.edge),
            m.p.depth,
            WALL.gate * this.s,
          );
        });
        out.push({
          run,
          depth: chain.members[0]?.p.depth ?? WALL.offset * this.s,
          gates,
          from: 0,
          to: run.len,
          ends: closed ? [false, false] : [true, true],
        });
      }
    }
    return out;
  }

  private masonryOf(owner: PlayerId): Masonry {
    return owner === this.me ? 'battlement' : 'palisade';
  }

  private colorOf(owner: PlayerId): number {
    return ownerColor(this.me, owner);
  }

  /** A hairline of `width` at 100 %, never under one device pixel. */
  private hair(width: number): number {
    return Math.max(width, this.floor);
  }

  // --- Drawing -------------------------------------------------------------------------------

  private drawAll(): void {
    const g = this.walls.clear();
    const placed = this.place(this.forts);
    this.placed = placed;
    this.marks = new Map();
    for (const p of placed) {
      const at = wallPoint(p.run, p.gate.at, -p.depth);
      this.marks.set(p.spec.key, { x: at.x, y: at.y, nx: at.nx, ny: at.ny });
    }
    // The enemy's walls first: an own wall is never under one.
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    for (const owner of [enemy, this.me]) {
      const mine = placed.filter((p) => p.spec.owner === owner);
      const kind = this.masonryOf(owner);
      const color = this.colorOf(owner);
      for (const stroke of this.strokes(mine.filter((p) => p.spec.built))) {
        this.stroke(g, stroke, kind, color, SOLID);
      }
      for (const p of mine) if (!p.spec.built) this.building(g, p, kind, color);
    }
  }

  /** A wall under construction: an own one grows from its gate; an enemy one only exists. */
  private building(g: Graphics, p: Placed, kind: Masonry, color: number): void {
    const { run, depth, gate, spec } = p;
    const s = this.s;
    // The tick comes only with an own build in a live view; the full view of a replay has it for
    // both players (#905). A view without it draws the wall as far as it is known.
    const done = spec.doneTick;
    const known = done !== null;
    const share = done === null ? 0 : buildProgress(done, this.tick, this.buildTicks);
    const span = buildSpan(run.len, gate, share);
    const grown: [number, number][] = known
      ? [
          [span.a, span.a0],
          [span.b0, span.b],
        ]
      : [];
    // The part not built yet: a row of points on the wall line.
    const r = Math.max(WALL.dots.min, WALL.dots.radius * s);
    for (const d of dotArcs(run.len, [...grown, [span.a0, span.b0]], WALL.dots.pitch * s)) {
      const at = wallPoint(run, d, -depth);
      g.circle(at.x, at.y, r);
    }
    g.fill({ color: INK, alpha: WALL.dots.alpha });
    for (const [a, b] of grown) {
      if (b - a > 0.8) this.masonry(g, run, a, b, depth, kind, color, SOLID);
    }
    // The gate stands from the start: its towers (an enemy's in outline, it is only known to exist).
    const ink = known ? SOLID : { ...SOLID, ghost: true };
    for (const e of [gate.at - gate.half, gate.at + gate.half]) {
      if (e <= 0.5 || e >= run.len - 0.5) continue;
      this.post(g, wallPoint(run, e, -depth), gate.road, kind, color, ink);
    }
    if (!known) return;
    // The heads of the build: a lozenge at each growing end.
    for (const d of [span.a, span.b]) {
      const at = wallPoint(run, d, -depth);
      const turn = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
      g.poly(flat(squareAt(at, turn, WALL.head.casing * s))).fill(CASING);
      g.poly(flat(squareAt(at, turn, WALL.head.ink * s))).fill(INK);
    }
  }

  /** A stroke of wall: its pieces between the gates, the gate towers and the towers at its open ends. */
  private stroke(g: Graphics, stroke: Stroke, kind: Masonry, color: number, ink: Ink): void {
    const { run, depth } = stroke;
    const s = this.s;
    let { from, to } = stroke;
    // A wall long enough stops a little short of its ends, where its towers stand.
    if (to - from > 12 * s) {
      if (stroke.ends[0]) from += WALL.endTrim * s;
      if (stroke.ends[1]) to -= WALL.endTrim * s;
    }
    const { parts, posts } = wallParts(from, to, stroke.gates);
    for (const [a, b] of parts) this.masonry(g, run, a, b, depth, kind, color, ink);
    for (const post of posts) {
      this.post(g, wallPoint(run, post.at, -depth), post.gate.road, kind, color, ink);
    }
    const inGate = (d: number): boolean =>
      stroke.gates.some((gate) => Math.abs(d - gate.at) <= gate.half + 0.5);
    for (const [on, d] of [
      [stroke.ends[0], from],
      [stroke.ends[1], to],
    ] as const) {
      if (!on || inGate(d)) continue;
      const at = wallPoint(run, d, -depth);
      this.post(g, at, { x: at.tx, y: at.ty }, kind, color, ink);
    }
  }

  /** The masonry of a wall from `a` to `b`: casing, the band and its teeth, the ink line on the city side. */
  private masonry(
    g: Graphics,
    run: Run,
    a: number,
    b: number,
    depth: number,
    kind: Masonry,
    color: number,
    ink: Ink,
  ): void {
    const s = this.s;
    const band = WALL.band * s;
    const move = (points: readonly Point[]): Point[] =>
      ink.dx === 0 && ink.dy === 0
        ? [...points]
        : points.map((p) => ({ x: p.x + ink.dx, y: p.y + ink.dy }));
    const line = move(wallLine(run, a, b, -depth));
    if (line.length < 2) return;
    const path = (points: readonly Point[]): void => {
      const first = points[0];
      if (first === undefined) return;
      g.moveTo(first.x, first.y);
      for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    };
    const alpha = ink.alpha;
    if (!ink.ghost) {
      path(line);
      g.stroke({
        width: band + 2 * WALL.casing * s,
        color: CASING,
        alpha,
        cap: 'butt',
        join: 'round',
      });
      for (const tooth of wallTeeth(run, a, b, depth, kind, s, WALL.toothCasing * s)) {
        g.poly(flat(move(tooth)));
      }
      g.fill({ color: CASING, alpha });
      path(line);
      g.stroke({ width: band, color, alpha, cap: 'butt', join: 'round' });
      for (const tooth of wallTeeth(run, a, b, depth, kind, s)) g.poly(flat(move(tooth)));
      g.fill({ color, alpha });
    } else {
      path(line);
      g.stroke({
        width: band + 1.6 * s,
        color: CASING,
        alpha: alpha * WALL.ghost.casingAlpha,
        cap: 'butt',
        join: 'round',
      });
      path(move(wallLine(run, a, b, -depth + band / 2)));
      path(move(wallLine(run, a, b, -depth - band / 2)));
      for (const tooth of wallTeeth(run, a, b, depth, kind, s)) g.poly(flat(move(tooth)));
      g.stroke({ width: this.hair(WALL.ink), color: INK, alpha, join: 'round' });
    }
    // The ivory hairline on the city side.
    path(move(wallLine(run, a, b, -depth - (band / 2 + WALL.inkGap * s))));
    g.stroke({
      width: this.hair(WALL.ink),
      color: INK,
      alpha: alpha * (ink.ghost ? 0.85 : 1),
      cap: 'butt',
      join: 'round',
    });
  }

  /** A gate tower or an end tower: a square tower (battlement) or a round post (palisade), turned to `dir`. */
  private post(g: Graphics, at: Point, dir: Point, kind: Masonry, color: number, ink: Ink): void {
    const s = this.s;
    const h = WALL.post * s;
    const c = WALL.postCasing * s;
    const p = { x: at.x + ink.dx, y: at.y + ink.dy };
    const casingAlpha = ink.alpha * (ink.ghost ? WALL.ghost.casingAlpha : 1);
    const width = this.hair(WALL.ink);
    if (kind === 'battlement') {
      g.poly(flat(squareAt(p, dir, h + c))).fill({ color: CASING, alpha: casingAlpha });
      if (!ink.ghost) g.poly(flat(squareAt(p, dir, h))).fill({ color, alpha: ink.alpha });
      g.poly(flat(squareAt(p, dir, ink.ghost ? h : h - s))).stroke({
        width,
        color: INK,
        alpha: ink.alpha,
        join: 'miter',
      });
    } else {
      g.circle(p.x, p.y, h + c).fill({ color: CASING, alpha: casingAlpha });
      if (!ink.ghost) g.circle(p.x, p.y, h).fill({ color, alpha: ink.alpha });
      g.circle(p.x, p.y, ink.ghost ? h : h * 0.45).stroke({ width, color: INK, alpha: ink.alpha });
    }
  }

  // --- Captures --------------------------------------------------------------------------------

  /** The walls the next snapshot dropped while their node changed hands fall (not with "less motion"). */
  private startFalls(forts: readonly FortSpec[], owners: readonly (PlayerId | null)[]): void {
    if (this.placed.length === 0 || this.owners.length === 0) return;
    if (forts === this.forts) return;
    const kept = new Set(forts.map((f) => f.key));
    if (reducedMotion()) return;
    for (const p of this.placed) {
      const { node, owner } = p.spec;
      if (kept.has(p.spec.key) || !p.spec.built) continue;
      if ((owners[node] ?? null) === (this.owners[node] ?? null)) continue;
      this.fallen.push({
        placed: p,
        masonry: this.masonryOf(owner),
        color: this.colorOf(owner),
        start: this.clock + (this.delays.get(node) ?? 0),
      });
    }
  }

  private drawFalls(): void {
    const g = this.falls.clear();
    this.drewFalls = true;
    const s = this.s;
    const { drift, drop } = WALL.fall;
    for (const fall of this.fallen) {
      const { run, depth, gate, spec } = fall.placed;
      const age = this.clock - fall.start;
      if (age < 0) {
        // Still standing until the winner has walked in.
        this.stroke(
          g,
          { run, depth, gates: [gate], from: 0, to: run.len, ends: [true, true] },
          fall.masonry,
          fall.color,
          SOLID,
        );
        continue;
      }
      const centre = nodePoint(this.map, spec.node) ?? { x: 0, y: 0 };
      const { parts } = wallParts(0, run.len, [gate]);
      for (const piece of fallPieces(run.len, age, s)) {
        for (const [a, b] of parts) {
          const lo = Math.max(a, piece.from);
          const hi = Math.min(b, piece.to);
          if (hi - lo < 0.5) continue;
          const at = wallPoint(run, lo, -depth);
          const vx = at.x - centre.x;
          const vy = at.y - centre.y;
          const vl = Math.hypot(vx, vy) || 1;
          this.masonry(g, run, lo, hi, depth, fall.masonry, fall.color, {
            ghost: false,
            alpha: 1 - piece.q,
            dx: (vx / vl) * piece.q * drift * s,
            dy: (vy / vl) * piece.q * drift * s + piece.q * drop * s,
          });
        }
      }
    }
  }

  // --- The pick --------------------------------------------------------------------------------

  /** The pick: a ghost of the wall on every pickable road, the hovered one solid with its price. */
  private drawGhosts(): void {
    const g = this.ghosts.clear();
    this.targets = [];
    const pick = this.pick;
    if (pick === null) {
      this.hidePrice();
      return;
    }
    const own = this.forts.filter((f) => f.node === pick.node);
    const candidates = pick.edges.map((edge): FortSpec => ({
      key: `${String(pick.node)}:${String(edge)}`,
      node: pick.node,
      edge,
      owner: this.me,
      built: true,
      doneTick: null,
    }));
    const placed = this.place([...own, ...candidates]).filter(
      (p) => pick.edges.includes(p.spec.edge) && !own.some((f) => f.key === p.spec.key),
    );
    const kind = this.masonryOf(this.me);
    const color = this.colorOf(this.me);
    let hover: Placed | undefined;
    for (const p of placed) {
      const isHover = p.spec.edge === pick.hover;
      if (isHover) hover = p;
      this.stroke(
        g,
        { run: p.run, depth: p.depth, gates: [p.gate], from: 0, to: p.run.len, ends: [true, true] },
        kind,
        color,
        { ghost: true, alpha: isHover ? WALL.ghost.hover : WALL.ghost.alpha, dx: 0, dy: 0 },
      );
      // Where the pointer counts as on this ghost: the wall, a little way towards the border.
      this.targets.push({ edge: p.spec.edge, line: wallLine(p.run, 0, p.run.len, -p.depth + 2) });
    }
    if (hover === undefined) {
      this.hidePrice();
      return;
    }
    // The price beside the gate, on the city side: the CP mark and the number.
    const at = wallPoint(hover.run, hover.gate.at, -(hover.depth + 16 * this.s));
    const k = Math.max(1, 1 / this.cameraScale);
    const text = this.priceText();
    text.text = pick.amount ?? pick.cost;
    text.scale.set(k);
    const mark = 13 * k;
    // The width of the number from its characters (no text measure: the plate is not boxed).
    const digits = text.text.length * 6.5 * k;
    const width = digits + mark + 2 * k;
    text.position.set(at.x - width / 2 + mark + 2 * k + digits / 2, at.y);
    text.visible = true;
    this.cpMark(g, { x: at.x - width / 2, y: at.y - mark / 2 }, mark);
  }

  /** The CP mark (`theme/cpMark.ts`) in a square of side `size` with its top left at `at`. */
  private cpMark(g: Graphics, at: Point, size: number): void {
    const { box, shapes, casing, ink } = CP_MARK;
    const k = size / box.width;
    const place = (shape: readonly number[]): number[] =>
      shape.map((v, i) => (i % 2 === 0 ? at.x + (v - box.x) * k : at.y + (v - box.y) * k));
    for (const shape of shapes) {
      g.poly(place(shape)).stroke({ width: casing.width * k, color: casing.color, join: 'miter' });
    }
    for (const shape of shapes) g.poly(place(shape)).fill(ink);
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

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);
