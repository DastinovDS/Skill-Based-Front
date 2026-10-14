/**
 * The last place of the pointer on the page, for a menu that opens under it. One listener for the
 * whole page, installed on first use; the menus read it once when they open.
 */
export interface PointerAt {
  readonly x: number;
  readonly y: number;
  /** A pointer event was seen at all; before that the menus open in the middle of the window. */
  readonly seen: boolean;
}

let last: PointerAt = { x: 0, y: 0, seen: false };
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'pointermove',
    (event) => {
      last = { x: event.clientX, y: event.clientY, seen: true };
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      last = { x: event.clientX, y: event.clientY, seen: true };
    },
    { capture: true, passive: true },
  );
}

install();

/** The pointer now, or the middle of the window before it was ever seen. */
export function pointerAt(): { x: number; y: number } {
  install();
  return last.seen
    ? { x: last.x, y: last.y }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
