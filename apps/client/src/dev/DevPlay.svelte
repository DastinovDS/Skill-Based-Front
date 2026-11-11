<script lang="ts">
  import { ApiError, type Api, type Invite, type MapSummary } from '../api/http.ts';
  import type { MessageKey } from '../i18n/index.ts';
  import { MapCache } from '../app/mapCache.svelte.ts';
  import PlayScreen from '../app/PlayScreen.svelte';
  import type { PlayContext, PlayState, Way } from '../app/play.ts';
  import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { BAN_SECONDS, QUEUE_SCENES } from './menuScenes.ts';

  interface Props {
    id: string;
    map: MapFile;
  }

  let { id, map }: Props = $props();

  // The way chosen on the plinth (the buttons of the ways work in a scene), over the scene's own.
  let chosen = $state<Way | null>(null);
  // `?ready=<s>` on `invite-link`: the map is drawn after that many seconds, as the server tells
  // it on a poll (the drawing sketch must stop then, #945).
  const readyAfter = Number(new URLSearchParams(window.location.search).get('ready') ?? NaN);
  const startedAt = Date.now();

  // The main screen (#919) with a fake server: fixed lists and invites, nothing is asked of a
  // network. The scenes that need a click to reach their state (a start, a link being made) are
  // clicked by visual/shots.spec.ts.
  const pool = ['crossroads', 'highway', 'narrows', 'ridge', 'gen1-17', 'gen1-25']
    .map((name) => BUNDLED_MAPS.find((m) => m.meta.name === name))
    .filter((m): m is MapFile => m !== undefined);
  const summary = (m: MapFile): MapSummary => ({
    id: m.meta.name,
    version: m.meta.version,
    width: m.meta.width,
    height: m.meta.height,
    background_url: null,
    generated: m.meta.symmetry === 'none',
    per_match: false,
  });
  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const invite = (over: Partial<Invite>): Invite => ({
    code: 'k3x9-q7ab-02ff',
    state: 'open',
    public: false,
    map_id: 'live-3f9a07c1d2e4',
    map_ready: false,
    host_nick: 'Ember',
    guest_nick: null,
    you_ready: false,
    opponent_ready: false,
    expires_in_s: 1800,
    match_id: null,
    ...over,
  });
  const joined = {
    state: 'joined',
    guest_nick: 'Vega',
    map_ready: true,
    expires_in_s: 1740,
  } as const;
  const INVITES: Readonly<Record<string, Invite>> = {
    // The link as soon as the server made it, the map still being drawn (variant C).
    'invite-link': invite({}),
    'invite-waiting': invite({ map_ready: true }),
    'invite-joined': invite(joined),
    'invite-opp-ready': invite({ ...joined, opponent_ready: true }),
    'invite-you-ready': invite({ ...joined, you_ready: true }),
    'invite-starting': invite({ ...joined, you_ready: true, opponent_ready: true }),
    'invite-drawing-start': invite({
      ...joined,
      map_ready: false,
      you_ready: true,
      opponent_ready: true,
    }),
  };

  function build(sceneId: string, backdrop: MapFile): { ctx: PlayContext; state: PlayState } {
    const api = {
      maps: () => Promise.resolve(pool.map(summary)),
      map: (mapId: string) => {
        const found = pool.find((m) => m.meta.name === mapId);
        return found === undefined
          ? Promise.reject(new ApiError('not_found', 404))
          : Promise.resolve(found);
      },
      invite: () =>
        Promise.resolve(
          sceneId === 'invite-link' && Number.isFinite(readyAfter)
            ? invite({ map_ready: Date.now() - startedAt >= readyAfter * 1000 })
            : (INVITES[sceneId] ?? invite({})),
        ),
      readyInvite: () => never<Invite>(),
      cancelInvite: () => Promise.resolve(),
      leaveQueue: () => Promise.resolve(),
    } as unknown as Api;
    const nothing = (): void => undefined;
    const ctx: PlayContext = {
      api,
      token: 'dev',
      nick: 'Ember',
      hasPassword: sceneId === 'menu-account',
      map: backdrop,
      maps: new MapCache(api),
      banUntil: sceneId === 'menu-banned' ? BAN_SECONDS * 1000 : null,
      now: () => 0,
      hasActiveMatch: sceneId === 'menu-resume',
      onresume: nothing,
      onway: (way: Way) => {
        chosen = way;
      },
      onsearch: nothing,
      onbot: () =>
        sceneId === 'bot-error'
          ? Promise.resolve<MessageKey>('error.api.unavailable')
          : sceneId === 'bot-timeout'
            ? Promise.resolve<MessageKey>('error.bot.slow')
            : never<null>(),
      oninvite: () => never<null>(),
      onstart: nothing,
      onofferbot: nothing,
      onbanned: nothing,
      onleave: nothing,
      onhelp: nothing,
      onprofile: nothing,
    };
    const state: PlayState = sceneId.startsWith('queue-')
      ? { name: 'queue' }
      : sceneId.startsWith('invite-') && sceneId !== 'invite-creating'
        ? { name: 'invite', code: 'k3x9-q7ab-02ff' }
        : sceneId.startsWith('bot-') || sceneId === 'menu-bot'
          ? { name: 'menu', way: 'bot' }
          : sceneId === 'menu-friend' || sceneId === 'invite-creating'
            ? { name: 'menu', way: 'friend' }
            : { name: 'menu' };
    return { ctx, state };
  }

  const scene = $derived(build(id, map));
  const view = $derived<PlayState>(
    chosen !== null && scene.state.name === 'menu' ? { ...scene.state, way: chosen } : scene.state,
  );
</script>

<PlayScreen
  ctx={scene.ctx}
  {view}
  notice={id === 'menu-error' ? 'error.api.network' : null}
  queueFixed={QUEUE_SCENES[id] ?? null}
/>
