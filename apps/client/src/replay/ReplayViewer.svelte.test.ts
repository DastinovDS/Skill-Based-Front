import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { SAMPLE, SAMPLE_FOG } from './fixture.ts';
import ReplayViewer from './ReplayViewer.svelte';

// jsdom has no ResizeObserver (`bind:clientHeight` of the bars uses it).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

// PixiJS needs WebGL; the map is covered by GameCanvas tests and the visual job.
// It keeps the source the viewer hands over, so a test can run the render loop's `frame()` call.
let drawn: { frame: () => unknown } | undefined;
// The viewing player the map is drawn for (a getter: the props are reactive).
let blue: () => number = () => -1;
vi.mock('../render/GameCanvas.svelte', () => ({
  default: (_anchor: unknown, props: { source: { frame: () => unknown }; player?: number }) => {
    drawn = props.source;
    blue = () => props.player ?? 0;
    return {
      setInsets: () => undefined,
    };
  },
}));

let viewer: Record<string, unknown> | undefined;

afterEach(() => {
  if (viewer !== undefined) void unmount(viewer);
  viewer = undefined;
  setLocale('en');
  document.body.innerHTML = '';
});

function open(onback?: () => void, extra: Record<string, unknown> = {}): HTMLElement {
  setLocale('en');
  const target = document.body.appendChild(document.createElement('div'));
  viewer = mount(ReplayViewer, { target, props: { file: SAMPLE, onback, ...extra } });
  flushSync();
  return target;
}

// A button is found by its accessible name: the label, else its text.
const button = (root: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find(
    (b) =>
      (b.getAttribute('aria-label') ?? b.firstChild?.textContent ?? b.textContent).trim() ===
        text ||
      b.textContent.replace(b.querySelector('kbd')?.textContent ?? '', '').trim() === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
};

describe('ReplayViewer controls', () => {
  it('toggles play and pause', () => {
    const root = open();
    button(root, 'Play').click();
    flushSync();
    expect(button(root, 'Pause')).toBeTruthy();
    button(root, 'Pause').click();
    flushSync();
    expect(button(root, 'Play')).toBeTruthy();
  });

  it('Pause on a replay that ended since the last sync does not restart it (#476)', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const root = open();
    button(root, '×16').click();
    button(root, 'Play').click();
    flushSync();
    expect(button(root, 'Pause')).toBeTruthy();
    // The match ends and the render loop notices (`frame()` moves the clock), while the controls
    // still show "Pause": they sync ten times a second, the loop draws every frame.
    now += 60_000;
    drawn?.frame();
    button(root, 'Pause').click();
    flushSync();
    expect(button(root, 'Play')).toBeTruthy();
    expect(root.textContent).toContain('0:40 / 0:40');
    vi.restoreAllMocks();
  });

  it('offers x1, x4 and x16, one pressed', () => {
    const root = open();
    expect(button(root, '×1').getAttribute('aria-pressed')).toBe('true');
    button(root, '×16').click();
    flushSync();
    expect(button(root, '×16').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, '×1').getAttribute('aria-pressed')).toBe('false');
    expect(button(root, '×4')).toBeTruthy();
  });

  it('seeks with the slider over the whole match', () => {
    const root = open();
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.max).toBe(String(SAMPLE.ticks));
    if (slider === null) throw new Error('no slider');
    slider.value = '300';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(slider.value).toBe('300');
    expect(root.textContent).toContain('0:30 / 0:40');
  });

  it('shows the result at the end, and a back button only when asked', () => {
    const back = vi.fn();
    const root = open(back);
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider === null) throw new Error('no slider');
    slider.value = String(SAMPLE.ticks);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(root.textContent).toContain('Player 2 won');
    button(root, 'Back').click();
    expect(back).toHaveBeenCalledOnce();
  });
});

describe('ReplayViewer keys', () => {
  const key = (code: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      code,
      key: code,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    flushSync();
    return event;
  };

  it('Esc goes back, but only where there is a screen to go back to', () => {
    const back = vi.fn();
    open(back);
    key('Escape');
    expect(back).toHaveBeenCalledOnce();
    void unmount(viewer as Record<string, unknown>);
    viewer = undefined;
    document.body.innerHTML = '';
    open();
    expect(key('Escape').defaultPrevented).toBe(false);
  });

  it('has no key hints and no other keys', () => {
    const root = open(vi.fn());
    expect(root.querySelector('kbd')).toBeNull();
    expect(root.querySelector('[aria-keyshortcuts]')).toBeNull();
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    for (const code of ['Space', 'ArrowRight', 'Digit3', 'KeyF', 'Home']) {
      expect(key(code).defaultPrevented).toBe(false);
    }
    expect(slider?.value).toBe('0');
    expect(button(root, 'Play')).toBeTruthy();
    expect(button(root, '×1').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ReplayViewer "View as" (#599)', () => {
  const pressed = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.view .seg button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent.trim());

  it('offers Player 1, Player 2 and Both, starting with both: player 1 blue', () => {
    const root = open();
    expect(
      [...root.querySelectorAll('.view .seg button')].map((b) => b.textContent.trim()),
    ).toEqual(['Player 1', 'Player 2', 'Both']);
    expect(pressed(root)).toEqual(['Both']);
    expect(blue()).toBe(0);
    expect(root.querySelector('.side .nick')?.textContent).toBe('Player 1');
  });

  it('makes the chosen side blue and puts it on the left, without a reload', () => {
    const root = open();
    button(root, 'Player 2').click();
    flushSync();
    expect(pressed(root)).toEqual(['Player 2']);
    expect(blue()).toBe(1);
    expect(root.querySelector('.side .nick')?.textContent).toBe('Player 2');
    button(root, 'Both').click();
    flushSync();
    expect(blue()).toBe(0);
  });

  it('opens as the given side and names the sides by nick', () => {
    const nicks: [string, string] = ['Danya', 'Guest-7'];
    const root = open(undefined, { file: { ...SAMPLE, nicks }, initialView: 1 });
    expect(pressed(root)).toEqual(['Guest-7']);
    expect(blue()).toBe(1);
    expect(root.querySelector('.score')?.getAttribute('aria-label')).toBe('Guest-7 0, Danya 0');
  });

  it('shows who won by nick at the end', () => {
    const nicks: [string, string] = ['Danya', 'Guest-7'];
    const root = open(undefined, { file: { ...SAMPLE, nicks } });
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider === null) throw new Error('no slider');
    slider.value = String(SAMPLE.ticks);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(root.querySelector('.result')?.textContent).toContain('Guest-7 won');
  });
});

describe('ReplayViewer fog of a side (#600)', () => {
  const fogButton = (root: HTMLElement): HTMLButtonElement => {
    const found = root.querySelector<HTMLButtonElement>('.view button.fog');
    if (found === null) throw new Error('no fog button');
    expect(found.textContent.trim()).toBe('Fog');
    return found;
  };
  const groupsDrawn = (): number =>
    (drawn?.frame() as { groups: { owner?: number }[] }).groups.filter((g) => g.owner === 1).length;

  it('shows a side with its fog by default, the button turns it off, Both has none', () => {
    const root = open(undefined, { file: SAMPLE_FOG, initialView: 0 });
    const fog = fogButton(root);
    expect(fog.getAttribute('aria-pressed')).toBe('true');
    expect(fog.getAttribute('aria-disabled')).toBe('false');
    fog.click();
    flushSync();
    expect(fog.getAttribute('aria-pressed')).toBe('false');
    fog.click();
    flushSync();
    expect(fog.getAttribute('aria-pressed')).toBe('true');
    button(root, 'Both').click();
    flushSync();
    expect(fog.getAttribute('aria-pressed')).toBe('false');
    expect(fog.getAttribute('aria-disabled')).toBe('true');
    expect(fog.title).toBe('Pick a player to see their fog of war');
  });

  it('draws only what the side saw while the fog is on', () => {
    const root = open(undefined, { file: SAMPLE_FOG, initialView: 0 });
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider === null) throw new Error('no slider');
    slider.value = '300';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(groupsDrawn()).toBe(0);
    fogButton(root).click();
    flushSync();
    expect(groupsDrawn()).toBeGreaterThan(0);
  });

  it('a file without what the players saw: the fog is unavailable, with the reason', () => {
    const root = open(undefined, { initialView: 1 });
    const fog = fogButton(root);
    expect(fog.getAttribute('aria-pressed')).toBe('false');
    expect(fog.getAttribute('aria-disabled')).toBe('true');
    expect(fog.title).toBe('This replay does not record what each player saw');
    const reason = document.getElementById(fog.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('This replay does not record what each player saw');
    fog.click();
    flushSync();
    expect(fog.getAttribute('aria-pressed')).toBe('false');
  });
});
