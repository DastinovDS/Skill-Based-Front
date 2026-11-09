/**
 * Plays the opening scene (`introScene.ts`) on the entry screen's own elements: the title (its
 * grain canvas, the rule, the rise), the entries of the form, the dark stage over the map and the
 * Skip button. Everything is set through the CSSOM (CSP: no inline style attributes) and taken
 * back at the end, so the screen ends exactly in its still, final frame.
 */
import { buildGrain, type Grain } from './introGrain.ts';
import { introFrame, letterTimes, type IntroFrame } from './introScene.ts';

export interface IntroParts {
  /** The screen: it carries `data-intro` (loading, playing, frozen) for the tests and shots. */
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** The dark stage over the map. */
  readonly cover: HTMLElement;
  readonly skip: HTMLElement | null;
  /** The entries of the form that come in one after another (each a list of elements). */
  readonly steps: readonly (readonly HTMLElement[])[];
}

export interface IntroOptions {
  /** Draw this moment (seconds) and stay there (the dev scene); otherwise play from 0. */
  readonly at?: number | null;
  /** The scene is over (played to the end, skipped, or it could not run). */
  readonly onend: () => void;
}

/** The title is shown this much larger while its letters form (the mockup: 112 px to 67 px). */
const ZOOM = 112 / 67;
/** The middle of the title stands this far down the window while its letters form (the mockup). */
const START_Y = 0.475;
/** Waiting longer than this for the fonts plays the scene in whatever font is there. */
const FONT_WAIT_MS = 2500;
/** An entry of the form takes clicks once it is this far in. */
const LIVE_FROM = 0.6;

function waitForFonts(title: HTMLElement): Promise<unknown> {
  const fonts = (document as Partial<Document>).fonts;
  if (fonts === undefined) return Promise.resolve();
  const style = getComputedStyle(title);
  const load = fonts
    .load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
    .catch(() => undefined);
  return Promise.race([load, new Promise((done) => setTimeout(done, FONT_WAIT_MS))]);
}

/** Starts the scene; returns the function that stops it (and is safe to call twice). */
export function runIntro(parts: IntroParts, options: IntroOptions): () => void {
  const { root, title, canvas, cover, skip, steps } = parts;
  const frozen = options.at !== undefined && options.at !== null;
  let stopped = false;
  let handle = 0;
  let grain: Grain | null = null;
  let times: readonly (readonly [number, number])[] = [];
  let zoom = 1;
  let rise = 0;

  root.dataset['intro'] = 'loading';

  const apply = (frame: IntroFrame): void => {
    title.classList.toggle('solid', !frame.grain);
    canvas.hidden = !frame.grain;
    if (frame.grain) grain?.draw(frame.letters);
    title.style.setProperty('--sp', frame.rule.toFixed(3));
    const left = 1 - frame.move;
    title.style.transform = `translateY(${(rise * left).toFixed(2)}px) scale(${(1 + (zoom - 1) * left).toFixed(4)})`;
    steps.forEach((elements, j) => {
      const q = frame.menu[j] ?? 1;
      for (const element of elements) {
        element.style.setProperty('--q', q.toFixed(3));
        element.inert = q < LIVE_FROM;
      }
    });
    cover.style.opacity = frame.cover.toFixed(3);
    skip?.classList.toggle('shown', frame.skip);
  };

  const release = (): void => {
    cancelAnimationFrame(handle);
    window.removeEventListener('keydown', finish, true);
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('resize', finish);
    skip?.removeEventListener('click', finish);
    title.classList.remove('solid');
    title.style.removeProperty('--sp');
    title.style.removeProperty('transform');
    for (const elements of steps) {
      for (const element of elements) {
        element.style.removeProperty('--q');
        element.inert = false;
      }
    }
    delete root.dataset['intro'];
  };

  function finish(): void {
    if (stopped) return;
    stopped = true;
    release();
    options.onend();
  }

  // Before the fonts: the dark stage, nothing on it.
  if (!frozen) {
    window.addEventListener('keydown', finish, true);
    window.addEventListener('pointerdown', finish, true);
    // Assistive technology may click without a pointer or a key.
    skip?.addEventListener('click', finish);
  }
  steps.forEach((elements) => {
    for (const element of elements) element.inert = true;
  });

  void waitForFonts(title).then(() => {
    if (stopped) return;
    // Measured in the final place, untransformed: the rise starts from the middle of the window.
    const box = title.getBoundingClientRect();
    zoom = Math.max(1, Math.min(ZOOM, (window.innerWidth * 0.92) / Math.max(1, box.width)));
    rise = Math.max(0, window.innerHeight * START_Y - (zoom * box.height) / 2 - box.top);
    try {
      grain = buildGrain(title, canvas, zoom);
    } catch {
      grain = null;
    }
    if (grain === null) {
      // No 2D canvas (or no layout to measure): the still screen at once.
      finish();
      return;
    }
    times = letterTimes(grain.count);
    if (frozen) {
      apply(introFrame(times, options.at ?? 0));
      root.dataset['intro'] = 'frozen';
      return;
    }
    root.dataset['intro'] = 'playing';
    // A new window size would need a new layout of the scene: show the still screen instead.
    window.addEventListener('resize', finish);
    const start = performance.now();
    const tick = (now: number): void => {
      if (stopped) return;
      const frame = introFrame(times, (now - start) / 1000);
      apply(frame);
      if (frame.done) {
        finish();
        return;
      }
      handle = requestAnimationFrame(tick);
    };
    apply(introFrame(times, 0));
    handle = requestAnimationFrame(tick);
  });

  return () => {
    if (stopped) return;
    stopped = true;
    release();
  };
}
