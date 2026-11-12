import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_VERSION,
  Diagnostics,
  FLUSH_MS,
  MAX_ENTRIES,
  consoleText,
  installDiagnostics,
  watchFrames,
  type ClientReport,
} from './diagnostics.ts';
import { markProblem, markToast } from './hud/markProblem.ts';

/** Diagnostics on a fake clock, a fake timer and a fake server. */
function setup(hiddenAt: (now: number) => boolean = () => false) {
  let now = 0;
  const sent: { report: ClientReport; urgent: boolean }[] = [];
  let timer: { run: () => void; at: number } | null = null;
  let accept = true;
  const diag = new Diagnostics({
    now: () => now,
    hidden: () => hiddenAt(now),
    send: (report, urgent) => {
      sent.push({ report, urgent });
      return Promise.resolve(accept);
    },
    setTimer: (run, ms) => {
      timer = { run, at: now + ms };
      return timer;
    },
    clearTimer: (cleared) => {
      if (cleared === timer) timer = null;
    },
  });
  diag.enabled = true;
  diag.echo = () => undefined;
  const advance = (ms: number): void => {
    now += ms;
    if (timer !== null && now >= timer.at) {
      const due = timer;
      timer = null;
      due.run();
    }
  };
  return {
    diag,
    sent,
    advance,
    at: () => now,
    refuse: () => {
      accept = false;
    },
  };
}

describe('Diagnostics: batches', () => {
  it('sends one batch 10 s after its first entry, with the match, the tick and the version', () => {
    const { diag, sent, advance } = setup();
    diag.setMatch('42');
    diag.snapshot(120);
    advance(1000);
    diag.record('error', '[client] uncaught error: TypeError: x');
    advance(2000);
    diag.record('warn', '[client] command refused: move NOT_ENOUGH_CP');
    advance(FLUSH_MS - 2001);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.urgent).toBe(false);
    expect(sent[0]?.report).toEqual({
      reason: 'batch',
      match_id: '42',
      tick: 120,
      client_version: CLIENT_VERSION,
      dropped: 0,
      entries: [
        {
          kind: 'error',
          msg: '[client] uncaught error: TypeError: x',
          count: 1,
          hidden: false,
          t_ms: 1000,
          tick: 120,
        },
        {
          kind: 'warn',
          msg: '[client] command refused: move NOT_ENOUGH_CP',
          count: 1,
          hidden: false,
          t_ms: 3000,
          tick: 120,
        },
      ],
    });
    // Nothing new: nothing more goes.
    advance(FLUSH_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it('counts a repeated error on one entry instead of sending it again', () => {
    const { diag, sent, advance } = setup();
    for (let i = 0; i < 25; i++) diag.record('error', 'map frame failed TypeError: y');
    diag.record('error', 'screen failed Error: z');
    advance(FLUSH_MS);
    const entries = sent[0]?.report.entries ?? [];
    expect(entries.map((entry) => [entry.msg, entry.count])).toEqual([
      ['map frame failed TypeError: y', 25],
      ['screen failed Error: z', 1],
    ]);
  });

  it('keeps at most 50 different entries a batch and counts the rest', () => {
    const { diag, sent, advance } = setup();
    for (let i = 0; i < MAX_ENTRIES + 7; i++) diag.record('warn', `warning ${String(i)}`);
    diag.record('warn', 'warning 3');
    advance(FLUSH_MS);
    expect(sent[0]?.report.entries).toHaveLength(MAX_ENTRIES);
    expect(sent[0]?.report.dropped).toBe(7);
    expect(sent[0]?.report.entries?.[3]?.count).toBe(2);
  });

  it('cuts out what can be a token and keeps a message short', () => {
    const { diag, sent, advance } = setup();
    const token = 'tK3_-Zq9'.repeat(6);
    diag.record('error', `hello refused for ${token}`);
    diag.record('warn', 'w'.repeat(1000));
    advance(FLUSH_MS);
    const [first, second] = sent[0]?.report.entries ?? [];
    expect(first?.msg).toBe('hello refused for [cut]');
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(second?.msg.length).toBeLessThanOrEqual(300);
  });

  it('sends the batch of a match before it names the next one', () => {
    const { diag, sent } = setup();
    diag.setMatch('7');
    diag.record('error', 'boom');
    diag.setMatch(null);
    expect(sent.map(({ report }) => report.match_id)).toEqual(['7']);
  });

  it('keeps nothing while it is off (tests, the dev screens)', () => {
    const { diag, sent, advance } = setup();
    diag.enabled = false;
    diag.record('error', 'boom');
    diag.frame(0);
    diag.frame(900);
    advance(FLUSH_MS);
    diag.flush();
    expect(sent).toEqual([]);
  });
});

describe('Diagnostics: stalls and gaps', () => {
  it('reports a frame more than 200 ms after the one before, the longest one of a batch', () => {
    const { diag, sent, advance } = setup();
    diag.frame(0);
    diag.frame(16);
    diag.frame(216); // 200 ms: not yet a stall
    diag.frame(1016); // 800 ms
    diag.frame(1032);
    diag.frame(1332); // 300 ms
    advance(FLUSH_MS);
    expect(sent[0]?.report.entries).toEqual([
      { kind: 'stall', msg: 'long frame', count: 2, hidden: false, ms: 800, t_ms: 0, tick: null },
    ]);
  });

  it('does not count the frames a hidden tab never got', () => {
    const { diag, sent, advance, at } = setup();
    diag.frame(0);
    advance(1000);
    diag.visibility(); // hidden
    advance(4000);
    diag.visibility(); // shown again
    diag.frame(at());
    diag.flush();
    expect(sent).toEqual([]);
    // Later stalls count again.
    advance(10_000);
    diag.frame(at());
    diag.frame(at() + 500);
    diag.flush();
    expect(sent[0]?.report.entries?.[0]?.ms).toBe(500);
  });

  it('starts a new count after the frames stopped', () => {
    const { diag, sent } = setup();
    diag.frame(0);
    diag.endFrames();
    diag.frame(5000);
    diag.flush();
    expect(sent).toEqual([]);
  });

  it('writes a snapshot gap to the console and reports it, flagged when the tab was hidden', () => {
    let hidden = false;
    const { diag, sent } = setup(() => hidden);
    const lines: string[] = [];
    diag.echo = (line) => lines.push(line);
    diag.gap(2500);
    hidden = true;
    diag.gap(4000);
    diag.flush();
    expect(lines).toEqual([
      '[client] snapshot gap 2500 ms',
      '[client] snapshot gap 4000 ms (tab hidden)',
    ]);
    expect(sent[0]?.report.entries?.map((entry) => [entry.kind, entry.ms, entry.hidden])).toEqual([
      ['gap', 2500, false],
      ['gap', 4000, true],
    ]);
  });

  it('reports a WebSocket close, not the normal one', () => {
    const { diag, sent } = setup();
    diag.wsClose(1000, 'match over');
    diag.wsClose(1006, 'silent link');
    diag.wsClose(1011);
    diag.flush();
    expect(sent[0]?.report.entries?.map((entry) => entry.msg)).toEqual([
      'close 1006 silent link',
      'close 1011',
    ]);
  });
});

describe('Diagnostics: the mark', () => {
  it('sends the last minute at once: its entries and a timeline of 60 seconds', async () => {
    const { diag, sent, advance, at } = setup();
    diag.setMatch('42');
    diag.record('error', 'old one');
    advance(FLUSH_MS);
    advance(30_000);
    // A second of 10 snapshots and 60 frames, then a stall of 900 ms.
    for (let i = 0; i < 60; i++) {
      diag.frame(at());
      if (i % 6 === 0) diag.snapshot(100 + i / 6);
      advance(16);
    }
    advance(900 - 16);
    diag.frame(at());
    advance(40_000);
    const result = await diag.mark();
    expect(result).toEqual({ sent: true, tick: 109 });
    const mark = sent.at(-1)?.report;
    expect(mark?.reason).toBe('mark');
    expect(mark?.match_id).toBe('42');
    // The error of a minute and more ago is not in it, the stall is.
    expect(mark?.entries?.map((entry) => entry.msg)).toEqual(['long frame']);
    const seconds = mark?.seconds ?? [];
    expect(seconds).toHaveLength(60);
    expect(seconds.reduce((sum, second) => sum + second.snapshots, 0)).toBe(10);
    expect(seconds.reduce((sum, second) => sum + second.frames, 0)).toBe(60);
    expect(Math.max(...seconds.map((second) => second.frame_max_ms))).toBe(900);
    // The last second is the one of the key.
    expect(seconds.at(-1)).toEqual({ frames: 0, frame_max_ms: 0, snapshots: 0, hidden: false });
  });

  it('takes the batch along, so it is not sent twice', async () => {
    const { diag, sent, advance } = setup();
    diag.record('error', 'boom');
    await diag.mark();
    advance(FLUSH_MS * 2);
    expect(sent.map(({ report }) => report.reason)).toEqual(['mark']);
    expect(sent[0]?.report.entries?.map((entry) => entry.msg)).toEqual(['boom']);
  });

  it('says when the server did not take it', async () => {
    const { diag, refuse } = setup();
    refuse();
    expect(await diag.mark()).toEqual({ sent: false, tick: null });
  });

  it('shows a toast with the tick, or a warning when it failed', async () => {
    const toasts: unknown[] = [];
    const push = (body: unknown): void => {
      toasts.push(body);
    };
    await markProblem({ push }, { mark: () => Promise.resolve({ sent: true, tick: 1234 }) });
    await markProblem({ push }, { mark: () => Promise.resolve({ sent: false, tick: 1234 }) });
    expect(toasts).toEqual([
      markToast(true, 1234),
      { tone: 'warn', icon: 'alert', text: expect.stringContaining('did not reach') as unknown },
    ]);
    expect(markToast(true, 1234).text).toContain('tick 1234');
    expect(markToast(true, null).text).not.toContain('tick');
  });
});

describe('installDiagnostics', () => {
  it('keeps the console errors and warnings, still writes them, and stops when told to', () => {
    const { diag, sent } = setup();
    diag.enabled = false;
    const written: unknown[][] = [];
    const target = {
      error: (...args: unknown[]) => written.push(['error', ...args]),
      warn: (...args: unknown[]) => written.push(['warn', ...args]),
    };
    const page = new EventTarget() as EventTarget & { document: EventTarget };
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    Object.assign(page, { document });
    const stop = installDiagnostics(
      diag,
      page as unknown as Parameters<typeof installDiagnostics>[1],
      target,
    );
    target.error('screen failed', new TypeError('x is undefined'));
    target.warn('[client] command lost: recruit');
    diag.gap(1500);
    expect(written).toEqual([
      ['error', 'screen failed', new TypeError('x is undefined')],
      ['warn', '[client] command lost: recruit'],
      ['warn', '[client] snapshot gap 1500 ms'],
    ]);
    // A closing page sends at once.
    page.dispatchEvent(new Event('pagehide'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.urgent).toBe(true);
    expect(sent[0]?.report.entries?.map((entry) => [entry.kind, entry.msg])).toEqual([
      ['error', 'screen failed TypeError: x is undefined'],
      ['warn', '[client] command lost: recruit'],
      ['gap', 'snapshot gap'],
    ]);
    // A hidden tab too.
    target.error('again');
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toHaveLength(2);
    stop();
    target.error('after');
    diag.flush();
    expect(sent).toHaveLength(2);
    expect(written.at(-1)).toEqual(['error', 'after']);
  });

  it('describes the arguments of a console call without the objects', () => {
    expect(consoleText(['map frame failed', new RangeError('bad'), 3, true, { token: 'x' }])).toBe(
      'map frame failed RangeError: bad 3 true [object]',
    );
  });
});

describe('watchFrames', () => {
  it('counts every animation frame until stopped', () => {
    const { diag, sent } = setup();
    const queue: ((at: number) => void)[] = [];
    const cancel = vi.fn();
    const stop = watchFrames(diag, (run) => queue.push(run), cancel);
    const tick = (at: number): void => {
      const run = queue.shift();
      run?.(at);
    };
    tick(0);
    tick(16);
    tick(700);
    stop();
    expect(cancel).toHaveBeenCalledOnce();
    tick(5000);
    diag.flush();
    expect(sent[0]?.report.entries?.map((entry) => entry.ms)).toEqual([684]);
  });

  it('does not run while the diagnostics are off', () => {
    const { diag } = setup();
    diag.enabled = false;
    const request = vi.fn(() => 1);
    watchFrames(diag, request, vi.fn())();
    expect(request).not.toHaveBeenCalled();
  });
});
