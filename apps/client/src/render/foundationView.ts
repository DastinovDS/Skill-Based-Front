import { Container, Graphics } from 'pixi.js';
import type { Point } from './camera.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { foundationOrigin, markSeats, socketAt, type SocketKind } from './foundationLayout.ts';
import { dropShape, ringCell, type RecruitShow } from './recruitDrop.ts';
import {
  cpMarkGlyph,
  cpMarkSpec,
  foundationAlertSpec,
  foundationSpec,
  socketFillSpec,
  socketGlowSpec,
  socketHeadSpec,
  socketRuleSpec,
  socketSpec,
} from './pieceShapes.ts';
import { CASING, FOUNDATION, RING_ENGRAVED } from './style.ts';
import { EaseTween } from './tween.ts';
import { ENGRAVED } from '../theme/tokens.ts';

/** What a foundation shows (from the snapshot and the rules: `foundationLayout.ts`). */
export interface FoundationLook {
  /** The kind of each socket, left to right (their number is the foundation's). */
  readonly kinds: readonly SocketKind[];
  /** The share of the unit under way that is made (0..1). */
  readonly share: number;
  /** The amber rim: no room, or a fight in the city. */
  readonly alert: boolean;
  /** The owner's colour. */
  readonly color: number;
  /**
   * The CP marks of the queued walks to the rally point, by slot: `true` where the CP now do not
   * pay it (#930, W4).
   */
  readonly walks: readonly boolean[];
}

/** The capacity ring a made unit drops into: its radius, its places and the cell it fills. */
export interface DropRing {
  readonly radius: number;
  readonly capacity: number;
  readonly index: number;
}

/** One socket's two sprites: its body (plate and hatch) and its rule over it. */
interface Socket {
  readonly body: BakedSprite;
  readonly rule: BakedSprite;
}

/** One CP mark of a walk: dimmed, inked in from its foot as its recruit is made. */
interface Mark {
  readonly root: Container;
  readonly back: BakedSprite;
  readonly fill: BakedSprite;
}

/** How long the fill of the unit under way takes to follow a new snapshot, ms (one snapshot apart). */
const FILL_EASE_MS = 120;
/** The dim of a CP mark not inked in yet (#930, W4). */
const MARK_DIM = 0.42;

const ruleOf = (kind: SocketKind): 'empty' | 'free' | 'filled' =>
  kind === 'empty' || kind === 'free' ? kind : 'filled';

/**
 * The barracks' foundation of one city (#1005, D2 "Foundation", ui-style 76): baked sprites in a
 * container at the barracks' seat, scaled with the icon; the made unit's drop into the capacity
 * ring is a short-lived `Graphics` in the city's own frame, redrawn only while it moves.
 */
export class FoundationView {
  /** At the barracks' seat, scaled with the icon (the shapes are drawn for the 16-unit icon). */
  readonly root: Container;
  /** The made unit on its way into the ring and the flash of the ring's cell (city frame). */
  readonly drop: Graphics;
  /** The shown share of the unit under way: eases toward the snapshot's. */
  readonly share = new EaseTween(0, FILL_EASE_MS);
  private readonly base: BakedSprite;
  private readonly recessLayer: Container;
  private readonly cellLayer: Container;
  /** The recesses, fixed. */
  private readonly recesses: Socket[] = [];
  /** The queue's cells over them (they slide one socket left when a unit is made). */
  private readonly cells: Socket[] = [];
  private readonly fill: BakedSprite;
  private readonly glow: BakedSprite;
  private readonly head: BakedSprite;
  /** The owner's colour still in the first socket as a made unit leaves it. */
  private readonly lift: BakedSprite;
  private readonly alert: BakedSprite;
  private readonly marksLayer: Container;
  private readonly marks: Mark[] = [];
  private look: FoundationLook | null = null;
  private slide = 0;
  private dropKey = '';

  constructor(
    city: Container,
    at: number,
    private readonly sprites: SpriteCache,
  ) {
    this.root = new Container({ label: 'foundation', visible: false });
    this.drop = new Graphics({ label: 'recruit-drop', visible: false });
    city.addChildAt(this.drop, at);
    city.addChildAt(this.root, at);
    // Bottom up: the base, the recesses, the queue's cells, the made part with its head, the unit
    // leaving, the amber rim, the CP marks.
    this.base = this.root.addChild(sprites.sprite());
    this.recessLayer = this.root.addChild(new Container({ label: 'recesses' }));
    this.cellLayer = this.root.addChild(new Container({ label: 'cells' }));
    this.fill = this.root.addChild(sprites.sprite());
    this.glow = this.root.addChild(sprites.sprite(socketGlowSpec()));
    this.head = this.root.addChild(sprites.sprite(socketHeadSpec()));
    this.lift = this.root.addChild(sprites.sprite());
    this.alert = this.root.addChild(sprites.sprite());
    this.marksLayer = this.root.addChild(new Container({ label: 'walk-marks' }));
    for (const sprite of [this.lift, this.fill, this.glow, this.head, this.alert]) {
      sprite.visible = false;
    }
  }

  /** Shows `look` (a new snapshot or selection); `snap`: the fill jumps (a new queue, "less motion"). */
  show(look: FoundationLook, snap: boolean): void {
    this.look = look;
    const n = look.kinds.length;
    this.base.set(foundationSpec(n));
    while (this.recesses.length < n) this.recesses.push(this.socket(this.recessLayer));
    while (this.cells.length < n) this.cells.push(this.socket(this.cellLayer));
    const o = foundationOrigin(n);
    this.recesses.forEach((s, j) => {
      const kind = look.kinds[j];
      const shown = kind !== undefined;
      s.body.visible = shown;
      s.rule.visible = shown;
      if (!shown) return;
      const at = socketAt(j);
      s.body.position.set(o.x + at.x, o.y + at.y);
      s.rule.position.set(o.x + at.x, o.y + at.y);
      // Under the queue a recess; past it a recess or a free slot.
      const recess = kind === 'free' ? 'free' : 'empty';
      s.body.set(socketSpec(recess, look.color));
      s.rule.set(socketRuleSpec(recess));
    });
    this.cells.forEach((s, j) => {
      const kind = look.kinds[j];
      const shown = kind !== undefined && kind !== 'empty' && kind !== 'free';
      s.body.visible = shown;
      s.rule.visible = shown;
      if (kind === undefined || !shown) return;
      s.body.set(socketSpec(kind === 'queued' ? 'queued' : 'under', look.color));
      s.rule.set(socketRuleSpec(ruleOf(kind)));
    });
    if (snap || look.share < this.share.value) this.share.snap(look.share);
    else this.share.setTarget(look.share);
    this.fill.set(socketFillSpec(look.color));
    this.lift.set(socketFillSpec(look.color));
    this.alert.set(look.alert ? foundationAlertSpec(n) : null);
    this.alert.visible = look.alert;
    this.showMarks(look, n);
    this.layoutCells();
  }

  /** The queue slides `slide` of a socket (1 at a unit made, 0 at rest). */
  setSlide(slide: number): void {
    if (slide === this.slide) return;
    this.slide = slide;
    this.layoutCells();
  }

  /** Every frame the fill eases: puts the shown share on the cell under way. Returns whether it still moves. */
  stepShare(dtMs: number): boolean {
    this.share.step(dtMs);
    this.showShare();
    return this.share.active;
  }

  /** The amber rim's and the head glow's opacity this frame. */
  pulse(alert: number, glow: number): void {
    this.alert.alpha = alert;
    this.glow.alpha = glow;
  }

  /**
   * The made unit this frame (`show`, or `null`: none): it leaves the first socket and, when `ring`
   * is given (the viewer's own garrison), drops into the cell `ring.index` of the capacity ring, then
   * the cell flashes. `seat` and `k`: where the barracks stands and the foundation's scale.
   */
  showDrop(show: RecruitShow | null, seat: Point, k: number, ring: DropRing | null): void {
    const look = this.look;
    const lift = show === null ? 0 : show.drop !== null ? liftOf(show.drop) : show.leave;
    this.lift.visible = lift > 0 && look !== null;
    if (this.lift.visible && look !== null) {
      const o = foundationOrigin(look.kinds.length);
      const at = socketAt(0);
      this.lift.position.set(o.x + at.x, o.y + at.y);
      this.lift.alpha = lift;
    }
    const drop = show?.drop ?? null;
    const flash = show?.flash ?? null;
    const on = look !== null && ring !== null && (drop !== null || flash !== null);
    const key = on
      ? `${String(drop)}:${String(flash)}:${String(seat.x)}:${String(seat.y)}:${String(k)}`
      : '';
    if (key === this.dropKey) return;
    this.dropKey = key;
    this.drop.clear();
    this.drop.visible = on;
    if (!on) return;
    const cell = ringCell(ring.capacity, ring.index);
    if (drop !== null) {
      const o = foundationOrigin(look.kinds.length);
      const at = socketAt(0);
      const side = FOUNDATION.cell;
      const socket = {
        x: seat.x + (o.x + at.x + side / 2) * k,
        y: seat.y + (o.y + at.y + side / 2) * k,
        width: side * k,
        height: side * k,
      };
      const s = dropShape(drop, socket, ring.radius, cell, k);
      if (s.alpha > 0) {
        this.arc(s.r, s.from, s.to, s.casing, CASING, 0.9 * s.alpha);
        this.arc(s.r, s.from, s.to, s.width, look.color, s.alpha);
        const sheen = 0.5 * s.alpha * s.sheen;
        const trim = 0.05 * (s.to - s.from);
        if (sheen > 0.01) {
          this.arc(s.r + s.width * 0.28, s.from + trim, s.to - trim, 0.6 * k, ENGRAVED.ink, sheen);
        }
      }
    }
    if (flash !== null) {
      const width = RING_ENGRAVED.filled + 3 * (1 - flash);
      this.arc(ring.radius, cell.from, cell.to, width, ENGRAVED.ink, 1 - flash);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.drop.destroy();
  }

  private arc(
    r: number,
    from: number,
    to: number,
    width: number,
    color: number,
    alpha: number,
  ): void {
    if (to <= from || alpha <= 0) return;
    this.drop
      .moveTo(r * Math.cos(from), r * Math.sin(from))
      .arc(0, 0, r, from, to)
      .stroke({ width, color, alpha, cap: 'butt' });
  }

  private socket(layer: Container): Socket {
    const body = layer.addChild(this.sprites.sprite());
    const rule = layer.addChild(this.sprites.sprite());
    return { body, rule };
  }

  /** The queue's cells slid by `slide` over the recesses. */
  private layoutCells(): void {
    const look = this.look;
    if (look === null) return;
    const o = foundationOrigin(look.kinds.length);
    this.cells.forEach((s, j) => {
      if (!s.body.visible) return;
      const at = socketAt(j + this.slide);
      s.body.position.set(o.x + at.x, o.y + at.y);
      s.rule.position.set(o.x + at.x, o.y + at.y);
    });
    this.showShare();
  }

  /** The made part of the unit under way (the first cell), its head line and glow, and the first CP mark's ink. */
  private showShare(): void {
    const look = this.look;
    if (look === null) return;
    const first = look.kinds[0];
    const made = first === 'active' || first === 'full';
    const share = first === 'full' ? 1 : this.share.value;
    const o = foundationOrigin(look.kinds.length);
    const at = socketAt(this.slide);
    const x = o.x + at.x;
    const y = o.y + at.y;
    this.fill.visible = made && share > 0;
    if (this.fill.visible) {
      this.fill.position.set(x, y);
      this.fill.scale.set(share, 1);
    }
    // The head line and its glow stand at the front of a unit still being made.
    const running = first === 'active' && share > 0.01 && share < 0.995;
    this.head.visible = running;
    this.glow.visible = running;
    if (running) {
      const hx = x + share * FOUNDATION.cell;
      this.head.position.set(hx, y);
      this.glow.position.set(hx, y + FOUNDATION.cell / 2);
    }
    this.marks.forEach((m, j) => {
      showMarkFill(m, j === 0 && made ? share : 0);
    });
  }

  private showMarks(look: FoundationLook, sockets: number): void {
    const seats = markSeats(sockets, look.walks.length);
    while (this.marks.length < seats.length) {
      const root = this.marksLayer.addChild(new Container({ label: 'walk-mark' }));
      const back = root.addChild(this.sprites.sprite());
      const fill = root.addChild(this.sprites.sprite());
      this.marks.push({ root, back, fill });
    }
    const size = FOUNDATION.marks.size;
    this.marks.forEach((m, j) => {
      const at = seats[j];
      const short = look.walks[j];
      m.root.visible = at !== undefined && short !== undefined;
      if (at === undefined || short === undefined) return;
      m.root.position.set(at.x, at.y);
      m.back.set(cpMarkSpec(short ? 'down' : 'ink', size, MARK_DIM));
      m.fill.set(short ? null : cpMarkSpec('ink', size));
    });
  }
}

/** The owner's colour left in the first socket `q` of the way through a drop. */
function liftOf(q: number): number {
  const t = Math.min(1, Math.max(0, q / 0.3));
  return 1 - t * t * (3 - 2 * t);
}

/** Inks a walk's CP mark in from its foot as its recruit is made (#930, W4). */
function showMarkFill(mark: Mark, shown: number): void {
  mark.fill.visible = mark.root.visible && shown > 0 && mark.fill.spec !== null;
  if (!mark.fill.visible) return;
  const size = FOUNDATION.marks.size;
  const g = cpMarkGlyph(size);
  const half = size / 2 + 1;
  mark.fill.cropBottom(half - g.bottom + 1 + shown * (g.bottom - g.top));
}
