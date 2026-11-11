import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DrawingGraph from './DrawingGraph.svelte';

// The sketch stops drawing once the map is ready (#945): the loop is cancelled when `still` turns on.
describe('DrawingGraph (#945)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    Reflect.deleteProperty(Element.prototype, 'animate');
  });

  it('cancels every running animation when it becomes still', () => {
    const made: number[] = [];
    const cancelled: number[] = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        const id = made.length;
        made.push(id);
        return {
          cancel: () => {
            cancelled.push(id);
          },
        };
      }),
    });
    const props = $state({ width: 120, still: false });
    component = mount(DrawingGraph, { target: document.body, props });
    flushSync();
    expect(made.length).toBeGreaterThan(10);
    expect(document.querySelector('.bu')).not.toBeNull();
    props.still = true;
    flushSync();
    expect(cancelled).toHaveLength(made.length);
    expect(document.querySelector('.bu')).toBeNull();
  });
});
