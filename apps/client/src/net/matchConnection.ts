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
  /** In [0, 1); the delay is spread over [50%, 100%] of its nominal value. */
  random?: () => number;
  /** Monotonic clock in ms. */
  now?: () => number;
}

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

export class MatchConnection {
  readonly #opts: MatchConnectionOptions;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #pingMs: number;
  readonly #random: () => number;
  readonly #now: () => number;

  #status: ConnectionStatus = 'idle';
  #socket: WebSocket | null = null;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #pingTimer: ReturnType<typeof setInterval> | undefined;

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
    this.#open();
  }

  /** Queue a command and send it when the connection is ready. Returns its `seq`. */
  send(cmd: Command): number {
    const seq = this.#nextSeq++;
    const msg: ClientMsg = { type: 'command', seq, cmd };
    this.#pending.set(seq, msg);
    if (this.#status === 'ready') this.#write(msg);
    return seq;
  }

  /** Ask the server for a full snapshot (after a gap in snapshots). */
  resync(): void {
    if (this.#status !== 'ready') return;
    this.#opts.handlers.onReset?.();
    this.#write({ type: 'resync' });
  }

  /** Stop for good: no more reconnects. Unacknowledged commands are dropped. */
  close(): void {
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

  #startPing(): void {
    this.#stopPing();
    this.#pingTimer = setInterval(() => {
      const id = this.#nextPingId++;
      this.#pingSentAt.set(id, this.#now());
      this.#write({ type: 'ping', id });
    }, this.#pingMs);
  }

  #stopPing(): void {
    clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
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
