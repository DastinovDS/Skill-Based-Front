import { afterEach, describe, expect, it, vi } from 'vitest';
import { modal, modalOpen, type ModalOptions } from './modal.ts';

interface Open {
  root: HTMLElement;
  close: () => void;
}

/** A modal with two buttons, mounted the way a component's `use:modal` does. */
function open(options: ModalOptions = {}): Open {
  const root = document.createElement('div');
  root.innerHTML = '<button id="a">A</button><button id="b">B</button>';
  document.body.append(root);
  const handle = modal(root, options);
  return {
    root,
    close: () => {
      handle.destroy();
      root.remove();
    },
  };
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('modal', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    while (closers.length > 0) closers.pop()?.();
    document.body.innerHTML = '';
  });
  const mount = (options: ModalOptions = {}): Open => {
    const made = open(options);
    closers.push(made.close);
    return made;
  };

  it('moves the focus in and gives it back to the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const m = mount();
    expect(document.activeElement).toBe(m.root);
    m.close();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves a control that already has the focus alone', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button id="a">A</button>';
    document.body.append(root);
    root.querySelector('button')?.focus();
    const handle = modal(root);
    expect(document.activeElement).toBe(root.querySelector('button'));
    handle.destroy();
  });

  it('closes on Escape and keeps the key from the page behind', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const onclose = vi.fn();
    const m = mount({ onclose });
    const event = press(m.root.querySelector('#a') as HTMLElement, 'Escape');
    expect(onclose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener('keydown', behind);
  });

  it('swallows Escape without closing when there is no onclose', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const m = mount();
    press(m.root.querySelector('#a') as HTMLElement, 'Escape');
    expect(behind).not.toHaveBeenCalled();
    expect(modalOpen()).toBe(true);
    window.removeEventListener('keydown', behind);
  });

  it('closes on Escape while the focus is on the page behind, too', () => {
    const onclose = vi.fn();
    mount({ onclose });
    press(document.body, 'Escape');
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('keeps the screen keys from firing under it, but not the function keys', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const m = mount();
    press(m.root.querySelector('#a') as HTMLElement, 'Enter');
    press(document.body, 'm');
    expect(behind).not.toHaveBeenCalled();
    press(m.root.querySelector('#a') as HTMLElement, 'F8');
    expect(behind).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', behind);
  });

  it('lets the other keys through when the owner routes them (passKeys)', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const m = mount({ passKeys: true });
    press(m.root.querySelector('#a') as HTMLElement, 'm');
    expect(behind).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', behind);
  });

  it('wraps Tab at the ends and pulls a lost focus back in', () => {
    const m = mount();
    const a = m.root.querySelector<HTMLElement>('#a');
    const b = m.root.querySelector<HTMLElement>('#b');
    b?.focus();
    expect(press(b as HTMLElement, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    expect(press(a as HTMLElement, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    // In the middle the browser moves on by itself.
    a?.focus();
    expect(press(a as HTMLElement, 'Tab').defaultPrevented).toBe(false);
    (document.activeElement as HTMLElement).blur();
    press(document.body, 'Tab');
    expect(document.activeElement).toBe(a);
  });

  it('skips a disabled button when wrapping', () => {
    const m = mount();
    const b = m.root.querySelector<HTMLButtonElement>('#b');
    const a = m.root.querySelector<HTMLElement>('#a');
    if (b !== null) b.disabled = true;
    a?.focus();
    press(a as HTMLElement, 'Tab');
    expect(document.activeElement).toBe(a);
  });

  it('only the topmost of stacked modals reacts, and the one below is back after it closes', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    mount({ onclose: lower });
    const top = mount({ onclose: upper });
    press(top.root.querySelector('#a') as HTMLElement, 'Escape');
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
    top.close();
    press(document.body, 'Escape');
    expect(lower).toHaveBeenCalledOnce();
  });

  it('removes its key listener when the last modal closes', () => {
    const m = mount();
    m.close();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    press(document.body, 'Enter');
    expect(behind).toHaveBeenCalledOnce();
    expect(modalOpen()).toBe(false);
    window.removeEventListener('keydown', behind);
  });

  it('takes new options on update', () => {
    const first = vi.fn();
    const second = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    const handle = modal(root, { onclose: first });
    handle.update({ onclose: second });
    press(root, 'Escape');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    handle.destroy();
  });
});
