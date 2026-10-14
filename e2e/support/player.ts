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
    await this.page.getByRole('button', { name: /^(Play|Join the match)$/ }).click();
  }

  /** The host: menu, private match on `mapId`, returns the invite link. */
  async createInvite(mapId: string): Promise<string> {
    await this.page.getByRole('button', { name: 'Private match with a friend' }).click();
    await this.page.getByLabel('Map').selectOption(mapId);
    await this.page.getByRole('button', { name: 'Create the match' }).click();
    const link = this.page.getByLabel('Invite link');
    await expect(link).toHaveValue(/\/\?m=[\w-]+$/);
    return await link.inputValue();
  }

  async pressReady(): Promise<void> {
    await expect(this.page.getByText(/^Opponent: /)).toBeVisible();
    await this.page.getByRole('button', { name: 'Ready' }).click();
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
    modifiers: ('Shift' | 'Control')[] = [],
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
   * second click holds Shift (a planned order, dearer and shown to the enemy as an intent).
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
    await this.clickNode(map, to, planned ? ['Shift'] : []);
  }

  /** "Exit" of the top bar, then the confirmation of the dialog: a forfeit. */
  async forfeit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Exit', exact: true }).click();
    await this.page.getByRole('button', { name: 'Forfeit and leave' }).click();
  }
}
