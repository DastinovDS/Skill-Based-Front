import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CP_MARK, svgPoints } from './cpMark.ts';
import CpMark from './CpMark.svelte';
import LapisButton from './LapisButton.svelte';
import RuleFrame from './RuleFrame.svelte';
import SectionLabel from './SectionLabel.svelte';
import StoneOverlay from './StoneOverlay.svelte';

// The primitives of the style foundation (#841).
const text = (words: string) => createRawSnippet(() => ({ render: () => `<span>${words}</span>` }));

let mounted: Record<string, unknown>[] = [];

function show(component: unknown, props: Record<string, unknown>): HTMLElement {
  const target = document.body.appendChild(document.createElement('div'));
  mounted.push(mount(component as Parameters<typeof mount>[0], { target, props }));
  flushSync();
  return target;
}

afterEach(() => {
  for (const m of mounted) void unmount(m);
  mounted = [];
  document.body.innerHTML = '';
});

describe('the CP mark', () => {
  it('is a standard, not the charge lozenge: several parts, upright, not symmetric top to bottom', () => {
    expect(CP_MARK.shapes.length).toBeGreaterThan(1);
    const ys = CP_MARK.shapes.flatMap((s) => s.filter((_, i) => i % 2 === 1));
    const xs = CP_MARK.shapes.flatMap((s) => s.filter((_, i) => i % 2 === 0));
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    // the banner hangs in the upper part, the pole alone reaches the ground
    const banner = CP_MARK.shapes[3] ?? [];
    const bannerYs = banner.filter((_, i) => i % 2 === 1);
    expect(Math.max(...bannerYs)).toBeLessThanOrEqual(bottom - 3);
    expect(bottom - top).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
    // it fits its box with room for the casing
    const { x, y, width, height } = CP_MARK.box;
    expect(Math.min(...xs) - CP_MARK.casing.width / 2).toBeGreaterThanOrEqual(x);
    expect(top - CP_MARK.casing.width / 2).toBeGreaterThanOrEqual(y);
    expect(Math.max(...xs) + CP_MARK.casing.width / 2).toBeLessThanOrEqual(x + width);
    expect(bottom + CP_MARK.casing.width / 2).toBeLessThanOrEqual(y + height);
  });

  it('draws every part twice, the casing under the ink, at the asked size', () => {
    const svg = show(CpMark, { size: 12 }).querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('12');
    const polygons = svg?.querySelectorAll('polygon') ?? [];
    expect(polygons).toHaveLength(CP_MARK.shapes.length * 2);
    expect(polygons[0]?.getAttribute('points')).toBe(svgPoints(CP_MARK.shapes[0] ?? []));
  });

  it('is decorative unless it is given a name', () => {
    const quiet = show(CpMark, {}).querySelector('svg');
    expect(quiet?.getAttribute('aria-hidden')).toBe('true');
    expect(quiet?.getAttribute('role')).toBeNull();
    const named = show(CpMark, { label: 'CP' }).querySelector('svg');
    expect(named?.getAttribute('role')).toBe('img');
    expect(named?.getAttribute('aria-label')).toBe('CP');
    expect(named?.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('the Lapis button', () => {
  it('is a secondary button of the middle size by default, never a submit', () => {
    const button = show(LapisButton, { children: text('Back') }).querySelector('button');
    expect(button?.className).toContain('lapis-btn');
    expect(button?.className).toContain('secondary');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent).toBe('Back');
  });

  it('takes the variant, the size, danger and the native attributes', () => {
    const onclick = vi.fn();
    const button = show(LapisButton, {
      variant: 'primary',
      size: 'lg',
      onclick,
      'aria-label': 'Play now',
      children: text('Play'),
    }).querySelector('button');
    expect(button?.classList.contains('primary')).toBe(true);
    expect(button?.classList.contains('lg')).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('Play now');
    button?.click();
    expect(onclick).toHaveBeenCalledOnce();
    const danger = show(LapisButton, { danger: true, children: text('Leave') }).querySelector(
      'button',
    );
    expect(danger?.classList.contains('danger')).toBe(true);
  });
});

describe('the frame and the label', () => {
  it('frames a stone panel in the element asked for', () => {
    const frame = show(RuleFrame, { as: 'section', class: 'extra', children: text('x') });
    const element = frame.querySelector('section');
    expect(element?.className).toContain('rule-frame');
    expect(element?.className).toContain('stone-panel');
    expect(element?.className).toContain('extra');
    const bare = show(RuleFrame, { stone: false, children: text('x') }).querySelector('div');
    expect(bare?.className).not.toContain('stone-panel');
  });

  it('is a heading in cut capitals with its rule, or without it', () => {
    const head = show(SectionLabel, { children: text('Matches') }).querySelector('h3');
    expect(head?.className).toContain('lapis-label');
    expect(head?.className).toContain('lapis-section');
    const plain = show(SectionLabel, { as: 'p', rule: false, children: text('Player') });
    expect(plain.querySelector('p')?.className).not.toContain('lapis-section');
  });
});

describe('the stone overlay', () => {
  it('opens a framed window that is a dialog and takes the focus', () => {
    const host = show(StoneOverlay, { label: 'Leave the match?', children: text('body') });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Leave the match?');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.className).toContain('rule-frame');
    expect(document.activeElement).toBe(dialog);
  });

  it('lays a sheet on the stone without a window', () => {
    const host = show(StoneOverlay, { label: 'Replays', kind: 'sheet', children: text('list') });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('Replays');
    expect(host.querySelector('.stone-overlay')).not.toBeNull();
  });

  it('closes on Escape only when it has a handler', () => {
    const onclose = vi.fn();
    show(StoneOverlay, { label: 'x', onclose, children: text('body') });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onclose).toHaveBeenCalledOnce();
  });
});
