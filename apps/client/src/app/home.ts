/**
 * The way back to the main Play screen from the bar of an out-of-game screen (#945): the app puts a
 * getter in the context, the bar's brand reads it. It gives the action on the screens that may be
 * left for the main screen (the pages, the result, the replay) and `null` elsewhere (the main
 * screen itself, the boot, a locked bar): there the brand stays the same button and does nothing.
 */
export const HOME_KEY = Symbol('home');

export type HomeGetter = () => (() => void) | null;
