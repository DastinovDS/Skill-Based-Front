/**
 * The Ruled veil of the fog of war (#829, round 3 topic n "Ruled veil"; #842).
 *
 * What is hidden comes from the snapshot only: an area is under the veil when its node has
 * `detail: 'fog'` (`veilCities`); the owner of every node is public (mechanics, "To everyone,
 * always"), so the owner's band and borders are drawn again over the veil and stay readable.
 *
 * - `ground` (in the background layer, over the baked picture): the hidden areas filled with a
 *   grey copy of the picture (`RULED_VEIL.grey` of the colour out), made once per picture;
 * - `veil` (in the fog layer, over the cities): a dark fill and one run of fine horizontal rules
 *   (a tiling hatch in zoom buckets, `HatchTile`);
 * - `band` and `lines`: the Border band and the engraved border lines of the hidden areas again,
 *   over the veil;
 * - `edge`: the edge of sight, a double hairline on a dark casing with ticks into the fog.
 *
 * Everything is a plain Graphics, redrawn only when the hidden set, the owners, the zoom bucket or
 * the floor of a hairline changes: no filter, no mask, no per-frame work.
 */
import { CanvasSource, Container, Graphics, Texture } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  BORDER_BAND,
  ENGRAVE,
  HatchTile,
  RULED_VEIL,
  hairWidth,
  pointsAlong,
  sightEdge,
  traceRuns,
  type HatchSpec,
} from './engraving.ts';
import { sameVeil } from './fogLayout.ts';
import type { CellEdge } from './regionLayout.ts';
import { TERRAIN_FILL } from './style.ts';

/** What the map hands the veil to draw the owner's marks again over it. */
export interface VeilTerritory {
  /** Draws the band of the areas `cells` into `g` at `alpha`. */
  readonly band: (g: Graphics, cells: ReadonlySet<number>, alpha: number) => void;
  /** Draws the engraved border lines of the areas `cells` into `g` at `alpha`. */
  readonly lines: (g: Graphics, cells: ReadonlySet<number>, alpha: number) => void;
}

/** A colour with `share` of its saturation taken out (Rec. 601 luma). */
export function greyed(color: number, share: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number): number => Math.round(c + (y - c) * share);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/**
 * Takes `share` of the saturation out of RGBA pixels in place, as `greyed` does to one colour
 * (alpha kept): the grey ground of the veil from the baked picture.
 */
export function greyPixels(data: Uint8ClampedArray, share: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    // Uint8ClampedArray rounds to the nearest on assignment, as `greyed` does.
    data[i] = r + (y - r) * share;
    data[i + 1] = g + (y - g) * share;
    data[i + 2] = b + (y - b) * share;
  }
}

export class VeilView {
  private readonly ground = new Graphics({ label: 'fog-ground', visible: false });
  private readonly holder = new Container({ label: 'fog-veil' });
  private readonly veil = new Graphics({ label: 'fog-veil-rules' });
  private readonly band = new Graphics({ label: 'fog-band' });
  private readonly lines = new Graphics({ label: 'fog-borders' });
  private readonly edge = new Graphics({ label: 'fog-edge' });
  private readonly rules: HatchTile;
  private grey: Texture | null = null;
  private hidden: number[] = [];
  private hiddenSet: ReadonlySet<number> = new Set();
  private zoom = 1;
  private resolution = 1;
  private groundShown = true;

  constructor(
    private readonly map: MapFile,
    /** The background layer: the grey ground goes in at `groundAt`. */
    background: Container,
    groundAt: number,
    /** The fog layer: the veil goes in first, under the memory ghosts. */
    fog: Container,
    private readonly cells: readonly Point[][],
    /** The edges of the areas, with an inward normal on each (`withInward`). */
    private readonly edges: readonly CellEdge[],
    private readonly territory: VeilTerritory,
  ) {
    // The dark veil and the rules over it in one tile: one fill instead of two (#854).
    this.rules = new HatchTile(RULED_VEIL.rules satisfies HatchSpec, {
      line: { color: RULED_VEIL.rules.color, alpha: RULED_VEIL.rules.alpha },
      under: RULED_VEIL.veil,
    });
    this.rules.update(this.zoom, this.resolution);
    background.addChildAt(this.ground, groundAt);
    this.holder.addChild(this.veil, this.band, this.lines, this.edge);
    fog.addChildAt(this.holder, 0);
  }

  /** The hidden areas (sorted node ids, `veilCities`); the same set costs nothing. */
  setHidden(hidden: readonly number[]): void {
    if (sameVeil(hidden, this.hidden)) return;
    this.hidden = [...hidden];
    this.hiddenSet = new Set(hidden);
    this.drawGround();
    this.drawVeil();
    this.drawTerritory();
    this.drawEdge();
  }

  /** The owners changed: the band and the borders over the veil follow. */
  ownersChanged(): void {
    this.drawTerritory();
  }

  /**
   * The baked picture (1 px per world unit) the grey ground is made from; `null`: the flat terrain
   * colours, greyed per area.
   */
  setPicture(texture: Texture | null): void {
    this.grey?.destroy(true);
    this.grey = texture === null ? null : this.greyCopy(texture);
    this.drawGround();
  }

  /** The grey ground is hidden with the picture (the «Supply» and terrain modes). */
  setGroundVisible(on: boolean): void {
    this.groundShown = on;
    this.ground.visible = on && this.hidden.length > 0;
  }

  /** The camera: the rules keep their screen pitch, the hairlines at least one device pixel. */
  setCamera(zoom: number, resolution: number, floorChanged: boolean): void {
    this.zoom = zoom;
    this.resolution = resolution;
    if (this.rules.update(zoom, resolution)) this.drawVeil();
    if (floorChanged) {
      this.drawTerritory();
      this.drawEdge();
    }
  }

  /** The band changed its zoom bucket: drawn again with the new pattern. */
  bandChanged(): void {
    this.drawTerritory();
  }

  destroy(): void {
    this.holder.destroy({ children: true });
    this.ground.destroy();
    this.rules.destroy();
    this.grey?.destroy(true);
  }

  /**
   * The grey copy of the picture, made on the CPU (#854): a colour matrix filter would compile a
   * shader and run a world-sized pass on the GPU, which takes most of a second under software WebGL
   * while the match screen comes up; the same matrix over the pixels takes a few milliseconds.
   */
  private greyCopy(texture: Texture): Texture | null {
    const image = texture.source.resource as CanvasImageSource | null | undefined;
    if (image === null || image === undefined || typeof document === 'undefined') return null;
    const width = Math.max(1, Math.round(this.map.meta.width));
    const height = Math.max(1, Math.round(this.map.meta.height));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    greyPixels(pixels.data, RULED_VEIL.grey);
    context.putImageData(pixels, 0, 0);
    return new Texture({
      source: new CanvasSource({ resource: canvas, width, height, resolution: 1 }),
    });
  }

  private drawGround(): void {
    const g = this.ground.clear();
    this.ground.visible = this.groundShown && this.hidden.length > 0;
    if (this.hidden.length === 0) return;
    for (const id of this.hidden) {
      const cell = this.cells[id];
      if (cell === undefined || cell.length < 3) continue;
      if (this.grey !== null) {
        g.poly(cell).fill({ texture: this.grey, textureSpace: 'global' });
      } else {
        const terrain = this.map.nodes[id]?.terrain;
        if (terrain !== undefined)
          g.poly(cell).fill(greyed(TERRAIN_FILL[terrain], RULED_VEIL.grey));
      }
    }
  }

  private drawVeil(): void {
    const g = this.veil.clear();
    const polygons = this.hidden.flatMap((id) => {
      const cell = this.cells[id];
      return cell === undefined || cell.length < 3 ? [] : [cell];
    });
    if (polygons.length === 0) return;
    // The tile carries the dark veil under the rules and their colours: drawn untinted.
    for (const cell of polygons) g.poly(cell);
    g.fill({
      texture: this.rules.texture,
      textureSpace: 'global',
      matrix: this.rules.matrix(RULED_VEIL.rules.angle),
    });
  }

  private drawTerritory(): void {
    const band = this.band.clear();
    const lines = this.lines.clear();
    if (this.hidden.length === 0) return;
    this.territory.band(band, this.hiddenSet, RULED_VEIL.band);
    this.territory.lines(lines, this.hiddenSet, RULED_VEIL.borders);
  }

  private drawEdge(): void {
    const g = this.edge.clear();
    if (this.hidden.length === 0) return;
    const { casing, line, tick } = RULED_VEIL.edge;
    const hair = (w: number): number => hairWidth(w, this.zoom, this.resolution);
    const at = (inset: number) => sightEdge(this.cells, this.hiddenSet, this.edges, inset);
    const centre = at(0);
    if (centre.length === 0) return;
    traceRuns(g, centre);
    g.stroke({ width: casing, color: ENGRAVE.casing, cap: 'round', join: 'round' });
    for (const side of [line.offset, -line.offset]) {
      for (const { a, b } of at(side)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    // The ticks run from the rule into the fog: along the inner line, the way the inset goes.
    const near = at(tick.from);
    const into = near.map((s, i) => {
      const c = centre[i];
      if (c === undefined) return { x: 0, y: 0 };
      const dx = (s.a.x + s.b.x - c.a.x - c.b.x) / 2;
      const dy = (s.a.y + s.b.y - c.a.y - c.b.y) / 2;
      const l = Math.hypot(dx, dy) || 1;
      return { x: dx / l, y: dy / l };
    });
    const reach = tick.to - tick.from;
    for (const { at: p, index } of pointsAlong(near, tick.step)) {
      const n = into[index] ?? { x: 0, y: 0 };
      g.moveTo(p.x, p.y).lineTo(p.x + n.x * reach, p.y + n.y * reach);
    }
    g.stroke({ width: hair(line.width), color: ENGRAVE.ink, alpha: line.alpha, cap: 'butt' });
  }
}

/** The angle of the hatch of an owner's band, as `me` sees it. */
export function bandAngle(me: PlayerId, owner: PlayerId): number {
  return owner === me ? BORDER_BAND.ownAngle : BORDER_BAND.enemyAngle;
}
