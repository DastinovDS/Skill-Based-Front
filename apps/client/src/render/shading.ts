import { lighten } from './fightFx.ts';
import { SHADE, SHADOW } from './style.ts';

/** A colour moved `amount` (0..1) of the way to black. */
export function darken(color: number, amount: number): number {
  const channel = (shift: number): number =>
    Math.round(((color >> shift) & 0xff) * (1 - amount)) & 0xff;
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** The two ends of the fill gradient of a shape of `color` (BL1 "Restrained"): top, bottom. */
export function shadeEnds(color: number): { readonly top: number; readonly bottom: number } {
  return { top: lighten(color, SHADE.light), bottom: darken(color, SHADE.dark) };
}

/**
 * Where a baked sprite's box lies around its shape: the shape's box `{x, y, width, height}` grown
 * by `margin` on every side and `SHADOW.dy` more at the bottom (the shadow falls down).
 */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function shadowBox(shape: Box, margin: number): Box {
  return {
    x: shape.x - margin,
    y: shape.y - margin,
    width: shape.width + 2 * margin,
    height: shape.height + 2 * margin + SHADOW.dy,
  };
}

/** The box of a circle of `radius` around the origin. */
export function circleBox(radius: number): Box {
  return { x: -radius, y: -radius, width: 2 * radius, height: 2 * radius };
}
