import { parseReplay, type ReplayFile } from './replayFile.ts';
import raw from './siege.frames.json';
import rawFights from './siege-fights.frames.json';
import rawFog from './siege-fog.frames.json';

/**
 * A short sample match on the `siege` test map (rusher against reactive, ruleset `test-short`,
 * 409 ticks, player 2 wins by capturing the capital), written by `gow_server.frames.build_frames`
 * and unzipped. It is a recording of the server's file, never edited by hand.
 */
export const SAMPLE_RAW: unknown = raw;
export const SAMPLE: ReplayFile = parseReplay(raw);

/**
 * A recording with fights, written the same way (rusher against rusher, seed 0, `test-short`, 464
 * ticks): fights with round data (#323) from tick 385 on. Also the dev sample `?replay=dev-fights`.
 */
export const SAMPLE_FIGHTS: ReplayFile = parseReplay(rawFights);

/**
 * A recording with what each player saw (the frame key `v` of #598) and the header `nicks`
 * (rusher against reactive, seed 1, `test-short` on `siege`, 600 ticks, player 1 wins on VP, fights
 * from tick 275), recorded at the current `SIM_VERSION` by `gow_server.frames.FramesRecorder` and
 * unzipped. Also the dev sample `?replay=dev-fog` (#600). The two samples above predate #598: they
 * are the files without the key.
 */
export const SAMPLE_FOG: ReplayFile = parseReplay(rawFog);
