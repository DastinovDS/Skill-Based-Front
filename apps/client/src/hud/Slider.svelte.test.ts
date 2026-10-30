import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Slider from './Slider.svelte';

describe('Slider', () => {
  let mounted: Record<string, unknown> | undefined;
  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    document.body.innerHTML = '';
  });

  function render(props: Partial<{ value: number; min: number; max: number }> = {}) {
    const oninput = vi.fn();
    const onchange = vi.fn();
    mounted = mount(Slider, {
      target: document.body,
      props: { value: 3, min: 1, max: 5, label: 'Amount', oninput, onchange, ...props },
    });
    flushSync();
    const input = document.querySelector<HTMLInputElement>('input');
    if (input === null) throw new Error('no slider');
    return { oninput, onchange, input };
  }

  it('is a labelled range with the values it was given', () => {
    const { input } = render();
    expect(input.type).toBe('range');
    expect(input.getAttribute('aria-label')).toBe('Amount');
    expect([input.min, input.max, input.value]).toEqual(['1', '5', '3']);
  });

  it('draws the fill from the share of the range', () => {
    const { input } = render({ value: 3 });
    expect(input.style.getPropertyValue('--p')).toBe('0.5');
    if (mounted !== undefined) void unmount(mounted);
    document.body.innerHTML = '';
    const flat = render({ value: 2, min: 2, max: 2 });
    expect(flat.input.style.getPropertyValue('--p')).toBe('0');
  });

  it('reports every step on input and the release on change', () => {
    const { input, oninput, onchange } = render();
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(oninput).toHaveBeenCalledWith(4);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onchange).toHaveBeenCalledWith(4, input);
  });
});
