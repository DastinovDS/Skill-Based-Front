/**
 * The one behaviour of a modal dialog (ARC-C07, #482), as a Svelte action: `<div use:modal={{ onclose }}>`.
 *
 * While the element is mounted:
 *  - the focus moves into it (unless a control inside already has it) and goes back to the element
 *    that had it when the modal closes;
 *  - Tab stays inside: at the last control it wraps to the first, and Shift+Tab the other way; a
 *    focus that sits outside (a click on the dimmed backdrop) is pulled back in;
 *  - Escape closes the topmost modal (`onclose`), or does nothing when it has no `onclose` (a
 *    dialog that is busy); either way no screen behind it sees the key;
 *  - every other key (not the function keys) stops here too, so the screen keys behind a modal do
 *    not fire, unless `passKeys` says the owner of the modal routes its keys itself (the match HUD).
 *
 * Several modals stack: only the one opened last reacts. A control inside that handles a key itself
 * (the key capture of Settings) and stops it keeps it: the action sees only what bubbles up to the
 * document.
 */

export interface ModalOptions {
  /** Escape closes the modal through this; without it the key is swallowed and nothing closes. */
  onclose?: (() => void) | undefined;
  /** Let the keys other than Escape and Tab reach the page behind (the match HUD routes them). */
  passKeys?: boolean;
}

interface Entry {
  readonly node: HTMLElement;
  options: ModalOptions;
}

const stack: Entry[] = [];

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Whether any modal is open (a screen that must stay quiet under one can ask). */
export function modalOpen(): boolean {
  return stack.length > 0;
}

/** The controls of a modal in tab order, without the disabled and the hidden ones. */
function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !element.matches(':disabled') &&
      element.closest('[hidden], [inert]') === null &&
      !(element instanceof HTMLInputElement && element.type === 'hidden'),
  );
}

/** The function keys (a mark of a problem, the help) keep working under a modal. */
function isFunctionKey(event: KeyboardEvent): boolean {
  return /^F\d{1,2}$/.test(event.key);
}

function top(): Entry | undefined {
  return stack[stack.length - 1];
}

/** Escape and Tab of the topmost modal; `true` when the event was dealt with. */
function steer(entry: Entry, event: KeyboardEvent): boolean {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return true;
    entry.options.onclose?.();
    return true;
  }
  if (event.key === 'Tab') {
    const order = focusables(entry.node);
    const first = order[0];
    const last = order[order.length - 1];
    const active = document.activeElement;
    if (first === undefined || last === undefined) {
      event.preventDefault();
      entry.node.focus();
    } else if (!(active instanceof Node) || !entry.node.contains(active) || active === entry.node) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
    return true;
  }
  return false;
}

// Two listeners serve all modals. Svelte delegates `onkeydown` handlers to the mount root and the
// document, so the keys of the controls inside a modal must be seen only after them: the inner
// handlers (the key capture of Settings) run first and may stop the key, and the page behind, whose
// handlers sit on the window, is shut off last, at the document in the bubble phase. A key whose
// target is outside the topmost modal (the focus is on the page behind it) is dealt with at once, on
// the window in the capture phase.
function steerOrShut(event: KeyboardEvent): void {
  const entry = top();
  if (entry === undefined) return;
  if (steer(entry, event)) return;
  if (entry.options.passKeys !== true && !isFunctionKey(event)) event.stopPropagation();
}

function onWindowKey(event: KeyboardEvent): void {
  const entry = top();
  const target = event.target;
  if (entry !== undefined && target instanceof Node && entry.node.contains(target)) return;
  steerOrShut(event);
}

function onDocumentKey(event: KeyboardEvent): void {
  const entry = top();
  const target = event.target;
  if (entry === undefined || !(target instanceof Node) || !entry.node.contains(target)) return;
  steerOrShut(event);
}

export function modal(
  node: HTMLElement,
  options: ModalOptions = {},
): { update: (next: ModalOptions) => void; destroy: () => void } {
  const entry: Entry = { node, options };
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (stack.length === 0) {
    window.addEventListener('keydown', onWindowKey, true);
    document.addEventListener('keydown', onDocumentKey);
  }
  stack.push(entry);

  // The focus goes in; a control that takes it later (a safe answer) simply overrides this.
  if (!node.contains(document.activeElement)) {
    if (!node.hasAttribute('tabindex')) node.tabIndex = -1;
    node.focus();
  }

  return {
    update(next) {
      entry.options = next;
    },
    destroy() {
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) {
        window.removeEventListener('keydown', onWindowKey, true);
        document.removeEventListener('keydown', onDocumentKey);
      }
      // Back to the opener, unless the focus was already moved on to something else outside.
      const active = document.activeElement;
      const lost = active === null || active === document.body || node.contains(active);
      if (lost && opener?.isConnected === true) opener.focus();
    },
  };
}
