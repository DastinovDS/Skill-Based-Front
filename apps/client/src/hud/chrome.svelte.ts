/**
 * Which HUD overlay is open: the menu (☰), the journal, the help (`?`) and the exit dialog. The
 * plain booleans are the whole state; `hud/hudKeys.ts` flips them from the keyboard.
 */

/** Two `Esc` presses within this many ms open the exit dialog (ui-style 10.4). */
export const DOUBLE_ESC_MS = 600;

export class HudChrome {
  menuOpen = $state(false);
  journalOpen = $state(false);
  helpOpen = $state(false);
  /** The "leave the match?" dialog: leaving is a forfeit. */
  exitOpen = $state(false);

  /** When the last `Esc` that closed nothing was pressed (ms), for the double press. */
  lastEscape = -Infinity;

  /** A modal overlay is up: the game keys wait. */
  get modal(): boolean {
    return this.exitOpen || this.helpOpen || this.menuOpen;
  }

  openExit(): void {
    this.exitOpen = true;
    this.helpOpen = false;
    this.menuOpen = false;
  }

  closeAll(): void {
    this.exitOpen = false;
    this.helpOpen = false;
    this.menuOpen = false;
    this.journalOpen = false;
  }
}
