/**
 * The main screen of direction III Plinth (#919, #925; docs/design/mockups/out-of-game-rework-r2.html):
 * the menu map fills the screen, a stone plinth at its foot holds the three ways to play, the
 * status and one main button. The pure parts live here (the ways, their words and pause rules,
 * the bot's map picker, the invite's stages, the "New here?" gate), so they are tested without a
 * DOM; the screen is `PlayScreen.svelte`.
 */
import {
  NEW_MAP,
  RANDOM_POOL,
  type Api,
  type BotLevel,
  type Invite,
  type MapSummary,
} from '../api/http.ts';
import type { MessageKey } from '../i18n/index.ts';
import type { MapFile } from '../protocol.gen.ts';
import type { BackdropPhase } from './menuScene.ts';
import type { MapCache } from './mapCache.svelte.ts';

/**
 * What the main screen needs from the app (built once in RootApp; the dev scenes and the tests
 * build their own): who plays, the server, the queue lock, and where each action leads.
 */
export interface PlayContext {
  api: Api;
  token: string;
  nick: string;
  hasPassword: boolean;
  /** The menu map behind the screen (null: the plain dark page). */
  map: MapFile | null;
  /** The pool: the bot's map picker and its thumbnails. */
  maps: MapCache;
  /** The queue is locked until this time (ms since the epoch), or null (DEC-34). */
  banUntil: number | null;
  /** The clock of the lock's countdown; tests pass their own. */
  now?: () => number;
  /** A match of this player is running: the main button is Return. */
  hasActiveMatch: boolean;
  onresume: () => void;
  /** A way chosen on the plinth (the address of the screen keeps it). */
  onway: (way: Way) => void;
  /** Search: the queue (MM-01). */
  onsearch: () => void;
  /** Start a bot match; the answer is why it failed (the screen stays, the choices kept), or null. */
  onbot: (level: BotLevel, pick: string) => Promise<MessageKey | null>;
  /** Get the link: an invite with a map made for it; the answer is why it failed, or null. */
  oninvite: () => Promise<MessageKey | null>;
  /** A queue pair or an invite started: the match exists and the sockets can open. */
  onstart: (matchId: string, mapId: string) => void;
  /** The queue's offer of a bot match taken (the queue is left first). */
  onofferbot: () => void;
  /** The queue refused us for repeated resigns (DEC-34): the seconds left. */
  onbanned: (seconds: number) => void;
  /** Out of the queue or the waiting room, back to the plinth with this way and a notice. */
  onleave: (notice: MessageKey | null, way: Way) => void;
  /** The bar: the "?" (How to play) and the nick (the profile). */
  onhelp: () => void;
  onprofile: () => void;
}

/** What the plinth shows: the ways (and a way chosen), the queue, or an invite's waiting room. */
export type PlayState =
  | { readonly name: 'menu'; readonly way?: Way; readonly start?: BotLevel }
  | { readonly name: 'queue' }
  | { readonly name: 'invite'; readonly code: string };

/** What the plinth's state says to the menu map behind it (the marching road, the pair's nick). */
export interface BackdropState {
  phase: BackdropPhase;
  opponent: string | null;
  /** Seconds in the queue: the scout of the search walks by it (#474). */
  waited: number;
}

/** The player in the top bar: the nick opens the profile (#919). */
export interface TopPlayer {
  nick: string;
  /** A guest (no password): "Guest" beside the nick. An account shows the nick alone. */
  guest: boolean;
  onprofile: () => void;
  /** The profile is open: a small triangle under the nick, and it opens nothing. */
  here?: boolean;
}

/** The three ways to play, in the order of the plinth. */
export type Way = 'match' | 'bot' | 'friend';
export const WAYS: readonly Way[] = ['match', 'bot', 'friend'];

/** The name of each way on the plinth. */
export const WAY_LABEL: Readonly<Record<Way, MessageKey>> = {
  match: 'play.way.match',
  bot: 'menu.bot',
  friend: 'menu.create',
};

/**
 * The word of the main button per way (r2 "Per way"): it says what happens next. Search does not
 * start a match yet, Get the link gives a link.
 */
export const WAY_VERB: Readonly<Record<Way, MessageKey>> = {
  match: 'play.go.search',
  bot: 'bot.start',
  friend: 'play.go.link',
};

/** The pause rule of each way (DEC-05): a match of the queue has none. */
export const WAY_PAUSE: Readonly<Record<Way, 'none' | 'each'>> = {
  match: 'none',
  bot: 'each',
  friend: 'each',
};

/** The way after `way` in the direction of an arrow key, clamped at the ends. */
export function stepWay(way: Way, step: number): Way {
  const at = WAYS.indexOf(way) + step;
  return WAYS[Math.max(0, Math.min(WAYS.length - 1, at))] ?? way;
}

/** A tile of the bot's map picker: the new map, the random pool map, or a map of the pool. */
export interface PickerTile {
  readonly id: string;
  readonly kind: 'new' | 'random' | 'map';
}

/**
 * The bot's map picker (#919, item 2): New map (made for this match, the default), Random map
 * (random among the pool) and the pool maps. The stored generated maps (`gen1-*`) and any map made
 * for one match are not offered.
 */
export function pickerTiles(list: readonly MapSummary[] | null): PickerTile[] {
  const pool = (list ?? []).filter((m) => !m.generated && !m.per_match);
  return [
    { id: NEW_MAP, kind: 'new' },
    { id: RANDOM_POOL, kind: 'random' },
    ...pool.map((m) => ({ id: m.id, kind: 'map' as const })),
  ];
}

/** The chosen tile, or the new map when the choice left the list (a refreshed list). */
export function pickedTile(pick: string, tiles: readonly PickerTile[]): string {
  return tiles.some((tile) => tile.id === pick) ? pick : NEW_MAP;
}

/**
 * Where an invite's waiting room stands, as the plinth shows it:
 * `link`: the host waits for a friend, the link is the main thing (variant C: it stands in the
 * place of the main button as soon as the server made the invite, the map may still be drawing);
 * `joined`: both seats are taken, Ready is the main thing; `starting`: both are ready, the match
 * starts once the map is there.
 */
type InviteStage = 'loading' | 'link' | 'waiting' | 'joined' | 'starting';

export interface InviteView {
  readonly stage: InviteStage;
  /** The other seat: the guest for the host, the host for the guest; null while it is empty. */
  readonly opponent: string | null;
  /** A new map is still being made for this match (#884). */
  readonly drawing: boolean;
  readonly youReady: boolean;
  readonly opponentReady: boolean;
}

export function inviteView(invite: Invite | null, nick: string): InviteView {
  if (invite === null) {
    return {
      stage: 'loading',
      opponent: null,
      drawing: false,
      youReady: false,
      opponentReady: false,
    };
  }
  const isHost = invite.host_nick === nick;
  const opponent = isHost ? invite.guest_nick : invite.host_nick;
  const drawing = !invite.map_ready;
  const base = {
    opponent,
    drawing,
    youReady: invite.you_ready,
    opponentReady: invite.opponent_ready,
  };
  if (opponent === null) {
    // A public entry has no link to send (the lobby is gone from the client, #919): it only waits.
    return { ...base, stage: invite.public ? 'waiting' : 'link' };
  }
  return { ...base, stage: invite.you_ready && invite.opponent_ready ? 'starting' : 'joined' };
}

/** The node points of the "Drawing the map..." sketch (the mockup's `DRAW_NODES`), 220 x 124. */
export const DRAW_NODES: readonly (readonly [number, number])[] = [
  [14, 70],
  [44, 40],
  [40, 98],
  [80, 66],
  [104, 30],
  [118, 96],
  [150, 58],
  [168, 22],
  [176, 100],
  [206, 66],
];

/** The burin's one trail through the roads of the sketch, by node index. */
export const DRAW_TRAIL: readonly number[] = [
  0, 1, 3, 2, 0, 2, 5, 3, 4, 1, 4, 7, 6, 3, 6, 5, 8, 6, 9, 8, 9, 7,
];

/**
 * When each node of the sketch sets (a share of the loop): the moment the burin first reaches it,
 * along the trail by length, within the drawing part `draw` of the loop.
 */
export function drawTimes(draw = 0.78): number[] {
  const points = DRAW_TRAIL.map((i) => DRAW_NODES[i] ?? [0, 0]);
  const run = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] ?? [0, 0];
    const [bx, by] = points[i] ?? [0, 0];
    run.push((run[i - 1] ?? 0) + Math.hypot(bx - ax, by - ay));
  }
  const total = run[run.length - 1] ?? 1;
  return DRAW_NODES.map((_, n) => {
    const k = DRAW_TRAIL.indexOf(n);
    return Math.min(draw, ((run[k] ?? 0) / total) * draw);
  });
}
