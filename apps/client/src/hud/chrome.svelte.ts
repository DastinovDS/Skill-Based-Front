/**
 * Which HUD overlay is open: the help (`?`) and the exit dialog. The plain booleans are the whole
 * state; `hud/hudKeys.ts` flips them from the keyboard. (The in-match menu and the event journal
 * are gone since UI round 2: the language is chosen before the game, "fit map" is `H`.)
 */

/** Two `Esc` presses within this many ms open the exit dialog (ui-style 10.4). */
export const DOUBLE_ESC_MS = 600;

export class HudChrome {
  settingsOpen = $state(false);
  /** The "leave the match?" dialog: leaving is a forfeit. */
  exitOpen = $state(false);

  /** When the last `Esc` that closed nothing was pressed (ms), for the double press. */
  lastEscape = -Infinity;

  /** A modal overlay is up: the game keys wait. */
  get modal(): boolean {
    return this.exitOpen || this.settingsOpen;
  }

  openExit(): void {
    this.exitOpen = true;
    this.settingsOpen = false;
  }

  closeAll(): void {
    this.exitOpen = false;
    this.settingsOpen = false;
  }
}
