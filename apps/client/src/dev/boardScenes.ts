/**
 * The profile and the settings (#871, #919) as dev scenes (`/?menu=profile*`, `settings*`): the
 * real pages with a fake API, so `mise run shots` can show their states. The numbers are made up;
 * the shapes are those of `GET /api/players/{id}`.
 */
import {
  ApiError,
  type Api,
  type MatchEntry,
  type PlayerProfile,
  type RecordTally,
} from '../api/http.ts';

export const BOARD_SCENE_IDS = [
  'profile',
  'profile-guest',
  'profile-long',
  'profile-empty',
  'profile-loading',
  'profile-network',
  'settings',
  'settings-guest',
] as const;

export type BoardSceneId = (typeof BOARD_SCENE_IDS)[number];

export function isBoardScene(id: string | null): id is BoardSceneId {
  return BOARD_SCENE_IDS.some((known) => known === id);
}

/** The clock of the scenes. */
const BOARD_NOW = Date.parse('2026-10-29T12:00:00Z');

const ago = (minutes: number): string => new Date(BOARD_NOW - minutes * 60_000).toISOString();
const rec = (wins: number, losses: number, draws: number): RecordTally => ({
  wins,
  losses,
  draws,
});

/** The id of the own player. */
export const ME = 6;

const E = (nick: string, id: number | null = null): MatchEntry['opponent'] => ({
  player_id: id,
  nick,
  bot: false,
});
const BOT = (nick: string): MatchEntry['opponent'] => ({ player_id: null, nick, bot: true });

let nextId = 100;
function m(
  result: MatchEntry['result'],
  opponent: MatchEntry['opponent'],
  map: string,
  seconds: number,
  minutesAgo: number,
  replay: MatchEntry['replay']['state'],
): MatchEntry {
  nextId += 1;
  return {
    match_id: nextId,
    map_id: map,
    ended_at: ago(minutesAgo),
    ticks: seconds * 10,
    result,
    end_reason: 'timer',
    kind: opponent.bot ? 'bot' : 'casual',
    unrated_reason: null,
    opponent,
    rating_change: null,
    replay: { state: replay, url: replay === 'ready' ? `/api/replays/${String(nextId)}` : null },
  };
}

const mins = (min: number, sec: number): number => min * 60 + sec;

/** The mockup's seven rows: people and bots of every level, an expired replay. */
const MATCHES: MatchEntry[] = [
  m('win', E('Vega', 3), 'crossroads', mins(12, 4), 125, 'ready'),
  m('loss', BOT('reactive'), 'ridge', mins(8, 41), 300, 'ready'),
  m('draw', BOT('expander'), 'highway', mins(15, 0), 1500, 'expired'),
  m('win', E('Mira', 5), 'live-3f9a07c1d2e4', mins(10, 27), 1560, 'ready'),
  m('loss', BOT('rusher'), 'narrows', mins(6, 52), 2900, 'preparing'),
  m('win', E('Tomas', 2), 'highway', mins(13, 15), 3000, 'ready'),
  m('win', BOT('turtle'), 'crossroads', mins(9, 10), 3100, 'unavailable'),
];

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    player_id: ME,
    nick: 'Ember',
    has_password: true,
    rating: null,
    rank: null,
    calibration: null,
    rated_matches: 0,
    rated_record: rec(0, 0, 0),
    record: rec(12, 8, 1),
    matches: MATCHES,
    ...over,
  };
}

/** What a scene feeds the page: the account and the fake answer of the profile. */
export interface BoardScene {
  readonly hasPassword: boolean;
  readonly mode: 'profile' | 'settings';
  readonly own: () => Promise<PlayerProfile>;
}

/** The fake API of a scene: the two calls the profile makes. */
export function sceneApi(scene: BoardScene): Pick<Api, 'player' | 'me'> {
  return {
    me: () =>
      Promise.resolve({
        player_id: ME,
        nick: 'Ember',
        has_password: scene.hasPassword,
        colour: 'lapis',
      }),
    player: () => scene.own(),
  };
}

const now =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value);
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export const BOARD_SCENES: Readonly<Record<BoardSceneId, BoardScene>> = {
  profile: { hasPassword: true, mode: 'profile', own: now(profile()) },
  // A long history (#940): the list scrolls in its own box, the page does not.
  'profile-long': {
    hasPassword: true,
    mode: 'profile',
    own: now(
      profile({
        matches: [0, 1000, 2000].flatMap((shift) =>
          MATCHES.map((entry) => ({ ...entry, match_id: entry.match_id + shift })),
        ),
      }),
    ),
  },
  'profile-guest': {
    hasPassword: false,
    mode: 'profile',
    own: now(profile({ has_password: false, record: rec(2, 1, 1), matches: MATCHES.slice(0, 4) })),
  },
  'profile-empty': {
    hasPassword: false,
    mode: 'profile',
    own: now(profile({ has_password: false, record: rec(0, 0, 0), matches: [] })),
  },
  'profile-loading': { hasPassword: true, mode: 'profile', own: never },
  'profile-network': {
    hasPassword: true,
    mode: 'profile',
    own: () => Promise.reject(new ApiError('network', 0)),
  },
  settings: { hasPassword: true, mode: 'settings', own: now(profile()) },
  'settings-guest': { hasPassword: false, mode: 'settings', own: now(profile()) },
};
