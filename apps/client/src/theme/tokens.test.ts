import { describe, expect, it } from 'vitest';
import {
  DURATION,
  EASE,
  ENGRAVED,
  FONT,
  LAPIS,
  LINE,
  RADIUS,
  easeEngrave,
  easeSettle,
  easeTravel,
} from './tokens.ts';

// #841: the CSS custom properties of app.css and the TS tokens carry the same values.
const sources = import.meta.glob<string>('../app.css', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const css = Object.values(sources)[0] ?? '';

/** The value of `--name` in the :root block of app.css, trimmed. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim() ?? '';
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('the colour tokens (Lapis and Engraved)', () => {
  it.each([
    ['stone-bg', LAPIS.bg],
    ['stone-panel', LAPIS.panel],
    ['stone-raised', LAPIS.raised],
    ['ink', LAPIS.ink],
    ['ink-soft', LAPIS.inkSoft],
    ['ink-dim', LAPIS.inkDim],
    ['rule', LAPIS.rule],
    ['line', LAPIS.line],
    ['cut', LAPIS.cut],
    ['frame-lozenge', LAPIS.lozenge],
    ['own-lapis', LAPIS.own],
    ['enemy-lapis', LAPIS.enemy],
    ['plate', ENGRAVED.plate],
    ['casing', ENGRAVED.casing],
    ['own', ENGRAVED.own],
    ['enemy', ENGRAVED.enemy],
    ['neutral', ENGRAVED.neutral],
    ['neutral-fill', ENGRAVED.neutralFill],
    ['segment-empty', ENGRAVED.segmentEmpty],
    ['vp', ENGRAVED.vp],
    ['warn', ENGRAVED.warn],
    ['badge-up', ENGRAVED.up],
    ['badge-down', ENGRAVED.down],
  ])('--%s in app.css equals the TS token', (name, value) => {
    expect(token(name).toLowerCase()).toBe(hex(value));
  });

  it('keeps one ink for both styles', () => {
    expect(ENGRAVED.ink).toBe(LAPIS.ink);
  });

  it('points the older names at the new tokens, so the screens not yet restyled follow them', () => {
    expect(token('bg')).toBe('var(--stone-bg)');
    expect(token('text')).toBe('var(--ink)');
    expect(token('text-dim')).toBe('var(--ink-dim)');
    expect(token('paper')).toBe('var(--ink)');
    expect(token('border')).toBe('var(--line)');
    expect(token('surface-2')).toBe('var(--stone-raised)');
    expect(token('you')).toBe('var(--own)');
  });
});

describe('the line, corner and type tokens', () => {
  it('match the TS tokens', () => {
    expect(token('line-hair')).toBe(`${String(LINE.hair)}px`);
    expect(token('line-casing')).toBe(`${String(LINE.casing)}px`);
    expect(token('frame-gap')).toBe(`${String(LINE.frameGap)}px`);
    expect(token('radius')).toBe(`${String(RADIUS)}px`);
    expect(token('font-display')).toBe(FONT.display);
    expect(token('font-text')).toBe(FONT.text);
  });

  it('sets the text font on the root', () => {
    expect(css).toMatch(/font-family: var\(--font-text\);/);
  });
});

describe('the motion tokens', () => {
  it.each(Object.entries(DURATION))('--t-%s matches DURATION', (key, ms) => {
    expect(token(`t-${kebab(key)}`)).toBe(`${String(ms)}ms`);
  });

  it.each(Object.entries(EASE))('--ease-%s matches EASE', (name, curve) => {
    expect(token(`ease-${name}`)).toBe(`cubic-bezier(${curve.join(', ')})`);
  });

  it('slows the CP moves of round 5 and the reveal to the owner’s 550 ms (ui-style 57)', () => {
    expect(DURATION.cpSpend).toBe(700);
    expect(DURATION.cpSliver).toBe(1000);
    expect(DURATION.cpIncome).toBe(800);
    expect(DURATION.cpRoll).toBe(500);
    expect(DURATION.cpFrameIn).toBe(700);
    expect(DURATION.cpFrameOut).toBe(400);
    expect(DURATION.revealIn).toBe(550);
    expect(EASE.engrave).toEqual([0.37, 0, 0.63, 1]);
  });

  it.each([
    ['engrave', easeEngrave],
    ['settle', easeSettle],
    ['travel', easeTravel],
  ] as const)('the JS twin of %s runs from 0 to 1 and clamps', (_name, ease) => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.25)).toBeLessThan(ease(0.75));
  });

  it('eases the sine in and out symmetrically', () => {
    expect(easeEngrave(0.5)).toBeCloseTo(0.5);
    expect(easeEngrave(0.25) + easeEngrave(0.75)).toBeCloseTo(1);
  });
});

describe('the fonts', () => {
  const files = Object.keys(import.meta.glob('./fonts/*'));
  const faces = [...css.matchAll(/url\('\.\/theme\/(fonts\/[^']+)'\)/g)].map(
    (m) => `./${m[1] ?? ''}`,
  );

  it('are self-hosted woff2 files, each face in app.css pointing at one', () => {
    expect(faces.sort()).toEqual([
      './fonts/cinzel.woff2',
      './fonts/ebgaramond-italic.woff2',
      './fonts/ebgaramond.woff2',
    ]);
    for (const face of faces) expect(files).toContain(face);
  });

  it('keep their SIL OFL licences beside them', () => {
    expect(files).toContain('./fonts/Cinzel-OFL.txt');
    expect(files).toContain('./fonts/EBGaramond-OFL.txt');
  });
});
