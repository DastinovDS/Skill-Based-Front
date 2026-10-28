import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CrashGuard from './CrashGuard.svelte';

describe('CrashGuard', () => {
  let component: ReturnType<typeof mount> | null = null;
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (component !== null) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function render(props: { broken: boolean; onexit?: () => void; onreload?: () => void }) {
    const target = document.body.appendChild(document.createElement('div'));
    const children = createRawSnippet(() => ({
      render: () => {
        if (props.broken) throw new Error('the screen broke');
        return '<p>the screen is fine</p>';
      },
    }));
    component = mount(CrashGuard, {
      target,
      props: { children, onexit: props.onexit, onreload: props.onreload },
    });
    flushSync();
    return target;
  }

  it('shows the screen while it works', () => {
    const target = render({ broken: false });
    expect(target.textContent).toContain('screen is fine');
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a notice with Reload and To the menu when the screen throws, and logs it', () => {
    const onreload = vi.fn();
    const onexit = vi.fn();
    const target = render({ broken: true, onreload, onexit });
    expect(target.textContent).not.toContain('screen is fine');
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Something went wrong');
    const buttons = [...target.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Reload', 'To the menu']);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(onreload).toHaveBeenCalledOnce();
    expect(onexit).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalled();
  });

  it('offers only Reload without an exit', () => {
    const target = render({ broken: true });
    expect([...target.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Reload']);
  });
});
