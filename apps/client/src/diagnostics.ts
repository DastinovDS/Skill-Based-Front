/**
 * Client diagnostics for the server log (#810). Plain TypeScript, no Svelte state.
 *
 * What is kept: every console error and warning of the page (an uncaught error and an unhandled
 * rejection through `errorLog.ts`, a screen that failed in `CrashGuard`, a map frame that failed in
 * `FrameGuard`, a refused command), a frame more than 200 ms after the one before (`stall`), no
 * snapshot for more than 1 s (`gap`, with the flag `hidden` when the tab was hidden meanwhile) and
 * a close of the match WebSocket other than the normal one (`ws_close`).
 *
 * How it is sent: the same kind and message within a batch is one entry with a count; a batch goes
 * to `POST /api/client-log` 10 s after its first entry, or at once when the tab is hidden or the
 * page closes (`keepalive`). The "mark problem" key (`mark()`, `F8` by default) sends a dump right
 * away: the entries of the last 60 s and a timeline of the last 60 seconds (frames, the longest
 * frame, snapshots, a hidden tab). A report goes only with the saved token of the player; it is
 * never retried, and nothing is kept in the browser beyond the memory of the page.
 *
 * Every text is cut to 300 characters and whatever looks like a token is cut out
 * (`errorLog.cutSecrets`); the server does it again.
 */
import type { components } from './api.gen.ts';
import { loadGuest } from './api/guestStore.ts';
import { Api } from './api/http.ts';
import { cutSecrets } from './errorLog.ts';
import { PROTOCOL_VERSION } from './protocol.gen.ts';

type Schemas = components['schemas'];
export type ClientReport = Schemas['ClientReport'];
export type ClientEntry = Schemas['ClientEntry'];
export type ClientSecond = Schemas['ClientSecond'];
export type DiagKind = ClientEntry['kind'];

/** A frame this long after the one before is a stall of the page. */
export const LONG_FRAME_MS = 200;
/** A batch goes this long after its first entry. */
export const FLUSH_MS = 10_000;
/** Different entries of one batch (the server's cap); more are only counted. */
export const MAX_ENTRIES = 50;
/** A mark carries this many seconds of the past (the timeline and the entries). */
export const MARK_SECONDS = 60;
/** The normal close of the match WebSocket (the match ended): not a problem. */
const CLOSE_NORMAL = 1000;

/** The version the reports name: the protocol version the client was built with. */
export const CLIENT_VERSION = `p${String(PROTOCOL_VERSION)}`;

export interface DiagnosticsOptions {
  /** The page clock in ms (`performance.now`, the clock of the frames). */
  readonly now?: () => number;
  /** The tab is hidden now. */
  readonly hidden?: () => boolean;
  /** Sends a report; `true` when the server took it. `urgent`: the page may be closing. */
  readonly send?: (report: ClientReport, urgent: boolean) => Promise<boolean>;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

interface Second {
  frames: number;
  frameMax: number;
  snapshots: number;
  hidden: boolean;
}

/** A report with the saved token of the player; `false` without one or when it did not get through. */
export async function sendReport(report: ClientReport, urgent: boolean): Promise<boolean> {
  let token: string | undefined;
  try {
    token = loadGuest(() => window.localStorage)?.token;
  } catch {
    token = undefined;
  }
  if (token === undefined) return false;
  return new Api().clientLog(token, report, urgent);
}

export class Diagnostics {
  /** Off (tests, the dev screens): nothing is kept or sent; `install` turns it on. */
  enabled = false;
  /** Where a line the diagnostics write themselves goes (the snapshot gap): the console. */
  echo: (line: string) => void = (line) => {
    console.warn(line);
  };

  readonly #now: () => number;
  readonly #hidden: () => boolean;
  readonly #send: (report: ClientReport, urgent: boolean) => Promise<boolean>;
  readonly #setTimer: (run: () => void, ms: number) => unknown;
  readonly #clearTimer: (timer: unknown) => void;

  #pending: ClientEntry[] = [];
  #dropped = 0;
  /** The last entries, sent or not, for a mark. */
  #recent: ClientEntry[] = [];
  /** The timeline: seconds of the page clock -> what happened in them. */
  readonly #seconds = new Map<number, Second>();
  #matchId: string | null = null;
  #tick: number | null = null;
  #lastFrame: number | null = null;
  /** When the tab was last hidden or shown. */
  #visibilityAt = -Infinity;
  #timer: unknown = null;

  constructor(options: DiagnosticsOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#hidden =
      options.hidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
    this.#send = options.send ?? sendReport;
    this.#setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.#clearTimer =
      options.clearTimer ??
      ((timer) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
  }

  /** The match the page is in (`null`: none). What was kept of the previous one goes first. */
  setMatch(matchId: string | null): void {
    if (matchId === this.#matchId) return;
    this.flush();
    this.#matchId = matchId;
    this.#tick = null;
    this.#recent = [];
    this.#seconds.clear();
    this.#lastFrame = null;
  }

  /** Something to report; the same kind and message again counts on the entry of the batch. */
  record(kind: DiagKind, message: string, ms?: number, hidden = false): void {
    if (!this.enabled) return;
    const msg = cutSecrets(message);
    const same = this.#pending.find(
      (entry) => entry.kind === kind && entry.msg === msg && entry.hidden === hidden,
    );
    if (same !== undefined) {
      same.count += 1;
      if (ms !== undefined) same.ms = Math.max(same.ms ?? 0, Math.round(ms));
    } else if (this.#pending.length >= MAX_ENTRIES) {
      this.#dropped += 1;
    } else {
      const entry: ClientEntry = {
        kind,
        msg,
        count: 1,
        hidden,
        t_ms: Math.max(0, Math.round(this.#now())),
        tick: this.#tick,
        ...(ms === undefined ? {} : { ms: Math.round(ms) }),
      };
      this.#pending.push(entry);
      this.#recent.push(entry);
      if (this.#recent.length > MAX_ENTRIES) this.#recent.shift();
    }
    if (this.#timer === null) {
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        this.flush();
      }, FLUSH_MS);
    }
  }

  /** A snapshot of tick `tick` arrived. */
  snapshot(tick: number): void {
    this.#tick = tick;
    if (this.enabled) this.#second(this.#now()).snapshots += 1;
  }

  /** No snapshot for `ms` (the session measures it): the console line, and an entry. */
  gap(ms: number): void {
    const hidden = this.#hiddenWithin(ms);
    this.echo(
      `[client] snapshot gap ${String(Math.round(ms))} ms${hidden ? ' (tab hidden)' : ''}`,
    );
    this.record('gap', 'snapshot gap', ms, hidden);
  }

  /** A frame started at `at` (the `requestAnimationFrame` time, the page clock). */
  frame(at: number = this.#now()): void {
    if (!this.enabled) return;
    const last = this.#lastFrame;
    this.#lastFrame = at;
    if (last === null) return;
    const ms = at - last;
    const second = this.#second(at);
    second.frames += 1;
    second.frameMax = Math.max(second.frameMax, Math.round(ms));
    // A hidden tab gets no frames at all: that wait is the browser's, not a stall.
    if (ms > LONG_FRAME_MS && !this.#hiddenWithin(ms)) this.record('stall', 'long frame', ms);
  }

  /** The frames stopped (the match screen left): the next one starts a new count. */
  endFrames(): void {
    this.#lastFrame = null;
  }

  /** The tab was hidden or shown. */
  visibility(): void {
    const now = this.#now();
    this.#visibilityAt = now;
    if (this.enabled) this.#second(now);
  }

  /** The match WebSocket closed with `code` (a link found dead on this side: `reason` says so). */
  wsClose(code: number, reason = ''): void {
    if (code === CLOSE_NORMAL) return;
    this.record('ws_close', reason === '' ? `close ${String(code)}` : `close ${String(code)} ${reason}`);
  }

  /** Send the batch now (`urgent`: the page may be closing). */
  flush(urgent = false): void {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    if (this.#pending.length === 0 && this.#dropped === 0) return;
    const report = this.#report('batch', this.#pending);
    this.#pending = [];
    this.#dropped = 0;
    void this.#send(report, urgent).catch(() => false);
  }

  /**
   * The "mark problem" key: the entries and the timeline of the last minute go now, the batch with
   * them. `sent`: the server took it; `tick`: the tick the mark names.
   */
  async mark(): Promise<{ readonly sent: boolean; readonly tick: number | null }> {
    const tick = this.#tick;
    if (!this.enabled) return { sent: false, tick };
    const now = this.#now();
    const since = now - MARK_SECONDS * 1000;
    const entries = this.#recent.filter((entry) => entry.t_ms >= since);
    const last = Math.floor(now / 1000);
    const seconds: ClientSecond[] = [];
    for (let at = last - MARK_SECONDS + 1; at <= last; at++) {
      const second = this.#seconds.get(at);
      seconds.push({
        frames: second?.frames ?? 0,
        frame_max_ms: second?.frameMax ?? 0,
        snapshots: second?.snapshots ?? 0,
        hidden: second?.hidden ?? false,
      });
    }
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    const report = { ...this.#report('mark', entries), seconds };
    this.#pending = [];
    this.#dropped = 0;
    const sent = await this.#send(report, false).catch(() => false);
    return { sent, tick };
  }

  #report(reason: ClientReport['reason'], entries: readonly ClientEntry[]): ClientReport {
    return {
      reason,
      match_id: this.#matchId,
      tick: this.#tick,
      client_version: CLIENT_VERSION,
      entries: entries.map((entry) => ({ ...entry })),
      dropped: this.#dropped,
    };
  }

  #hiddenWithin(ms: number): boolean {
    return this.#hidden() || this.#visibilityAt >= this.#now() - ms;
  }

  /** The second of `at`, made when new; seconds older than a mark needs are let go. */
  #second(at: number): Second {
    const key = Math.floor(at / 1000);
    let second = this.#seconds.get(key);
    if (second === undefined) {
      second = { frames: 0, frameMax: 0, snapshots: 0, hidden: false };
      this.#seconds.set(key, second);
      for (const old of this.#seconds.keys()) {
        if (old <= key - MARK_SECONDS) this.#seconds.delete(old);
      }
    }
    if (this.#hidden()) second.hidden = true;
    return second;
  }
}

/** The one instance of the page. */
export const diagnostics = new Diagnostics();

/** The text of a console call: strings as they are, an error by its name and message. */
export function consoleText(args: readonly unknown[]): string {
  return args
    .map((arg) =>
      arg instanceof Error
        ? `${arg.name}: ${arg.message}`
        : typeof arg === 'string'
          ? arg
          : typeof arg === 'number' || typeof arg === 'boolean'
            ? String(arg)
            : `[${typeof arg}]`,
    )
    .join(' ');
}

/**
 * Turns the diagnostics on for the page: the console errors and warnings are kept as well as
 * written, a hidden tab and a closing page send the batch at once. Returns the function that
 * stops it all.
 */
export function installDiagnostics(
  diag: Diagnostics,
  page: Pick<Window, 'addEventListener' | 'removeEventListener'> & {
    readonly document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  },
  target: Pick<Console, 'error' | 'warn'> = console,
): () => void {
  const { error, warn } = target;
  diag.enabled = true;
  diag.echo = (line) => {
    warn.call(target, line);
  };
  target.error = (...args: unknown[]) => {
    error.apply(target, args);
    diag.record('error', consoleText(args));
  };
  target.warn = (...args: unknown[]) => {
    warn.apply(target, args);
    diag.record('warn', consoleText(args));
  };
  const onVisibility = (): void => {
    diag.visibility();
    if (page.document.visibilityState === 'hidden') diag.flush(true);
  };
  const onHide = (): void => {
    diag.flush(true);
  };
  page.document.addEventListener('visibilitychange', onVisibility);
  page.addEventListener('pagehide', onHide);
  return () => {
    target.error = error;
    target.warn = warn;
    diag.enabled = false;
    page.document.removeEventListener('visibilitychange', onVisibility);
    page.removeEventListener('pagehide', onHide);
  };
}

/** Counts the frames of the page into `diag` until the returned function stops it (a match screen). */
export function watchFrames(
  diag: Diagnostics,
  request: (run: (at: number) => void) => number = (run) => requestAnimationFrame(run),
  cancel: (id: number) => void = (id) => {
    cancelAnimationFrame(id);
  },
): () => void {
  if (!diag.enabled) return () => undefined;
  let running = true;
  let id = 0;
  const step = (at: number): void => {
    if (!running) return;
    diag.frame(at);
    id = request(step);
  };
  id = request(step);
  return () => {
    running = false;
    cancel(id);
    diag.endFrames();
  };
}
