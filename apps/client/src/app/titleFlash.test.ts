import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flashTitle } from './titleFlash.ts';

function fakeDocument(visibility: 'hidden' | 'visible') {
  const events = new EventTarget();
  const doc = {
    title: 'Game',
    visibilityState: visibility,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  return {
    doc: doc as unknown as Document,
    show: (next: 'hidden' | 'visible') => {
      doc.visibilityState = next;
      events.dispatchEvent(new Event('visibilitychange'));
    },
    title: () => doc.title,
  };
}

describe('flashTitle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('swaps the message and the title every period while the tab is hidden', () => {
    const page = fakeDocument('hidden');
    const stop = flashTitle('Found!', page.doc, 1000);
    expect(page.title()).toBe('Found!');
    vi.advanceTimersByTime(1000);
    expect(page.title()).toBe('Game');
    vi.advanceTimersByTime(1000);
    expect(page.title()).toBe('Found!');
    stop();
    expect(page.title()).toBe('Game');
    vi.advanceTimersByTime(5000);
    expect(page.title()).toBe('Game');
  });

  it('leaves the title of a visible tab alone, and starts when the tab is hidden', () => {
    const page = fakeDocument('visible');
    const stop = flashTitle('Found!', page.doc, 1000);
    vi.advanceTimersByTime(3000);
    expect(page.title()).toBe('Game');
    page.show('hidden');
    expect(page.title()).toBe('Found!');
    stop();
  });

  it('puts the title back when the player comes back to the tab', () => {
    const page = fakeDocument('hidden');
    const stop = flashTitle('Found!', page.doc, 1000);
    vi.advanceTimersByTime(2000);
    page.show('visible');
    expect(page.title()).toBe('Game');
    vi.advanceTimersByTime(5000);
    expect(page.title()).toBe('Game');
    // Hidden again: flashing again.
    page.show('hidden');
    expect(page.title()).toBe('Found!');
    stop();
    expect(page.title()).toBe('Game');
  });

  it('stops listening after stop()', () => {
    const page = fakeDocument('visible');
    const stop = flashTitle('Found!', page.doc, 1000);
    stop();
    page.show('hidden');
    expect(page.title()).toBe('Game');
  });
});
