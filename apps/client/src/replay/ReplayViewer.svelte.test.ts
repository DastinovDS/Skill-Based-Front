import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { SAMPLE } from './fixture.ts';
import ReplayViewer from './ReplayViewer.svelte';

// PixiJS needs WebGL; the map is covered by GameCanvas tests and the visual job.
vi.mock('../render/GameCanvas.svelte', () => ({ default: () => undefined }));

let viewer: Record<string, unknown> | undefined;

afterEach(() => {
  if (viewer !== undefined) void unmount(viewer);
  viewer = undefined;
  setLocale('en');
  document.body.innerHTML = '';
});

function open(onback?: () => void): HTMLElement {
  setLocale('en');
  const target = document.body.appendChild(document.createElement('div'));
  viewer = mount(ReplayViewer, { target, props: { file: SAMPLE, onback } });
  flushSync();
  return target;
}

const button = (root: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
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

  it('speaks Russian', () => {
    setLocale('ru');
    const target = document.body.appendChild(document.createElement('div'));
    viewer = mount(ReplayViewer, { target, props: { file: SAMPLE } });
    flushSync();
    expect(button(target, 'Играть')).toBeTruthy();
  });
});
