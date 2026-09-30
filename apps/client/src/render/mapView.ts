import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { MapJson, PlayerId, Terrain } from '../map/mapJson.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import {
  CAPITAL_RADIUS,
  CAPITAL_STAR,
  CELL_BORDER,
  INNER_RING,
  INNER_RING_INSET,
  MAP_BORDER,
  NEUTRAL_FILL,
  NEUTRAL_OUTLINE,
  NODE_RADIUS,
  OWNER_OUTLINE,
  PLAYER_COLOR,
  ROAD_COLOR,
  TERRAIN_FILL,
  TERRAIN_GLYPH,
  TERRITORY_ALPHA,
  VP_BADGE,
  VP_BADGE_RADIUS,
  VP_FONT_SIZE,
  VP_TEXT_COLOR,
  roadThickness,
} from './style.ts';
import { voronoiCells } from './voronoi.ts';

type Owner = PlayerId | null;
type OwnerKey = 'neutral' | 'player0' | 'player1';

function ownerKey(owner: Owner): OwnerKey {
  return owner === null ? 'neutral' : owner === 0 ? 'player0' : 'player1';
}

/** A point at `distance` from the city centre in direction `degrees` (0 = right, y down). */
function around(distance: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

/**
 * Static part of the map: terrain background, territory, roads and cities with owner, capital
 * star and VP. Owners and road widths come from the map start fields now and from snapshots later
 * (CLI-04, #60) through `setOwners` and `setRoadWidths`.
 *
 * Identical shapes share one GraphicsContext (a city body per owner, the capital star, terrain
 * glyphs, the VP badge, the unit road rectangle); `destroy()` releases every object and context
 * created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly body: Readonly<Record<OwnerKey, GraphicsContext>>;
  private readonly roadContext: GraphicsContext;
  private readonly labelStyle: TextStyle;
  private readonly cells: Point[][];
  private readonly background: Graphics;
  private readonly territory: Graphics;
  private readonly roads: Graphics[];
  private readonly nodes: Container[];
  private readonly bodies: Graphics[] = [];
  private readonly labels: Text[] = [];

  constructor(
    private readonly map: MapJson,
    layers: MapLayers,
    labelResolution: number,
  ) {
    const bounds = { width: map.meta.width, height: map.meta.height };
    this.cells = voronoiCells(map.nodes, bounds);

    this.body = {
      neutral: this.context((g) =>
        g.circle(0, 0, NODE_RADIUS).fill(NEUTRAL_FILL).stroke(NEUTRAL_OUTLINE),
      ),
      player0: this.context((g) =>
        g.circle(0, 0, NODE_RADIUS).fill(PLAYER_COLOR[0]).stroke(OWNER_OUTLINE),
      ),
      player1: this.context((g) =>
        g
          .circle(0, 0, NODE_RADIUS)
          .fill(PLAYER_COLOR[1])
          .stroke(OWNER_OUTLINE)
          .circle(0, 0, NODE_RADIUS - INNER_RING_INSET)
          .stroke(INNER_RING),
      ),
    };
    const star = this.context((g) =>
      g
        .star(0, 0, 5, NODE_RADIUS * 0.62, NODE_RADIUS * 0.28)
        .fill(CAPITAL_STAR.fill)
        .stroke(CAPITAL_STAR.stroke),
    );
    const glyph: Readonly<Record<Terrain, GraphicsContext | null>> = {
      plains: null,
      forest: this.context((g) =>
        g
          .rect(-1, 2, 2, 3)
          .fill(TERRAIN_GLYPH)
          .poly([-4.5, 2.5, 0, -5, 4.5, 2.5])
          .fill(TERRAIN_GLYPH),
      ),
      mountains: this.context((g) =>
        g
          .poly([-6, 4, -2, -3, 2, 4])
          .fill(TERRAIN_GLYPH)
          .poly([-1, 4, 2.5, -5, 6, 4])
          .fill(TERRAIN_GLYPH),
      ),
    };
    const badge = this.context((g) =>
      g.circle(0, 0, VP_BADGE_RADIUS).fill(VP_BADGE.fill).stroke(VP_BADGE.stroke),
    );
    // A unit rectangle along +x; each road scales it to its length and thickness.
    this.roadContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_COLOR));
    this.labelStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: VP_FONT_SIZE,
      fontWeight: '700',
      fill: VP_TEXT_COLOR,
    });

    this.background = layers.layer.background.addChild(this.drawBackground());
    this.territory = layers.layer.territory.addChild(new Graphics());

    this.roads = map.edges.map((edge) => {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      const road = new Graphics(this.roadContext);
      if (a !== undefined && b !== undefined) {
        road.position.set(a.x, a.y);
        road.rotation = Math.atan2(b.y - a.y, b.x - a.x);
        road.scale.x = Math.hypot(b.x - a.x, b.y - a.y);
      }
      return layers.layer.roads.addChild(road);
    });

    this.nodes = map.nodes.map((node) => {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      const radius = node.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
      const body = city.addChild(new Graphics(this.body.neutral));
      body.scale.set(radius / NODE_RADIUS);
      this.bodies.push(body);
      if (node.capital_of !== null) {
        city.addChild(new Graphics(star)).scale.set(radius / NODE_RADIUS);
      }
      const terrain = glyph[node.terrain];
      if (terrain !== null) {
        const at = around(radius + 8, 140);
        city.addChild(new Graphics(terrain)).position.set(at.x, at.y);
      }
      if (node.vp > 0) {
        const at = around(radius + 1, -45);
        city.addChild(new Graphics(badge)).position.set(at.x, at.y);
        const label = new Text({
          text: String(node.vp),
          style: this.labelStyle,
          anchor: 0.5,
          resolution: labelResolution,
        });
        label.position.set(at.x, at.y);
        this.labels.push(city.addChild(label));
      }
      return layers.layer.nodes.addChild(city);
    });

    this.setOwners(map.nodes.map((node) => node.start_owner));
    this.setRoadWidths(map.edges.map((edge) => edge.base_width));
  }

  /** `owners[i]`: current owner of node `i` (`null`: nobody). */
  setOwners(owners: readonly Owner[]): void {
    this.territory.clear();
    owners.forEach((owner, i) => {
      const body = this.bodies[i];
      if (body !== undefined) {
        body.context = this.body[ownerKey(owner)];
      }
      const cell = this.cells[i];
      if (owner !== null && cell !== undefined) {
        this.territory.poly(cell).fill({ color: PLAYER_COLOR[owner], alpha: TERRITORY_ALPHA });
      }
    });
  }

  /** `widths[i]`: current width of edge `i` (1..5). */
  setRoadWidths(widths: readonly number[]): void {
    widths.forEach((width, i) => {
      const road = this.roads[i];
      if (road !== undefined) {
        road.scale.y = roadThickness(width);
      }
    });
  }

  /** Re-render the VP labels for the current zoom (see `labelResolution` in camera.ts). */
  setLabelResolution(resolution: number): void {
    for (const label of this.labels) {
      if (label.resolution !== resolution) {
        label.resolution = resolution;
      }
    }
  }

  destroy(): void {
    // Children first: they reference the shared contexts, which Graphics.destroy() leaves alone.
    for (const city of this.nodes) {
      city.destroy({ children: true });
    }
    for (const road of this.roads) {
      road.destroy();
    }
    this.territory.destroy();
    this.background.destroy();
    for (const context of this.shared) {
      context.destroy();
    }
    this.labelStyle.destroy();
  }

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.shared.push(context);
    return context;
  }

  private drawBackground(): Graphics {
    const { width, height } = this.map.meta;
    const g = new Graphics();
    this.map.nodes.forEach((node, i) => {
      const cell = this.cells[i];
      if (cell !== undefined && cell.length > 0) {
        g.poly(cell).fill(TERRAIN_FILL[node.terrain]).stroke(CELL_BORDER);
      }
    });
    return g.rect(0, 0, width, height).stroke(MAP_BORDER);
  }
}
