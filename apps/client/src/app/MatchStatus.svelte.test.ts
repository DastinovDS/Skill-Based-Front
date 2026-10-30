import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchStatus from './MatchStatus.svelte';
import { statusView, type StatusInput } from './matchStatus.ts';

const READY: StatusInput = { status: 'ready', paused: null, me: 0, notice: null, pauseLeft: 0 };

describe('MatchStatus', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component !== null) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  function render(input: StatusInput, onaction = vi.fn()) {
    const view = statusView(input);
    if (view === null) throw new Error('no bar for this state');
    const target = document.body.appendChild(document.createElement('div'));
    component = mount(MatchStatus, { target, props: { view, onaction } });
    flushSync();
    return { target, onaction };
  }

  it('says a dead connection as an alert with the words, the icon and the keyed buttons', () => {
    const { target, onaction } = render({ ...READY, status: 'failed' });
    const bar = target.querySelector('[role="alert"]');
    expect(bar?.textContent).toContain('Could not reconnect');
    expect(bar?.querySelector('svg')).not.toBeNull();
    const buttons = [...target.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Try again ↵',
      'To the menu Esc',
    ]);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(onaction.mock.calls).toEqual([['retry'], ['menu']]);
  });

  it('is polite for a reconnect and shows no key on its menu button', () => {
    const { target } = render({ ...READY, status: 'reconnecting' });
    expect(target.querySelector('[role="status"]')?.textContent).toContain('Reconnecting');
    expect(target.querySelector('kbd')).toBeNull();
  });

  it('counts the pause in the line', () => {
    const paused = { type: 'paused', paused: true, by: 1, ends_in_s: 30 } as const;
    const { target } = render({ ...READY, paused, pauseLeft: 27 });
    expect(target.textContent).toContain('The opponent paused the match');
    expect(target.textContent).toContain('resumes by itself in 27 s');
    expect(target.querySelector('button')).toBeNull();
  });
});
