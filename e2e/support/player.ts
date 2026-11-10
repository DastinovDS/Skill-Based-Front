import type { Browser, Page, WebSocketRoute } from '@playwright/test';
import { expect } from '@playwright/test';
import type { MapFile } from '../../apps/client/src/protocol.gen.ts';
import { FIT_PADDING, fitCamera, worldToScreen } from '../../apps/client/src/render/camera.ts';

/** A JSON message of the match socket, in either direction. */
export interface Frame {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface Link {
  readonly page: WebSocketRoute;
  readonly server: WebSocketRoute;
}

/**
 * One player: an isolated browser context (own localStorage, so own guest) with a page whose match
 * socket is relayed through the test. The relay only records frames and can drop the connection;
 * the client and the server talk to each other as usual.
 */
export class Player {
  /** Messages of the server (`welcome`, `snapshot`, `ack`, ...), in order. */
  readonly received: Frame[] = [];
  /** Messages of the client (`hello`, `command`, ...), in order. */
  readonly sent: Frame[] = [];
  readonly #links: Link[] = [];

  readonly nick: string;
  readonly page: Page;

  private constructor(nick: string, page: Page) {
    this.nick = nick;
    this.page = page;
  }

  static async create(browser: Browser, baseURL: string, nick: string): Promise<Player> {
    const context = await browser.newContext({
      baseURL,
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    // The opening scene of the entry screen plays once a browser session (#826): mark it seen, so
    // the players reach the form at once (the tests that open a bare page still see it play).
    await context.addInitScript(() => {
      window.sessionStorage.setItem('sbf.introSeen', '1');
    });
    const player = new Player(nick, await context.newPage());
    await player.page.routeWebSocket(/\/ws\/match\//, (route) => {
      const server = route.connectToServer();
      player.#links.push({ page: route, server });
      server.onMessage((message) => {
        player.#record(player.received, message);
        route.send(message);
      });
      route.onMessage((message) => {
        player.#record(player.sent, message);
        server.send(message);
      });
      // A close of one side closes the other one.
      server.onClose((code, reason) => {
        void route.close({ code, reason });
      });
      route.onClose((code, reason) => {
        void server.close({ code, reason });
      });
    });
    return player;
  }

  #record(into: Frame[], message: string | Buffer): void {
    if (typeof message === 'string') into.push(JSON.parse(message) as Frame);
  }

  async close(): Promise<void> {
    await this.page.context().close();
  }

  // --- Lobby ----------------------------------------------------------------------------------

  /** The welcome screen: picks a nick. Opens `url` (the home page or an invite link) first. */
  async enter(url = '/'): Promise<void> {
    await this.page.goto(url);
    await this.page.getByLabel('Your nick').fill(this.nick);
    await this.page.getByRole('button', { name: /^(Play|Join)$/ }).click();
  }

  /**
   * The host: the way "Invite a friend" on the plinth (#919), then "Get the link" (a map is made
   * for the match); returns the invite link, which shows as soon as the server made the invite.
   */
  async createInvite(): Promise<string> {
    await this.page.getByRole('radio', { name: 'Invite a friend' }).click();
    await this.page.getByRole('button', { name: 'Get the link', exact: true }).click();
    const link = this.page.getByLabel('Invite link');
    await expect(link).toHaveValue(/\/\?m=[\w-]+$/);
    return await link.inputValue();
  }

  /**
   * The host on a named pool map: the client offers no map choice for an invite (#919, a map is
   * made for it), so the invite is made through the API and the host opens its own link, which
   * leads into the waiting room like any invite. For the tests whose orders need a known map.
   */
  async createInviteOn(mapId: string): Promise<string> {
    // The nick form answers before the token is stored: wait for the main screen.
    await expect(this.page.getByRole('radio', { name: 'Invite a friend' })).toBeVisible();
    const response = await this.page.request.post('/api/matches', {
      headers: { Authorization: `Bearer ${await this.token()}` },
      data: { map_id: mapId },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const code = ((await response.json()) as { code: string }).code;
    await this.page.goto(`/?m=${encodeURIComponent(code)}`);
    const link = this.page.getByLabel('Invite link');
    await expect(link).toHaveValue(/\/\?m=[\w-]+$/);
    return await link.inputValue();
  }

  /** The token this browser keeps for the player (`sbf.guest`). */
  async token(): Promise<string> {
    return await this.page.evaluate(() => {
      const saved = window.localStorage.getItem('sbf.guest');
      return saved === null ? '' : (JSON.parse(saved) as { token: string }).token;
    });
  }

  /** The map of an invite, as the server says it (`GET /api/matches/{code}` with the own token). */
  async inviteMap(code: string): Promise<string> {
    const response = await this.page.request.get(`/api/matches/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { map_id: string }).map_id;
  }

  /** A friend has joined: "Ready" on the plinth (#919). */
  async pressReady(): Promise<void> {
    const ready = this.page.getByRole('button', { name: 'Ready', exact: true });
    await expect(ready).toBeEnabled({ timeout: 30_000 });
    await ready.click();
  }

  /** The match screen is up and snapshots arrive (the canvas carries the last tick). */
  async expectPlaying(): Promise<void> {
    await expect(this.page.locator('.game-canvas')).toHaveAttribute('data-tick', /^[1-9]\d*$/, {
      timeout: 60_000,
    });
  }

  async tick(): Promise<number> {
    return Number((await this.page.locator('.game-canvas').getAttribute('data-tick')) ?? '0');
  }

  // --- Frames ---------------------------------------------------------------------------------

  /** Which side the server gave this player (from `welcome`). */
  async side(): Promise<0 | 1> {
    await expect.poll(() => this.received.some((f) => f.type === 'welcome')).toBe(true);
    const welcome = this.received.find((f) => f.type === 'welcome');
    return welcome?.['player'] === 1 ? 1 : 0;
  }

  welcomes(): number {
    return this.received.filter((f) => f.type === 'welcome').length;
  }

  /** Commands of this player the server accepted (`ack` without a reject code), by type. */
  async accepted(type: string): Promise<number> {
    const seqs = new Set(
      this.sent
        .filter((f) => f.type === 'command' && (f['cmd'] as Frame).type === type)
        .map((f) => f['seq']),
    );
    return this.received.filter(
      (f) => f.type === 'ack' && f['reject_code'] === null && seqs.has(f['seq']),
    ).length;
  }

  /** Cuts the match socket from the outside, like a network drop; the client reconnects itself. */
  async dropConnection(): Promise<void> {
    const link = this.#links.at(-1);
    if (link === undefined) throw new Error('no match socket yet');
    await link.page.close({ code: 1001, reason: 'e2e: connection dropped' });
  }

  // --- Orders on the map ----------------------------------------------------------------------

  /** Page coordinates of a world point of the map, as the client draws it ("fit map" camera). */
  async #screenPoint(map: MapFile, world: { x: number; y: number }) {
    const canvas = await this.page.locator('.game-canvas').boundingBox();
    const top = await this.page.locator('.top').boundingBox();
    if (canvas === null || top === null) throw new Error('match screen not laid out');
    // The same inset the HUD reports to the camera: the top bar (there is no side panel).
    const insets = {
      left: 0,
      top: Math.ceil(top.y + top.height - canvas.y),
      right: 0,
      bottom: 0,
    };
    const viewport = { width: canvas.width, height: canvas.height };
    const camera = fitCamera(
      { width: map.meta.width, height: map.meta.height },
      viewport,
      FIT_PADDING,
      insets,
    );
    const at = worldToScreen(camera, viewport, world);
    return { x: canvas.x + at.x, y: canvas.y + at.y };
  }

  /**
   * Clicks a city. Own units standing in it are one icon in the middle of the city, so a click
   * there picks the group (the only one in the city; with several the click opens their list).
   */
  async clickNode(
    map: MapFile,
    nodeId: number,
    modifiers: ('Shift' | 'Control' | 'KeyE')[] = [],
  ): Promise<void> {
    const node = map.nodes[nodeId];
    if (node === undefined) throw new Error(`no node ${String(nodeId)}`);
    const at = await this.#screenPoint(map, { x: node.x, y: node.y });
    for (const key of modifiers) await this.page.keyboard.down(key);
    await this.page.mouse.click(at.x, at.y);
    for (const key of modifiers) await this.page.keyboard.up(key);
  }

  /**
   * The order "move the group standing in `from` to `to`": group, then destination. `planned`: the
   * second click holds `E` (a planned order, dearer and shown to the enemy as an intent; DEC-48,
   * item K2: Shift selects several groups, and while it is held no order is given, #928).
   */
  async moveGroup(map: MapFile, from: number, to: number, planned = false): Promise<void> {
    // Start from nothing selected (an order lets the group go, but the pick may be left over): a
    // click on the empty corner of the canvas deselects. Not `Esc`: two in a row ask to leave the match.
    const canvas = await this.page.locator('.game-canvas').boundingBox();
    if (canvas === null) throw new Error('no canvas');
    await this.page.mouse.click(canvas.x + canvas.width - 3, canvas.y + canvas.height - 3);
    // There is no selection card since UI round 2: the HUD says what is selected in an attribute.
    await expect(this.page.locator('.hud')).toHaveAttribute('data-selection', 'none');
    await this.clickNode(map, from);
    await expect(this.page.locator('.hud')).toHaveAttribute('data-selection', /^group:/);
    await this.clickNode(map, to, planned ? ['KeyE'] : []);
  }

  /** "Exit" of the top bar, then the confirmation of the dialog: a forfeit. */
  async forfeit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Exit', exact: true }).click();
    await this.page.getByRole('button', { name: 'Forfeit and leave' }).click();
  }
}
