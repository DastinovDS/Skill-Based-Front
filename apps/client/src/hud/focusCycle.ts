/**
 * Moves the focus to the next (Shift: previous) enabled button or input inside the dialog the key
 * event belongs to, wrapping round: Tab never leaves a modal dialog. The caller prevents the default.
 */
export function cycleFocus(event: KeyboardEvent): void {
  const root = event.currentTarget;
  if (!(root instanceof HTMLElement)) return;
  const order = [
    ...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  ];
  if (order.length === 0) return;
  const at = order.findIndex((e) => e === document.activeElement);
  const next = (at + (event.shiftKey ? order.length - 1 : 1)) % order.length;
  order[next]?.focus();
}
