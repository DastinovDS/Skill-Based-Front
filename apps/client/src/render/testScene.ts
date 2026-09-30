import { Container, Graphics } from 'pixi.js';

// Placeholder scene of the skeleton (INF-03): three cities and two roads around the origin.
// Replaced by the real map renderer once snapshots arrive from the server.
const NODES = [
  { x: -200, y: 60 },
  { x: 0, y: -80 },
  { x: 200, y: 60 },
] as const;
const ROADS = [
  [0, 1],
  [1, 2],
] as const;

const NODE_RADIUS = 28;
const ROAD_STYLE = { width: 8, color: 0x7d8590 } as const;
const NODE_FILL = 0x2f6fde;
const NODE_OUTLINE = { width: 4, color: 0xe6edf3 } as const;

export function createTestScene(): Container {
  const roads = new Graphics();
  for (const [from, to] of ROADS) {
    roads.moveTo(NODES[from].x, NODES[from].y).lineTo(NODES[to].x, NODES[to].y);
  }
  roads.stroke(ROAD_STYLE);

  const nodes = new Graphics();
  for (const node of NODES) {
    nodes.circle(node.x, node.y, NODE_RADIUS).fill(NODE_FILL).stroke(NODE_OUTLINE);
  }

  // Layer order from AGENTS.md §7.2: roads below nodes.
  const scene = new Container();
  scene.addChild(roads, nodes);
  return scene;
}
