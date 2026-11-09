import {
  type Container,
  earcut,
  Geometry,
  Mesh,
  Shader,
  type Texture,
  UniformGroup,
} from 'pixi.js';
import type { Point } from './camera.ts';
import { REACH_SAMPLES, type FloodLook } from './captureLayout.ts';
import { CAPTURE, CASING, INK } from './style.ts';

/** A colour as the three floats of a GLSL `vec3`. */
const glsl = (color: number): string =>
  [16, 8, 0].map((shift) => (((color >> shift) & 255) / 255).toFixed(4)).join(', ');
const CASING_RGB = glsl(CASING);
const INK_RGB = glsl(INK);

/**
 * The flood of a capture on the map (#819, "Fitted", ui-style 49): per captured area three meshes of
 * its outline, each drawn by a small shader that works out the field of the area per pixel (the
 * outline scaled from the city, `captureLayout.ts`) and how far the front has come:
 *
 * - the fill: the old owner's tint under the front, the new one inside it, mixed (not stacked);
 * - the glow (its area and its neighbours): the cached border glow before the capture and after it,
 *   mixed the same way, so the glow joins where the front reaches the border; the map's own glow is
 *   masked out there meanwhile (`MapView`);
 * - the rim: the front engraved (#856): a hairline of the new owner's colour on a dark casing, and a
 *   fainter ink line just behind it, over the border lines.
 *
 * No filter, nothing redrawn per frame: the outlines are triangulated once per capture and only a
 * few uniforms change. The meshes are made and freed with the capture.
 */

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
}
`;

/** The field of the area at `vPos` (`fitAt` of `captureLayout.ts`) and the share of the new look there. */
const FIELD = `#version 300 es
precision highp float;
in vec2 vPos;
out vec4 finalColor;
uniform vec4 uColor;
uniform vec2 uCentre;
uniform vec4 uReach[${String(REACH_SAMPLES / 4)}];
uniform float uPos;
uniform float uFeather;
uniform float uClean;
const float TAU = 6.283185307179586;
float reachAt(int i) {
  int k = i % ${String(REACH_SAMPLES)};
  return uReach[k / 4][k % 4];
}
float fitHere() {
  vec2 d = vPos - uCentre;
  float r = length(d);
  if (r < 1e-3) return 0.0;
  float a = atan(d.y, d.x);
  if (a < 0.0) a += TAU;
  float at = a / TAU * ${String(REACH_SAMPLES)}.0;
  float i0 = floor(at);
  float reach = mix(reachAt(int(i0)), reachAt(int(i0) + 1), at - i0);
  return r / max(1.0, reach);
}
float front(float fit) {
  return smoothstep(0.0, 1.0, clamp((uPos - fit) / uFeather, 0.0, 1.0));
}
`;

const FILL = `${FIELD}
uniform vec4 uFrom;
uniform vec4 uTo;
void main() {
  float m = max(front(fitHere()), uClean);
  finalColor = mix(uFrom, uTo, m) * uColor.a;
}
`;

const GLOW = `${FIELD}
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uWorld;
void main() {
  vec2 uv = vPos / uWorld;
  float m = max(front(fitHere()), uClean);
  finalColor = mix(texture(uBefore, uv), texture(uAfter, uv), m) * uColor.a;
}
`;

const RIM = `${FIELD}
uniform vec3 uRimColor;
uniform float uRim;
// The front, Engraved (#856; mockup \`drawFloodFront\`): a hairline of the new owner's colour on a dark
// casing where the front stands (the middle of its soft edge), and a fainter ink line just behind it.
// The widths are in screen pixels: \`fwidth\` of the field is how much it changes over one pixel.
float rule(float fit, float at, float halfWidth) {
  float px = abs(fit - at) / max(fwidth(fit), 1e-6);
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, px);
}
void main() {
  float fit = fitHere();
  float front = uPos - uFeather * 0.5;
  float c = rule(fit, front, ${(CAPTURE.rim.line / 2).toFixed(3)}) * uRim;
  float k = rule(fit, front, ${(CAPTURE.rim.line / 2 + CAPTURE.rim.casing).toFixed(3)}) * uRim;
  float i = rule(fit, front - ${CAPTURE.rim.behind.toFixed(3)}, ${(CAPTURE.rim.ink / 2).toFixed(3)}) * uRim * ${CAPTURE.rim.inkAlpha.toFixed(3)};
  vec4 casing = vec4(${CASING_RGB}, 1.0) * k * ${CAPTURE.rim.casingAlpha.toFixed(3)};
  vec4 ink = vec4(${INK_RGB}, 1.0) * i;
  vec4 colour = vec4(uRimColor, 1.0) * c;
  vec4 under = ink + casing * (1.0 - ink.a);
  finalColor = (colour + under * (1.0 - colour.a)) * uColor.a;
}
`;

/** A tint as a premultiplied colour: `[r·a, g·a, b·a, a]`; `null` (no owner) is transparent. */
export function premultiplied(color: number | null, alpha: number): Float32Array {
  if (color === null) return new Float32Array([0, 0, 0, 0]);
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  return new Float32Array([r * alpha, g * alpha, b * alpha, alpha]);
}

/** The triangles of some outlines, as one mesh geometry (each outline on its own, by ear clipping). */
export function outlineGeometry(outlines: readonly (readonly Point[])[]): Geometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const outline of outlines) {
    if (outline.length < 3) continue;
    const flat = outline.flatMap((p) => [p.x, p.y]);
    const base = positions.length / 2;
    for (const i of earcut(flat)) indices.push(base + i);
    positions.push(...flat);
  }
  // Only the positions: the shaders take no texture coordinates.
  return new Geometry({
    attributes: { aPosition: new Float32Array(positions) },
    indexBuffer: new Uint32Array(indices),
  });
}

export interface FloodSpec {
  readonly centre: Point;
  /** The outline of the captured area. */
  readonly cell: readonly Point[];
  /** The outlines whose glow the flood redraws (its own area first, then the neighbours it has). */
  readonly glowCells: readonly (readonly Point[])[];
  /** `radialReach` of the area round the city. */
  readonly reach: Float32Array;
  /** The tint before and after, premultiplied (`premultiplied`). */
  readonly from: Float32Array;
  readonly to: Float32Array;
  /** The new owner's colour (the rim). */
  readonly color: number;
}

/** The glow of the map before the first capture under way and after the last (world-sized textures). */
export interface GlowPair {
  readonly before: Texture;
  readonly after: Texture;
}

interface Flood {
  readonly fill: Mesh<Geometry, Shader>;
  readonly rim: Mesh<Geometry, Shader>;
  glow: Mesh<Geometry, Shader> | null;
  /** The uniforms of the field, shared by the three shaders of the flood. */
  readonly field: UniformGroup;
  readonly rimLook: UniformGroup;
  readonly spec: FloodSpec;
}

const rgb = (color: number): Float32Array =>
  new Float32Array([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255]);

/** Frees a mesh of a flood with what it owns: its shader and (unless shared) its geometry. */
function dropMesh(mesh: Mesh<Geometry, Shader>, geometry: boolean): void {
  const shader = mesh.shader;
  const owned = mesh.geometry;
  mesh.destroy();
  shader?.destroy();
  if (geometry) owned.destroy();
}

export class FloodView {
  private readonly floods = new Map<number, Flood>();
  private glowPair: GlowPair | null = null;

  constructor(
    private readonly layers: {
      readonly fill: Container;
      readonly glow: Container;
      readonly rim: Container;
    },
    private readonly world: { readonly width: number; readonly height: number },
  ) {}

  /** The floods drawn now, by node. */
  get nodes(): readonly number[] {
    return [...this.floods.keys()];
  }

  /** Starts drawing the flood of `node` (a flood already there is replaced). */
  add(node: number, spec: FloodSpec): void {
    this.remove(node);
    const field = new UniformGroup({
      uCentre: { value: new Float32Array([spec.centre.x, spec.centre.y]), type: 'vec2<f32>' },
      uReach: { value: spec.reach, type: 'vec4<f32>', size: REACH_SAMPLES / 4 },
      uPos: { value: -1, type: 'f32' },
      uFeather: { value: CAPTURE.feather, type: 'f32' },
      uClean: { value: 0, type: 'f32' },
    });
    const rimLook = new UniformGroup({
      uRimColor: { value: rgb(spec.color), type: 'vec3<f32>' },
      uRim: { value: 0, type: 'f32' },
    });
    const cellGeometry = outlineGeometry([spec.cell]);
    const fill = new Mesh({
      label: 'flood-fill',
      geometry: cellGeometry,
      shader: Shader.from({
        gl: { vertex: VERTEX, fragment: FILL, name: 'flood-fill' },
        resources: {
          field,
          look: {
            uFrom: { value: spec.from, type: 'vec4<f32>' },
            uTo: { value: spec.to, type: 'vec4<f32>' },
          },
        },
      }),
    });
    const rim = new Mesh({
      label: 'flood-rim',
      geometry: cellGeometry,
      shader: Shader.from({
        gl: { vertex: VERTEX, fragment: RIM, name: 'flood-rim' },
        resources: { field, look: rimLook },
      }),
    });
    this.layers.fill.addChild(fill);
    this.layers.rim.addChild(rim);
    const flood: Flood = { fill, rim, glow: null, field, rimLook, spec };
    this.floods.set(node, flood);
    this.attachGlow(flood);
  }

  /**
   * The glow before and after (`null`: none can be made, the glow switches at once). A new pair
   * replaces the textures of every flood's glow; the caller frees the old pair.
   */
  setGlow(pair: GlowPair | null): void {
    this.glowPair = pair;
    for (const flood of this.floods.values()) {
      if (flood.glow !== null) {
        dropMesh(flood.glow, true);
        flood.glow = null;
      }
      this.attachGlow(flood);
    }
  }

  private attachGlow(flood: Flood): void {
    const pair = this.glowPair;
    if (pair === null || flood.spec.glowCells.length === 0) return;
    flood.glow = this.layers.glow.addChild(
      new Mesh({
        label: 'flood-glow',
        geometry: outlineGeometry(flood.spec.glowCells),
        shader: Shader.from({
          gl: { vertex: VERTEX, fragment: GLOW, name: 'flood-glow' },
          resources: {
            field: flood.field,
            look: {
              uWorld: {
                value: new Float32Array([this.world.width, this.world.height]),
                type: 'vec2<f32>',
              },
            },
            uBefore: pair.before.source,
            uAfter: pair.after.source,
          },
        }),
      }),
    );
  }

  /** Moves the flood of `node` to `look`. */
  update(node: number, look: FloodLook): void {
    const flood = this.floods.get(node);
    if (flood === undefined) return;
    const field = flood.field.uniforms as Record<string, number>;
    field['uPos'] = look.pos;
    field['uFeather'] = look.feather;
    field['uClean'] = look.clean;
    (flood.rimLook.uniforms as Record<string, number>)['uRim'] = look.rim;
  }

  remove(node: number): void {
    const flood = this.floods.get(node);
    if (flood === undefined) return;
    this.floods.delete(node);
    // The fill and the rim share the geometry: it goes with the fill.
    dropMesh(flood.rim, false);
    dropMesh(flood.fill, true);
    if (flood.glow !== null) dropMesh(flood.glow, true);
  }

  destroy(): void {
    for (const node of [...this.floods.keys()]) this.remove(node);
    this.glowPair = null;
  }
}
