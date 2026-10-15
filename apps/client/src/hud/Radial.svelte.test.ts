import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Radial from './Radial.svelte';
import { setReducedMotion } from '../render/motion.ts';
import { spreadAngles, type RadialItem } from './radial.ts';

const angles = spreadAngles(3);
const items: RadialItem[] = [
  { id: 'a', angle: angles[0] ?? 270, label: 'Alpha', key: '1' },
  { id: 'b', angle: angles[1] ?? 30, label: 'Beta', key: '2', disabled: true },
  { id: 'c', angle: angles[2] ?? 150, label: 'Gamma', key: '3', current: true },
];

describe('Radial', () => {
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    document.body.innerHTML = '';
  });

  function render(extra: Record<string, unknown> = {}) {
    const calls = {
      hover: vi.fn(),
      choose: vi.fn(),
      close: vi.fn(),
    };
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(Radial, {
      target,
      props: {
        items,
        label: 'Menu',
        at: { x: 400, y: 300 },
        hover: null,
        onhover: calls.hover,
        onchoose: calls.choose,
        onclose: calls.close,
        closeLabel: 'Close',
        ...extra,
      },
    });
    flushSync();
    return { target, calls };
  }

  it('draws every sector with its name and key, and marks the current one', () => {
    const { target } = render();
    const sectors = [...target.querySelectorAll('.sector')];
    expect(sectors).toHaveLength(3);
    expect(sectors[0]?.textContent).toContain('Alpha');
    expect(sectors[0]?.textContent).toContain('1');
    expect(sectors[2]?.getAttribute('aria-checked')).toBe('true');
    expect(sectors[2]?.textContent).toContain('✓');
    expect(sectors[1]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('lights the sector under the pointer by angle, and not a disabled one', () => {
    const { calls } = render();
    // Straight up from the middle (400, 300): the first sector.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 220 }));
    expect(calls.hover).toHaveBeenLastCalledWith('a');
    // Down right (the angle of 30 degrees) is the disabled one: nothing lights (the owner keeps
    // `hover` null here, so no call is made at all).
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 470, clientY: 340 }));
    expect(calls.hover).toHaveBeenCalledTimes(1);
  });

  it('lights nothing in the dead zone or far outside the ring', () => {
    const { calls } = render();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 402, clientY: 302 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: -400 }));
    expect(calls.hover).not.toHaveBeenCalledWith('a');
  });

  it('shows the hover the owner keeps', () => {
    const { target } = render({ hover: 'c' });
    expect(target.querySelector('.sector.hover')?.textContent).toContain('Gamma');
  });

  it('chooses a clicked sector, but not a disabled one', () => {
    const { target, calls } = render();
    const sectors = target.querySelectorAll<SVGGElement>('.sector');
    sectors[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.choose).not.toHaveBeenCalled();
    sectors[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.choose).toHaveBeenCalledWith('a');
  });

  it('has no click-away area unless modal; a modal one closes, or picks the sector of the click', () => {
    expect(render().target.querySelector('.backdrop')).toBeNull();
    document.body.innerHTML = '';
    const { target, calls } = render({ modal: true });
    const backdrop = target.querySelector<HTMLButtonElement>('.backdrop');
    expect(backdrop).not.toBeNull();
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(calls.close).toHaveBeenCalledOnce();
    // A click in a gap of the ring, still on the first sector's side: that sector is chosen.
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 230 }));
    expect(calls.choose).toHaveBeenCalledWith('a');
  });

  it('follows a moving anchor and closes when the thing is gone', async () => {
    let spot: { x: number; y: number } | null = { x: 100, y: 100 };
    vi.useFakeTimers();
    try {
      const { target, calls } = render({ at: () => spot, clamp: false });
      const box = target.querySelector<HTMLElement>('.radial');
      const first = box?.style.left;
      spot = { x: 300, y: 100 };
      await vi.advanceTimersByTimeAsync(50);
      expect(box?.style.left).not.toBe(first);
      spot = null;
      await vi.advanceTimersByTimeAsync(50);
      expect(calls.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a plain disc with its content in the middle when it has no sectors', () => {
    const { target } = render({ items: [], disc: 100 });
    expect(target.querySelector('circle.disc')).not.toBeNull();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('grows from the centre of the ring, and not at all with less motion', () => {
    const { target } = render();
    const box = target.querySelector<HTMLElement>('.radial');
    expect(box?.classList.contains('grow')).toBe(true);
    // The origin of the growth is the middle of the ring inside the box.
    expect(box?.style.transformOrigin).toMatch(/^\d+(\.\d+)?px \d+(\.\d+)?px$/);
    void unmount(mounted ?? {});
    mounted = undefined;
    document.body.innerHTML = '';
    setReducedMotion(true);
    try {
      const { target: still } = render();
      expect(still.querySelector('.radial')?.classList.contains('grow')).toBe(false);
    } finally {
      setReducedMotion(null);
    }
  });
});
