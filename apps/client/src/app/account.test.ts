import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http.ts';
import { setLocale } from '../i18n/index.ts';
import { failureText, loginFailure, passwordFailure, passwordLengthOk } from './account.ts';

describe('passwordLengthOk', () => {
  it.each([
    [9, false],
    [10, true],
    [128, true],
    [129, false],
  ])('%i characters: %j (10..128)', (length, ok) => {
    expect(passwordLengthOk('a'.repeat(length))).toBe(ok);
  });

  it('counts characters, not UTF-16 units, after NFKC like the server', () => {
    // 5 emoji are 10 UTF-16 units but 5 characters.
    expect(passwordLengthOk('\u{1F600}'.repeat(5))).toBe(false);
    expect(passwordLengthOk('\u{1F600}'.repeat(10))).toBe(true);
    // The ligature U+FB01 becomes the two letters "fi": 5 of them are 10 characters.
    expect(passwordLengthOk('ﬁ'.repeat(5))).toBe(true);
  });
});

describe('failures', () => {
  it('login: 401 is one message for a wrong nick and a wrong password', () => {
    expect(loginFailure(new ApiError('unauthorized', 401))).toEqual({
      key: 'error.account.wrongLogin',
    });
  });

  it('login: blocked, conflict and network keep the general messages', () => {
    expect(loginFailure(new ApiError('blocked', 403))).toEqual({ key: 'error.api.blocked' });
    expect(loginFailure(new ApiError('network', 0))).toEqual({ key: 'error.api.network' });
    expect(loginFailure(new Error('boom'))).toEqual({ key: 'error.api.network' });
  });

  it('password: 422 is the length rule, 403 wrong password, 403 blocked', () => {
    expect(passwordFailure(new ApiError('invalid', 422))).toEqual({
      key: 'error.account.passwordLength',
    });
    expect(passwordFailure(new ApiError('wrong_password', 403))).toEqual({
      key: 'error.api.wrong_password',
    });
    expect(passwordFailure(new ApiError('blocked', 403))).toEqual({ key: 'error.api.blocked' });
  });

  it('429 names the wait in whole minutes, rounded up, when Retry-After came', () => {
    expect(loginFailure(new ApiError('rate_limited', 429, 540))).toEqual({
      key: 'error.account.rateLimitedWait',
      minutes: 9,
    });
    expect(passwordFailure(new ApiError('rate_limited', 429, 61))).toEqual({
      key: 'error.account.rateLimitedWait',
      minutes: 2,
    });
    expect(passwordFailure(new ApiError('rate_limited', 429, 5))).toEqual({
      key: 'error.account.rateLimitedWait',
      minutes: 1,
    });
    expect(loginFailure(new ApiError('rate_limited', 429))).toEqual({
      key: 'error.account.rateLimited',
    });
  });

  it('writes the wait into the text', () => {
    setLocale('en');
    expect(failureText({ key: 'error.account.rateLimitedWait', minutes: 9 })).toBe(
      'Too many attempts. Try again in 9 min.',
    );
    expect(failureText({ key: 'error.account.wrongLogin' })).toBe('Wrong nick or password.');
  });
});
