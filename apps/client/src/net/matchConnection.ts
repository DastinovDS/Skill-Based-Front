/**
 * WebSocket client of one match (CLI-01, #57; server side: SRV-03, #48).
 *
 * Plain TypeScript, no Svelte state: callers get everything through the handlers. The flow:
 * open -> `hello` (first message, the token is never in the URL) -> `welcome` (ready) -> the
 * server streams `snapshot`s. After a drop the connection is reopened with exponential backoff
 * and the same token; commands the server has not acknowledged are resent (AGENTS.md, 5.3).
 * Close code 4001 (protocol version mismatch) is final: the page has to be reloaded. So is 4009
 * (replaced by a newer connection of the same player, e.g. a second tab): reconnecting would
 * make two tabs evict each other forever (SRV-04, #50).
 *
 * The other codes do not retry forever either (CLI-01, #416): 4004 (the server answers it for an
 * unknown token, an unknown or finished match and a non-participant, and does not say which) is
 * retried `noMatchRetries` times, a start race being its only legitimate cause, then the match is
 * `gone`; 1008 (policy, rate limit) is not retried blindly: `failed`; any other code is retried
 * `maxAttempts` times with the backoff, then `failed`, and `retry()` starts over by the player's
 * hand. The queue of unacknowledged commands is capped below the server's token bucket, so a
 * resend after a long outage cannot trip it.
 *
 * A link that dies without a FIN or an RST (a Wi-Fi change, sleep and wake, a NAT timeout) raises
 * `close` only when the browser's own TCP timeout expires, long after the server has started the
 * disconnect window of DEC-05 (CLI-02, #417). So the client watches for life itself: while ready
 * (and not in a pause, when the server sends no snapshots) no frame of any kind for `deadAfterMs`
 * is a dead link, and so are two unanswered pings; either closes the socket on this side and takes
 * the normal reconnect path. `online` and a tab that becomes visible again reconnect at once, or
 * check the link at once.
 */
import {
  CLOSE_PROTOCOL_VERSION,
  CLOSE_REPLACED,
  PROTOCOL_VERSION,
  type ClientMsg,
  type Command,
  type ServerMsg,
} from '../protocol.gen.ts';
import { decodeServerMsg, encodeClientMsg } from './decode.ts';

export type ConnectionStatus =
  /** Not started, or stopped by `close()`. */
  | 'idle'
  /** Socket opening, or `hello` sent and `welcome` awaited. */
  | 'connecting'
  /** `welcome` received; commands go out at once. */
  | 'ready'
  /** Dropped; the next attempt is scheduled. */
  | 'reconnecting'
  /** The server closed with 4001: reload the page. */
  | 'version_mismatch'
  /** The server closed with 4009: another tab or device of this player took over the match. */
  | 'replaced'
  /** The server keeps answering 4004: the match is over, or no longer exists for this token. */
  | 'gone'
  /** Too many failed attempts, or the server closed with 1008: `retry()` tries again. */
  | 'failed'
  /** `match_end` received: the server closes the connection, nothing to reconnect to. */
  | 'ended';

export interface MatchHandlers {
  /** Every valid server message except `pong` (RTT goes to `onRtt`). */
  onMessage: (msg: ServerMsg) => void;
  onStatus?: (status: ConnectionStatus) => void;
  /** Round-trip time in ms, one call per answered ping. */
  onRtt?: (ms: number) => void;
  /** A frame that is not a valid server message was dropped. */
  onInvalidFrame?: () => void;
  /**
   * The snapshot timeline is broken: `resync` was requested or the connection dropped. Clear the
   * snapshot buffer (CLI-02, #58); the next snapshot is a full view again.
   */
  onReset?: () => void;
  /** After a reconnect `welcome.last_seq` covers this command, but its `ack` was lost. */
  onAckLost?: (seq: number) => void;
}

export interface MatchConnectionOptions {
  matchId: string;
  /** Guest token; sent only in `hello`. */
  token: string;
  handlers: MatchHandlers;
  /** Page location; the URL is same-origin (CSP `connect-src 'self'`). */
  location?: Pick<Location, 'protocol' | 'host'>;
  createSocket?: (url: string) => WebSocket;
  /** First retry delay; doubles per failed attempt up to `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  pingIntervalMs?: number;
  /** No frame for this long while ready (and not paused) is a dead link (default `DEAD_AFTER_MS`). */
  deadAfterMs?: number;
  /** How often the silence is checked (default `WATCHDOG_MS`). */
  watchdogMs?: number;
  /** Page events for waking up: `online` of the window, `visibilitychange` of the document. */
  page?: { window: EventTarget; document: Document } | null;
  /** Failed attempts in a row before the status is `failed` (default `MAX_ATTEMPTS`). */
  maxAttempts?: number;
  /** Answers 4004 in a row that are retried before the status is `gone` (default `NO_MATCH_RETRIES`). */
  noMatchRetries?: number;
  /** Unacknowledged commands kept (default `MAX_PENDING_COMMANDS`); the oldest is dropped. */
  maxPending?: number;
  /** In [0, 1); the delay is spread over [50%, 100%] of its nominal value. */
  random?: () => number;
  /** Monotonic clock in ms. */
  now?: () => number;
}

/** Close codes of the server that are not in the protocol schema (`ws.py`, `CLOSE_POLICY`, `CLOSE_NO_MATCH`). */
export const CLOSE_POLICY = 1008;
export const CLOSE_NO_MATCH = 4004;

/** Failed attempts in a row before giving up: with the backoff this is about the 60 s window of DEC-05. */
export const MAX_ATTEMPTS = 8;
/** A 4004 right after the start of a match may be a race: two more tries, then the match is gone. */
export const NO_MATCH_RETRIES = 2;
/** Below the server's burst of 60 messages per connection, with room for `hello` and the pings. */
export const MAX_PENDING_COMMANDS = 50;

/** Snapshots come at 10 Hz: this much silence while ready is not a slow link, it is a dead one. */
export const DEAD_AFTER_MS = 3_000;
export const WATCHDOG_MS = 1_000;
/** What the browser reports for a link that went away without a close handshake. */
const CLOSE_ABNORMAL = 1006;

/** `ws(s)://<host>/ws/match/<id>` for the page's own origin. */
export function matchSocketUrl(
  matchId: string,
  location: Pick<Location, 'protocol' | 'host'>,
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws/match/${encodeURIComponent(matchId)}`;
}

/** Delay before reconnect attempt number `attempt` (0 is the first retry). */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: number,
): number {
  return Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + random / 2);
}

function pageOf(scope: typeof globalThis): { window: EventTarget; document: Document } | null {
  return typeof scope.window === 'undefined' || typeof scope.document === 'undefined'
    ? null
    : { window: scope.window, document: scope.document };
}

export class MatchConnection {
  readonly #opts: MatchConnectionOptions;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #pingMs: number;
  readonly #random: () => number;
  readonly #now: () => number;
  readonly #maxAttempts: number;
  readonly #noMatchRetries: number;
  readonly #maxPending: number;
  readonly #deadAfterMs: number;
  readonly #watchdogMs: number;

  #status: ConnectionStatus = 'idle';
  #socket: WebSocket | null = null;
  #attempt = 0;
  /** Answers 4004 in a row. */
  #noMatch = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #pingTimer: ReturnType<typeof setInterval> | undefined;
  #watchdog: ReturnType<typeof setInterval> | undefined;
  /** When the last frame of any kind arrived on this connection (`now()`). */
  #lastFrameAt = 0;
  /** The match is paused: the server sends no snapshots, only the answers to pings. */
  #paused = false;
  #unhook: (() => void) | null = null;

  #nextSeq = 1;
  /** Commands sent (or waiting to be sent) and not yet acknowledged, by `seq`. */
  readonly #pending = new Map<number, ClientMsg>();
  #nextPingId = 0;
  readonly #pingSentAt = new Map<number, number>();

  constructor(opts: MatchConnectionOptions) {
    this.#opts = opts;
    this.#baseMs = opts.baseBackoffMs ?? 500;
    this.#maxMs = opts.maxBackoffMs ?? 15_000;
    this.#pingMs = opts.pingIntervalMs ?? 5_000;
    this.#random = opts.random ?? Math.random;
    this.#now = opts.now ?? (() => performance.now());
    this.#maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.#noMatchRetries = opts.noMatchRetries ?? NO_MATCH_RETRIES;
    this.#maxPending = opts.maxPending ?? MAX_PENDING_COMMANDS;
    this.#deadAfterMs = opts.deadAfterMs ?? DEAD_AFTER_MS;
    this.#watchdogMs = opts.watchdogMs ?? WATCHDOG_MS;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Commands waiting for an `ack`, in `seq` order (for ghost orders in the UI). */
  get pendingSeqs(): number[] {
    return [...this.#pending.keys()];
  }

  connect(): void {
    if (this.#status !== 'idle') return;
    this.#hookPage();
    this.#open();
  }

  /** Queue a command and send it when the connection is ready. Returns its `seq`. */
  send(cmd: Command): number {
    const seq = this.#nextSeq++;
    const msg: ClientMsg = { type: 'command', seq, cmd };
    this.#pending.set(seq, msg);
    if (this.#pending.size > this.#maxPending) {
      // The oldest goes: its outcome is unknown now, like after a lost `ack`.
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) {
        this.#pending.delete(oldest);
        this.#opts.handlers.onAckLost?.(oldest);
      }
    }
    if (this.#status === 'ready') this.#write(msg);
    return seq;
  }

  /** After `failed`: try again from the first attempt, with the commands still waiting. */
  retry(): void {
    if (this.#status !== 'failed') return;
    this.#attempt = 0;
    this.#noMatch = 0;
    this.#open();
  }

  /** Ask the server for a full snapshot (after a gap in snapshots). */
  resync(): void {
    if (this.#status !== 'ready') return;
    this.#opts.handlers.onReset?.();
    this.#write({ type: 'resync' });
  }

  /** Ask to pause a private match (DEC-05); not queued: a pause after a drop makes no sense. */
  pause(): void {
    if (this.#status === 'ready') this.#write({ type: 'pause' });
  }

  /** End a pause early (only the player who paused may). */
  resume(): void {
    if (this.#status === 'ready') this.#write({ type: 'resume' });
  }

  /** Ask where an own group can go (DEC-20); not queued: a stale question is worth nothing. */
  queryReach(group: string): void {
    if (this.#status === 'ready') this.#write({ type: 'reach_query', group });
  }

  /** Stop for good: no more reconnects. Unacknowledged commands are dropped. */
  close(): void {
    this.#unhook?.();
    this.#unhook = null;
    this.#teardown();
    this.#pending.clear();
    this.#setStatus('idle');
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#opts.handlers.onStatus?.(status);
  }

  #open(): void {
    this.#paused = false;
    this.#setStatus('connecting');
    const location = this.#opts.location ?? globalThis.location;
    const url = matchSocketUrl(this.#opts.matchId, location);
    const socket = (this.#opts.createSocket ?? ((u) => new WebSocket(u)))(url);
    this.#socket = socket;
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      // The token travels in the first message only, never in the URL.
      this.#write({
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        token: this.#opts.token,
      });
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.#socket === socket) this.#onFrame(event.data);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.#socket === socket) this.#onClose(event.code);
    };
  }

  #write(msg: ClientMsg): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(encodeClientMsg(msg));
  }

  #onFrame(frame: unknown): void {
    this.#lastFrameAt = this.#now();
    const msg = decodeServerMsg(frame);
    if (msg === null) {
      this.#opts.handlers.onInvalidFrame?.();
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.#onWelcome(msg.last_seq);
        break;
      case 'ack':
        this.#pending.delete(msg.seq);
        break;
      case 'paused':
        this.#paused = msg.paused;
        break;
      case 'pong': {
        const sentAt = this.#pingSentAt.get(msg.id);
        if (sentAt !== undefined) {
          this.#pingSentAt.delete(msg.id);
          this.#opts.handlers.onRtt?.(this.#now() - sentAt);
        }
        return;
      }
      case 'match_end':
        this.#teardown();
        this.#pending.clear();
        this.#setStatus('ended');
        break;
      default:
        break;
    }
    this.#opts.handlers.onMessage(msg);
  }

  #onWelcome(lastSeq: number): void {
    this.#attempt = 0;
    this.#noMatch = 0;
    // A fresh page starts numbering at 1; keep seq strictly increasing for this token.
    this.#nextSeq = Math.max(this.#nextSeq, lastSeq + 1);
    for (const seq of [...this.#pending.keys()]) {
      if (seq <= lastSeq) {
        // The server has accepted it already (dedup by seq); only the ack was lost.
        this.#pending.delete(seq);
        this.#opts.handlers.onAckLost?.(seq);
      }
    }
    this.#setStatus('ready');
    for (const msg of this.#pending.values()) this.#write(msg);
    this.#startPing();
  }

  /**
   * Is the link alive? A dead one is closed on this side and goes the normal reconnect path:
   * `close` of the browser may come minutes later.
   */
  #checkAlive(): void {
    if (this.#status !== 'ready') return;
    const silent = !this.#paused && this.#now() - this.#lastFrameAt > this.#deadAfterMs;
    if (silent || this.#pingSentAt.size >= 2) this.#onClose(CLOSE_ABNORMAL);
  }

  /** `online` and a visible tab: reconnect now instead of at the end of the backoff, or look at the link. */
  readonly #wake = (): void => {
    switch (this.#status) {
      case 'reconnecting':
        clearTimeout(this.#retryTimer);
        this.#retryTimer = undefined;
        this.#open();
        break;
      case 'failed':
        this.retry();
        break;
      case 'ready':
        this.#checkAlive();
        break;
      default:
        break;
    }
  };

  #hookPage(): void {
    const page = this.#opts.page === undefined ? pageOf(globalThis) : this.#opts.page;
    if (page === null) return;
    const onVisible = (): void => {
      if (page.document.visibilityState === 'visible') this.#wake();
    };
    page.window.addEventListener('online', this.#wake);
    page.document.addEventListener('visibilitychange', onVisible);
    this.#unhook = () => {
      page.window.removeEventListener('online', this.#wake);
      page.document.removeEventListener('visibilitychange', onVisible);
    };
  }

  #startPing(): void {
    this.#stopPing();
    this.#lastFrameAt = this.#now();
    this.#watchdog = setInterval(() => {
      this.#checkAlive();
    }, this.#watchdogMs);
    this.#pingTimer = setInterval(() => {
      // Two pings without a pong: the pong of the first would have come long ago.
      this.#checkAlive();
      if (this.#status !== 'ready') return;
      const id = this.#nextPingId++;
      this.#pingSentAt.set(id, this.#now());
      this.#write({ type: 'ping', id });
    }, this.#pingMs);
  }

  #stopPing(): void {
    clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
    clearInterval(this.#watchdog);
    this.#watchdog = undefined;
    this.#pingSentAt.clear();
  }

  #onClose(code: number): void {
    this.#teardown();
    this.#opts.handlers.onReset?.();
    if (code === CLOSE_PROTOCOL_VERSION) {
      this.#setStatus('version_mismatch');
      return;
    }
    if (code === CLOSE_REPLACED) {
      this.#pending.clear();
      this.#setStatus('replaced');
      return;
    }
    if (code === CLOSE_POLICY) {
      // Not a drop of the link: a retry would be refused the same way.
      this.#setStatus('failed');
      return;
    }
    this.#noMatch = code === CLOSE_NO_MATCH ? this.#noMatch + 1 : 0;
    if (this.#noMatch > this.#noMatchRetries) {
      this.#pending.clear();
      this.#setStatus('gone');
      return;
    }
    if (this.#attempt >= this.#maxAttempts) {
      this.#setStatus('failed');
      return;
    }
    this.#setStatus('reconnecting');
    const delay = backoffDelay(this.#attempt++, this.#baseMs, this.#maxMs, this.#random());
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#open();
    }, delay);
  }

  #teardown(): void {
    this.#stopPing();
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }
}
