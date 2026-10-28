/**
 * Where the place names of the map (#449) sit and when they show. Pure geometry and rules, no
 * PixiJS and no DOM. The names are the map's own (`MapNodeFile.name`, DEC-23, item 4): nothing is
 * decided here, the client only draws them.
 *
 * A caption is drawn at a constant size on screen (`fontSize` CSS px, never below the 12 px
 * minimum of ui-style 22) under the signs of its place, so it keeps its size at every zoom, and it
 * hides when the map is zoomed out so far that the captions would crowd each other.
 */
import type { NodeKind } from '../protocol.gen.ts';
import { barTop, ringRadius } from './cityLayout.ts';
import { BAR_SEGMENT, PROVINCE } from './style.ts';

/** A city or capital, or a province: a province gets the lighter caption and hides first. */
export type CaptionKind = 'city' | 'province';

/** The smallest caption on screen, CSS px (ui-style 22, "Minimum size"). */
export const CAPTION_MIN_PX = 12;

export const CAPTION = {
  /** Size and weight on screen: a province is smaller and lighter than a city. */
  city: { fontSize: 13, weight: '700', alpha: 1, minScale: 0.45 },
  province: { fontSize: 12, weight: '500', alpha: 0.78, minScale: 0.7 },
  /** Air between the signs of a place and the caption, screen px. */
  gapPx: 2,
  /** The dark outline that keeps the text readable on roads and terrain, screen px. */
  strokePx: 3,
} as const;

export function captionKind(kind: NodeKind): CaptionKind {
  return kind === 'province' ? 'province' : 'city';
}

/**
 * Does the caption of a place of `kind` show at camera scale `scale` (CSS px per world unit)? The
 * zoom threshold is per kind: a province, the smaller and the more numerous, hides first.
 */
export function captionVisible(kind: CaptionKind, scale: number): boolean {
  return scale >= CAPTION[kind].minScale;
}

/**
 * Where the top of the caption is below the centre of the place, world units: under the warehouse
 * bar of a city (the bar is there whether it is filled in or not, so the caption does not jump
 * when a city comes into sight) and under the ring of a province.
 */
export function captionTop(kind: CaptionKind, radius: number): number {
  if (kind === 'province') return ringRadius(PROVINCE.radius) + 4;
  return barTop(radius) + BAR_SEGMENT.height + 2;
}

/** The scale of a caption container that keeps its text at the size on screen. */
export function captionScale(scale: number): number {
  return scale > 0 ? 1 / scale : 1;
}
