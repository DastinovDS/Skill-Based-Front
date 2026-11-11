import type { OrderController } from './orderController.ts';

const TEXT_INPUTS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/**
 * Hands a keyboard event of the page to the order controller; returns true if the key was taken
 * (the caller then calls `preventDefault`). Typing in a text field is left alone.
 */
export function forwardKey(orders: OrderController, event: KeyboardEvent): boolean {
  // The release of the planned order key (`E` unless rebound, #966) always reaches the controller,
  // in a text field and with a modifier too: a held E (DEC-48, item K2) must never outlive its key.
  if (event.type === 'keyup' && event.code === orders.keys.planned) {
    orders.key({ type: 'keyup', code: event.code, shiftKey: event.shiftKey });
    return false;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    TEXT_INPUTS.has(target.tagName) &&
    !(
      target instanceof HTMLInputElement &&
      (target.type === 'checkbox' || target.type === 'range')
    );
  if (typing) {
    return false;
  }
  return orders.key({
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
    code: event.code,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
  });
}
