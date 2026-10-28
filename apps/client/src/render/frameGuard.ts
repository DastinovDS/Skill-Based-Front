/**
 * Keeps the map alive when one frame throws (CLI-03, #418). PixiJS 8 asks for the next animation
 * frame only after the ticker listeners have returned, so a listener that throws ends the loop for
 * good and the canvas freezes under a HUD that goes on. The guard runs the frame inside a
 * `try/catch`: a failed frame is skipped (the loop lives), the first failure is logged once, and
 * `limit` failed frames in a row call `onFailure` once (the screen tells the player and offers a
 * reload). A frame that succeeds starts the count over, so a transient error is not an alarm.
 */
export class FrameGuard {
  #failures = 0;
  #logged = false;
  #reported = false;

  constructor(
    private readonly limit: number,
    private readonly onFailure: (error: unknown) => void,
    private readonly log: (error: unknown) => void = (error) => {
      console.error('map frame failed', error);
    },
  ) {}

  /** Runs one frame; never throws. */
  run(frame: () => void): void {
    try {
      frame();
      this.#failures = 0;
    } catch (error) {
      this.#failures += 1;
      if (!this.#logged) {
        this.#logged = true;
        this.log(error);
      }
      if (this.#failures >= this.limit && !this.#reported) {
        this.#reported = true;
        this.onFailure(error);
      }
    }
  }
}
