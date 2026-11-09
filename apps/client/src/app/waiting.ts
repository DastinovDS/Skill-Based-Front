/**
 * The wait for a map made for one match (#884): the server makes it in a few seconds (2.5 to 11 s,
 * rarely 20 s or more) and gives up after `GOW_MAPGEN_WAIT_S` (60 s), playing a pool map instead.
 */

/** After this long the waiting line says a large map takes longer, so the screen does not look stuck. */
export const DRAWING_SLOW_MS = 15_000;

/**
 * A bot match request that has not answered by then is given up: the server answers within its
 * own 60 s with a map in any case, so this is only a network or proxy that hangs.
 */
export const BOT_START_TIMEOUT_MS = 90_000;
