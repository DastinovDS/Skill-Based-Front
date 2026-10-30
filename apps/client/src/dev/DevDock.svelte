<script lang="ts">
  import { Api, ApiError, type Invite, type LobbyEntry, type MapSummary } from '../api/http.ts';
  import BotScreen from '../app/BotScreen.svelte';
  import CreateScreen from '../app/CreateScreen.svelte';
  import type { DockContext } from '../app/dock.ts';
  import InviteScreen from '../app/InviteScreen.svelte';
  import LobbyScreen from '../app/LobbyScreen.svelte';
  import PasswordScreen from '../app/PasswordScreen.svelte';
  import { MapCache } from '../app/mapCache.svelte.ts';
  import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { BAN_SECONDS, CALIBRATION } from './menuScenes.ts';

  interface Props {
    id: string;
    map: MapFile;
  }

  let { id, map }: Props = $props();

  // The Dock screens (#473) with a fake server: fixed lists and invites, nothing is asked of a
  // network. The scenes that need a click to reach their state (joining, a failed create) are
  // clicked by visual/shots.spec.ts.
  const pool = ['crossroads', 'highway', 'ridge']
    .map((name) => BUNDLED_MAPS.find((m) => m.meta.name === name))
    .filter((m): m is MapFile => m !== undefined);
  const summary = (m: MapFile): MapSummary => ({
    id: m.meta.name,
    version: m.meta.version,
    width: m.meta.width,
    height: m.meta.height,
    background_url: null,
  });
  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const entry = (code: string, host_nick: string, map_id: string, age_s: number): LobbyEntry => ({
    code,
    host_nick,
    map_id,
    age_s,
  });
  const FEW = [
    entry('a', 'Vega', 'crossroads', 40),
    entry('b', 'Kolya', 'ridge', 130),
    entry('c', 'Mira', 'highway', 185),
  ];
  const MANY = [
    ...FEW,
    entry('d', 'Ilya', 'ridge', 240),
    entry('e', 'Sasha', 'crossroads', 301),
    entry('f', 'Tomas', 'highway', 360),
    entry('g', 'Lena', 'ridge', 420),
    entry('h', 'Pavel', 'crossroads', 512),
  ];
  const invite = (over: Partial<Invite>): Invite => ({
    code: 'k3x9-q7ab-02ff',
    state: 'open',
    public: false,
    map_id: 'crossroads',
    host_nick: 'Danya',
    guest_nick: null,
    you_ready: false,
    opponent_ready: false,
    expires_in_s: 1800,
    match_id: null,
    ...over,
  });
  const INVITES: Readonly<Record<string, Invite>> = {
    'invite-link': invite({}),
    'invite-banned': invite({}),
    'invite-public': invite({ public: true }),
    'invite-joined': invite({ state: 'joined', guest_nick: 'Vega', expires_in_s: 1740 }),
    'invite-opp-ready': invite({
      state: 'joined',
      guest_nick: 'Vega',
      opponent_ready: true,
      expires_in_s: 1740,
    }),
    'invite-you-ready': invite({
      state: 'joined',
      guest_nick: 'Vega',
      you_ready: true,
      expires_in_s: 1740,
    }),
    'invite-starting': invite({
      state: 'joined',
      guest_nick: 'Vega',
      you_ready: true,
      opponent_ready: true,
      expires_in_s: 1740,
    }),
  };

  function build(id: string, map: MapFile): { api: Api; dock: DockContext } {
    const api = {
      maps: () =>
        id === 'create-nomaps'
          ? Promise.reject(new ApiError('network', 0))
          : Promise.resolve(pool.map(summary)),
      map: (mapId: string) => {
        const found = pool.find((m) => m.meta.name === mapId);
        return found === undefined
          ? Promise.reject(new ApiError('not_found', 404))
          : Promise.resolve(found);
      },
      lobby: () => {
        if (id === 'lobby-loading') return never<LobbyEntry[]>();
        if (id === 'lobby-network') return Promise.reject(new ApiError('network', 0));
        if (id === 'lobby-empty') return Promise.resolve([]);
        return Promise.resolve(id === 'lobby-many' ? MANY : FEW);
      },
      joinInvite: () =>
        id === 'lobby-taken' ? Promise.reject(new ApiError('conflict', 409)) : never<Invite>(),
      invite: () => Promise.resolve(INVITES[id] ?? invite({})),
      readyInvite: () => never<Invite>(),
      cancelInvite: () => Promise.resolve(),
    } as unknown as Api;

    const banned = id.endsWith('-banned');
    const guest = id === 'lobby-guest' || id === 'password-set';
    const rated = id === 'bot-rated';
    const dock: DockContext = {
      nick: 'Danya',
      hasPassword: !guest,
      calibration: guest || rated ? null : CALIBRATION,
      banUntil: banned ? BAN_SECONDS * 1000 : null,
      now: () => 0,
      map,
      maps: new MapCache(api),
      onbot: () => undefined,
      oncreate: () => undefined,
      onlobby: () => undefined,
      onreplays: () => undefined,
      onboard: () => undefined,
      onmenu: () => undefined,
      onpassword: () => undefined,
      onlogout: () => undefined,
    };
    return { api, dock };
  }

  const scene = $derived(build(id, map));
  const api = $derived(scene.api);
  const dock = $derived(scene.dock);
  const nothing = (): void => undefined;
</script>

{#if id.startsWith('lobby-')}
  <LobbyScreen {api} token="dev" {dock} oncreate={nothing} onjoined={nothing} onback={nothing} />
{:else if id === 'create-private' || id === 'create-public' || id === 'create-nomaps' || id === 'create-error'}
  <CreateScreen
    {dock}
    isPublic={id === 'create-public'}
    oncreate={() => Promise.resolve(id === 'create-error' ? 'error.api.unavailable' : null)}
    onback={nothing}
  />
{:else if id === 'password-set' || id === 'password-change'}
  <PasswordScreen
    {dock}
    hasPassword={id === 'password-change'}
    onsubmit={() => Promise.resolve(null)}
    onback={nothing}
  />
{:else if id.startsWith('invite-')}
  <InviteScreen
    {api}
    token="dev"
    nick="Danya"
    code="k3x9-q7ab-02ff"
    {dock}
    onstart={nothing}
    onleave={nothing}
  />
{:else}
  <BotScreen
    {dock}
    onstart={() => (id === 'bot-error' ? Promise.resolve('error.api.unavailable') : never<null>())}
    onback={nothing}
  />
{/if}
