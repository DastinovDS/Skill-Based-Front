import type { Point } from './camera.ts';

/** One subpath of a "Cut" icon: its corners in order, and whether it closes back on the first. */
export interface CutSubpath {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/**
 * The corners of an SVG path of the straight commands the barracks and factory icons use
 * (`M`, `L`, `H`, `V`, `Z`, absolute): `theme/cutIcons.ts` draws them in the menus, the map draws
 * the same art from the same strings (#954). Anything else is a mistake of the caller.
 */
export function parseCut(d: string): CutSubpath[] {
  const tokens = d.match(/[MLHVZ]|-?\d*\.?\d+/g) ?? [];
  const out: { points: Point[]; closed: boolean }[] = [];
  let current: { points: Point[]; closed: boolean } | null = null;
  let at: Point = { x: 0, y: 0 };
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const to = (p: Point): void => {
    at = p;
    current?.points.push(p);
  };
  while (i < tokens.length) {
    const cmd = tokens[i++] ?? '';
    if (cmd === 'M') {
      current = { points: [], closed: false };
      out.push(current);
      to({ x: num(), y: num() });
    } else if (cmd === 'L') to({ x: num(), y: num() });
    else if (cmd === 'H') to({ x: num(), y: at.y });
    else if (cmd === 'V') to({ x: at.x, y: num() });
    else if (cmd === 'Z') {
      if (current !== null) current.closed = true;
    } else throw new Error(`parseCut: unsupported command ${cmd}`);
  }
  return out;
}

/** The corners of the first subpath of a closed solid (the ruled part of an icon). */
export function solidCorners(d: string): Point[] {
  return [...(parseCut(d)[0]?.points ?? [])];
}

/** The box round some corners. */
export function cornerBounds(points: readonly Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
