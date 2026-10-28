import { describe, expect, it } from 'vitest';
import { describeError, installErrorLog } from './errorLog.ts';

describe('describeError', () => {
  it('writes the name and the message, not the object', () => {
    expect(describeError(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ token: 'a'.repeat(40) })).toBe('a non-error value was thrown');
  });

  it('cuts out what can be a token and keeps the line short', () => {
    const token = 'tK3_-Zq9'.repeat(6);
    const line = describeError(new Error(`bad hello with ${token} in it`));
    expect(line).not.toContain(token);
    expect(line).toContain('[cut]');
    expect(describeError(new Error('x '.repeat(500))).length).toBeLessThanOrEqual(300);
  });
});

describe('installErrorLog', () => {
  it('logs an uncaught error and an unhandled rejection, and stops when told to', () => {
    const lines: string[] = [];
    // Not the jsdom window: it would report the dispatched errors to the test runner as well.
    const page = new EventTarget() as unknown as Window;
    const stop = installErrorLog(page, (line) => lines.push(line));
    page.dispatchEvent(new ErrorEvent('error', { error: new Error('render broke') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('late') });
    page.dispatchEvent(rejection);
    expect(lines).toEqual([
      '[client] uncaught error: Error: render broke',
      '[client] unhandled rejection: Error: late',
    ]);
    stop();
    page.dispatchEvent(new ErrorEvent('error', { error: new Error('again') }));
    expect(lines).toHaveLength(2);
  });
});
