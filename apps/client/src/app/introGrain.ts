/**
 * Intro B "Grain" (#826, ui-style 56): the letters of the title drawn on a canvas inside the title
 * and revealed pixel by pixel against a noise field, so the density builds up (clumps of the stone
 * first, then the grain fills in) until the letter is solid. The port of the mockup's `fogState`
 * and `drawFogTitle` (`docs/design/mockups/out-of-game-style-r3.html`), for the B kind only.
 *
 * The canvas is a plain 2D canvas (no PixiJS outside `src/render/`); its size and place are set
 * through the CSSOM (CSP: no inline style attributes).
 */

/** The canvas reaches this far (CSS px of the title) above and below the title: the cut lips. */
const PAD = 6;
/** The softness of the threshold: how wide the band of half-revealed pixels is. */
const SOFT = 0.16;

/** A small deterministic random (mulberry32): the grain is the same on every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth fractal noise of `w` x `h` cells of 1 px, tiling in x, normalised to 0..1. */
function fbm(w: number, h: number, cell: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let size = cell;
  for (let o = 0; o < octaves; o++) {
    const cw = Math.max(2, Math.round(w / size));
    const ch = Math.max(2, Math.round(h / size) + 1);
    const random = rng(seed + o * 101);
    const lattice = new Float32Array(cw * ch);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const at = (x: number, y: number): number => lattice[y * cw + x] ?? 0;
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * (ch - 1);
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const y1 = Math.min(ch - 1, y0 + 1);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cw;
        const x0 = Math.floor(fx) % cw;
        const tx = fx - Math.floor(fx);
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cw;
        const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * sx;
        out[y * w + x] = (out[y * w + x] ?? 0) + (a + (b - a) * sy) * amp;
      }
    }
    amp *= 0.5;
    size /= 2;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  for (let i = 0; i < out.length; i++) out[i] = ((out[i] ?? 0) - lo) / span;
  return out;
}

/** One letter of the title: its character and its box, in CSS px from the title's top left. */
interface Glyph {
  readonly char: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/**
 * The letters of the title as laid out (spaces skipped), measured with a range per character, so
 * the title keeps its own markup and kerning. `title` must not be transformed while measured.
 */
function measureGlyphs(title: HTMLElement): Glyph[] {
  const box = title.getBoundingClientRect();
  const glyphs: Glyph[] = [];
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      if (char.trim() === '') continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      glyphs.push({ char, left: r.left - box.left, top: r.top - box.top, width: r.width });
    }
  }
  return glyphs;
}

export interface Grain {
  /** How many letters the title has (the length of `progress`). */
  readonly count: number;
  /** Draws the letters at their progress (0..1 each, in the order of the glyphs). */
  draw(progress: readonly number[]): void;
}

/**
 * Builds the grain of `title` on `canvas` (a child of the title): `zoom` is the scale the title is
 * shown at while its letters form, so the backing store stays sharp. Null without a 2D canvas.
 */
export function buildGrain(
  title: HTMLElement,
  canvas: HTMLCanvasElement,
  zoom: number,
): Grain | null {
  let g: CanvasRenderingContext2D | null;
  try {
    g = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    g = null;
  }
  if (g === null) return null;
  const ctx = g;
  const glyphs = measureGlyphs(title);
  const style = getComputedStyle(title);
  const width = title.offsetWidth;
  const height = title.offsetHeight + PAD * 2;
  const k = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * zoom));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${String(width)}px`;
  canvas.style.height = `${String(height)}px`;
  canvas.style.top = `${String(-PAD)}px`;

  // The title as the screen sets it: the ivory letter with the round 2 cut (a dark lip above, a
  // lit one below), drawn once; the frames then only change the alpha of its pixels.
  const size = parseFloat(style.fontSize);
  ctx.font = `${style.fontWeight} ${String(size * k)}px ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  const ascent = ctx.measureText(glyphs[0]?.char ?? 'M').fontBoundingBoxAscent / k;
  // The title's own colour is hidden while the grain draws it: the ink token is the colour.
  const ink = style.getPropertyValue('--ink').trim() || '#ece4d1';
  for (const [dy, colour] of [
    [-1, '#000'],
    [2, 'rgba(236, 228, 209, 0.12)'],
    [0, ink],
  ] as const) {
    ctx.fillStyle = colour;
    for (const glyph of glyphs) {
      ctx.fillText(glyph.char, glyph.left * k, (glyph.top + ascent + PAD + dy) * k);
    }
  }
  // Each column of pixels belongs to the nearest letter (by the centre of its ink).
  const spacing = parseFloat(style.letterSpacing) || 0;
  const centres = glyphs.map((glyph) => (glyph.left + (glyph.width - spacing) / 2) * k);
  const column = new Int16Array(w);
  for (let x = 0; x < w; x++) {
    let best = 0;
    centres.forEach((c, i) => {
      if (Math.abs(c - x) < Math.abs((centres[best] ?? 0) - x)) best = i;
    });
    column[x] = best;
  }
  const source = ctx.getImageData(0, 0, w, h);
  const data = source.data;
  const inked: number[] = [];
  for (let i = 0; i < w * h; i++) if ((data[i * 4 + 3] ?? 0) > 0) inked.push(i);
  const pixels = Uint32Array.from(inked);
  // The threshold of each inked pixel: clumps of the stone (in screen px at `zoom`, as the mockup
  // set them on its artboard) and a per-pixel grain.
  const fw = Math.ceil(width * zoom);
  const fh = Math.ceil(height * zoom);
  const clumps = fbm(fw, fh, 26, 3, 41);
  const random = rng(5);
  const threshold = new Float32Array(pixels.length);
  const owner = new Int16Array(pixels.length);
  pixels.forEach((i, j) => {
    const x = Math.min(fw - 1, Math.floor(((i % w) / k) * zoom));
    const y = Math.min(fh - 1, Math.floor((Math.floor(i / w) / k) * zoom));
    threshold[j] = 0.6 * (clumps[y * fw + x] ?? 0) + 0.4 * random();
    owner[j] = column[i % w] ?? 0;
  });
  const frame = new ImageData(new Uint8ClampedArray(data), w, h);
  const out = frame.data;

  return {
    count: glyphs.length,
    draw(progress: readonly number[]): void {
      for (let j = 0; j < pixels.length; j++) {
        const i = pixels[j] ?? 0;
        const p = progress[owner[j] ?? 0] ?? 1;
        let a: number;
        if (p <= 0) a = 0;
        else if (p >= 1) a = 1;
        else {
          const v = (p * (1 + SOFT) - (threshold[j] ?? 0)) / SOFT;
          a = v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
        }
        out[i * 4 + 3] = (data[i * 4 + 3] ?? 0) * a;
      }
      ctx.putImageData(frame, 0, 0);
    },
  };
}
