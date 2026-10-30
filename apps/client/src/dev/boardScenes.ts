/**
 * The Leaderboard and Replays tabs (#78, #629) as dev scenes (`/?menu=board-*`, `replays*`): the
 * real screens with a fake API and a frozen clock, so `mise run shots` can show every state of
 * mockup variants L10 and R2. The numbers are made up (the mockup's); the shapes are those
 * of `GET /api/leaderboard` and `GET /api/players/{id}`.
 */
import {
  ApiError,
  type Api,
  type Leaderboard,
  type LeaderboardEntry,
  type MatchEntry,
  type PlayerProfile,
  type RecordTally,
} from '../api/http.ts';

export const BOARD_SCENE_IDS = [
  'board-guest',
  'board-calibration',
  'board-ranked',
  'board-far',
  'board-empty',
  'board-loading',
  'board-network',
  'board-limited',
  'replays',
  'replays-guest',
  'replays-empty',
  'replays-loading',
  'replays-network',
] as const;

export type BoardSceneId = (typeof BOARD_SCENE_IDS)[number];

export function isBoardScene(id: string | null): id is BoardSceneId {
  return BOARD_SCENE_IDS.some((known) => known === id);
}

/** The clock of the scenes: "2 hr. ago" does not move between shots. */
export const BOARD_NOW = Date.parse('2026-10-29T12:00:00Z');

const ago = (minutes: number): string => new Date(BOARD_NOW - minutes * 60_000).toISOString();
const rec = (wins: number, losses: number, draws: number): RecordTally => ({
  wins,
  losses,
  draws,
});

/** The ids of the made-up players. */
export const ME = 6;
const VEGA = 3;
const PAVEL = 21;

const PEOPLE: readonly (readonly [string, number, number, number, number])[] = [
  ['Alina', 1712, 31, 9, 2],
  ['Tomas', 1655, 28, 12, 1],
  ['Vega', 1590, 22, 12, 3],
  ['Kolya', 1561, 25, 17, 2],
  ['Mira', 1522, 19, 11, 4],
  ['Danya', 1480, 12, 8, 1],
  ['Lena', 1441, 14, 13, 2],
  ['Sasha', 1398, 11, 9, 0],
  ['Nikita', 1366, 10, 10, 1],
  ['Oleg', 1342, 9, 8, 3],
  ['Anya', 1310, 8, 10, 1],
  ['Max', 1287, 9, 12, 0],
];

/** The top list; `withMe` keeps Danya (id 6) in it, otherwise the row is left out. */
function entries(withMe: boolean): LeaderboardEntry[] {
  return PEOPLE.map((p, i) => ({ person: p, id: i + 1 }))
    .filter(({ person }) => withMe || person[0] !== 'Danya')
    .map(({ person, id }, i) => ({
      rank: i + 1,
      player_id: id,
      nick: person[0],
      rating: person[1],
      rated_matches: person[2] + person[3] + person[4],
      record: rec(person[2], person[3], person[4]),
    }));
}

function board(withMe: boolean, total: number): Leaderboard {
  return { entries: entries(withMe), total, min_rated_matches: 5 };
}

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
  kind: MatchEntry['kind'],
  map: string,
  seconds: number,
  minutesAgo: number,
  replay: MatchEntry['replay']['state'],
  change: [number, number] | null = null,
): MatchEntry {
  nextId += 1;
  return {
    match_id: nextId,
    map_id: map,
    ended_at: ago(minutesAgo),
    ticks: seconds * 10,
    result,
    end_reason: 'timer',
    kind,
    unrated_reason: null,
    opponent,
    rating_change: change === null ? null : { before: change[0], after: change[1] },
    replay: { state: replay, url: replay === 'ready' ? `/api/replays/${String(nextId)}` : null },
  };
}

const mins = (min: number, sec: number): number => min * 60 + sec;

const MY_RANKED: MatchEntry[] = [
  m('win', E('Vega', VEGA), 'rated', 'crossroads', mins(12, 4), 125, 'ready', [1466, 1480]),
  m('loss', E('Kolya', 4), 'rated', 'ridge', mins(8, 41), 300, 'ready', [1475, 1466]),
  m('draw', BOT('expander'), 'bot', 'highway', mins(15, 0), 1500, 'expired'),
  m('win', E('Mira', 5), 'casual', 'crossroads', mins(10, 27), 1560, 'ready'),
  m('loss', E('Pavel', PAVEL), 'unrated', 'ridge', mins(6, 52), 2900, 'unavailable'),
  m('win', E('Tomas', 2), 'rated', 'highway', mins(13, 15), 3000, 'ready', [1461, 1475]),
];

function profile(over: Partial<PlayerProfile> & Pick<PlayerProfile, 'player_id' | 'nick'>) {
  const base: PlayerProfile = {
    has_password: true,
    rating: null,
    rank: null,
    calibration: null,
    rated_matches: 0,
    rated_record: rec(0, 0, 0),
    record: rec(0, 0, 0),
    matches: [],
    ...over,
  };
  return base;
}

const ranked = (far: boolean): PlayerProfile =>
  profile({
    player_id: ME,
    nick: 'Danya',
    rating: far ? 1102 : 1480,
    rank: far ? 143 : 6,
    rated_matches: far ? 20 : 21,
    rated_record: far ? rec(7, 12, 1) : rec(12, 8, 1),
    record: far ? rec(11, 17, 2) : rec(19, 11, 2),
    matches: MY_RANKED,
  });

const calibrating = (id: number, nick: string, played: number, matches: MatchEntry[]) =>
  profile({
    player_id: id,
    nick,
    calibration: { played, total: 5 },
    rated_matches: played,
    rated_record: rec(played - 1, 1, 0),
    record: rec(played + 2, 2, 0),
    matches,
  });

const GUEST_MATCHES: MatchEntry[] = [
  m('win', BOT('turtle'), 'bot', 'crossroads', mins(9, 44), 60, 'ready'),
  m('loss', E('Vega', VEGA), 'casual', 'ridge', mins(12, 20), 1500, 'ready'),
  m('draw', BOT('reactive'), 'bot', 'highway', mins(15, 0), 1560, 'expired'),
  m('win', E('Mira', 5), 'unrated', 'crossroads', mins(8, 3), 2900, 'ready'),
];

/** What a scene feeds the screen: the account, the player shown first and the fake answers. */
export interface BoardScene {
  readonly hasPassword: boolean;
  readonly calibration: { played: number; total: number } | null;
  readonly rating: number | null;
  readonly mode: 'board' | 'history';
  readonly leaderboard: () => Promise<Leaderboard>;
  readonly profiles: Readonly<Record<number, () => Promise<PlayerProfile>>>;
}

/** The fake API of a scene: the same three calls the screen makes. */
export function sceneApi(scene: BoardScene): Pick<Api, 'leaderboard' | 'player' | 'me'> {
  return {
    leaderboard: scene.leaderboard,
    me: () => Promise.resolve({ player_id: ME, nick: 'Danya', has_password: scene.hasPassword }),
    player: (id) => (scene.profiles[id] ?? reject<PlayerProfile>(new ApiError('not_found', 404)))(),
  };
}

const now =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value);
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const reject =
  <T>(error: ApiError) =>
  (): Promise<T> =>
    Promise.reject(error);

const TOP = board(true, 37);

function account(
  own: PlayerProfile,
  leaderboard: () => Promise<Leaderboard>,
  extra: Partial<BoardScene> = {},
): BoardScene {
  return {
    hasPassword: own.has_password,
    calibration: own.calibration,
    rating: own.rating,
    mode: 'board',
    leaderboard,
    ...extra,
    profiles: { [ME]: now(own), ...extra.profiles },
  };
}

const ownGuest = profile({
  player_id: ME,
  nick: 'Danya',
  has_password: false,
  record: rec(2, 1, 1),
  matches: GUEST_MATCHES,
});
const ownCalibrating = calibrating(ME, 'Danya', 2, [
  m('win', E('Mira', 5), 'calibration', 'crossroads', mins(11, 30), 60, 'ready'),
  m('loss', E('Sasha', 8), 'calibration', 'ridge', mins(9, 12), 1500, 'ready'),
  m('win', BOT('reactive'), 'bot', 'highway', mins(14, 40), 1560, 'expired'),
  m('win', E('Kolya', 4), 'casual', 'crossroads', mins(10, 5), 2900, 'ready'),
]);

export const BOARD_SCENES: Readonly<Record<BoardSceneId, BoardScene>> = {
  'board-guest': account(ownGuest, now(board(false, 37))),
  'board-calibration': account(ownCalibrating, now(board(false, 37))),
  'board-ranked': account(ranked(false), now(TOP)),
  'board-far': account(ranked(true), now(board(false, 214))),
  'board-empty': account(ownCalibrating, now({ entries: [], total: 0, min_rated_matches: 5 })),
  'board-loading': account(ranked(false), never),
  'board-network': account(ranked(false), reject(new ApiError('network', 0))),
  'board-limited': account(ranked(false), reject(new ApiError('rate_limited', 429, 12))),
  replays: account(ranked(false), now(TOP), { mode: 'history' }),
  'replays-guest': account(ownGuest, now(TOP), { mode: 'history' }),
  'replays-empty': account(
    profile({ player_id: ME, nick: 'Danya', has_password: false }),
    now(TOP),
    {
      mode: 'history',
    },
  ),
  'replays-loading': account(ranked(false), now(TOP), {
    mode: 'history',
    profiles: { [ME]: never },
  }),
  'replays-network': account(ranked(false), now(TOP), {
    mode: 'history',
    profiles: { [ME]: reject(new ApiError('network', 0)) },
  }),
};
