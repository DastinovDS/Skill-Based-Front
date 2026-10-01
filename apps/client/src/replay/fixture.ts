import { parseReplay, type ReplayFile } from './replayFile.ts';
import raw from './siege.frames.json';

/**
 * A short sample match on the `siege` test map (rusher against reactive, ruleset `test-short`,
 * 409 ticks, player 2 wins by capturing the capital), written by `gow_server.frames.build_frames`
 * and unzipped. It is a recording of the server's file, never edited by hand.
 */
export const SAMPLE_RAW: unknown = raw;
export const SAMPLE: ReplayFile = parseReplay(raw);
