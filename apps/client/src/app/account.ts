/**
 * The account forms (#374): the password rules the forms check before asking the server, and the
 * UI string for each way a login, a registration or a password change can fail. Plain TypeScript.
 */
import { ApiError } from '../api/http.ts';
import { apiErrorKey } from './apiErrors.ts';
import { tf, t, type MessageKey } from '../i18n/index.ts';

/** The password length the server accepts, in characters after NFKC (`POST /api/account/password`). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Same count as the server: characters (not UTF-16 units) of the NFKC form. */
export function passwordLengthOk(password: string): boolean {
  const length = Array.from(password.normalize('NFKC')).length;
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX;
}

/** The nick rule of the server (`gow_server.nicks`): 3 to 16 characters, letters, digits, _ and -. */
export const NICK_MIN = 3;
export const NICK_MAX = 16;
const NICK_CHARS = /^[\p{L}\p{N}_-]*$/u;

/**
 * What the form says before asking the server: the characters and the length. The server checks
 * the rest (one script, reserved names, taken) and answers `invalid` or `conflict`.
 */
export function nickProblem(nick: string): MessageKey | null {
  if (!NICK_CHARS.test(nick)) return 'welcome.error.chars';
  return Array.from(nick).length < NICK_MIN ? 'welcome.error.short' : null;
}

/** Why a form action failed: a string key, and the wait for a 429 that named one. */
export interface AccountFailure {
  readonly key: MessageKey;
  /** Whole minutes, rounded up, from `Retry-After`; only with `error.account.rateLimitedWait`. */
  readonly minutes?: number;
  /** Whole hours, rounded up; only with `error.account.nickLimitedHours`. */
  readonly hours?: number;
}

const HOUR_S = 3600;

/** `PUT /api/me/nick`: taken, refused by the rules, or past the few changes a day (MOD-01). */
export function nickFailure(error: unknown): AccountFailure {
  if (error instanceof ApiError) {
    if (error.code === 'conflict') return { key: 'welcome.error.taken' };
    if (error.code === 'invalid') return { key: 'welcome.error.invalid' };
    if (error.code === 'rate_limited') {
      const wait = error.retryAfterS;
      if (wait === null) return { key: 'error.account.nickLimited' };
      if (wait > HOUR_S) {
        return { key: 'error.account.nickLimitedHours', hours: Math.ceil(wait / HOUR_S) };
      }
      return { key: 'error.account.rateLimitedWait', minutes: Math.ceil(wait / 60) };
    }
  }
  return { key: apiErrorKey(error) };
}

function rateLimited(error: ApiError): AccountFailure {
  if (error.retryAfterS === null) return { key: 'error.account.rateLimited' };
  return { key: 'error.account.rateLimitedWait', minutes: Math.ceil(error.retryAfterS / 60) };
}

/** `POST /api/login`: 401 is a wrong nick or password alike (the server does not tell which). */
export function loginFailure(error: unknown): AccountFailure {
  if (error instanceof ApiError) {
    if (error.code === 'unauthorized') return { key: 'error.account.wrongLogin' };
    if (error.code === 'rate_limited') return rateLimited(error);
  }
  return { key: apiErrorKey(error) };
}

/** `POST /api/account/password` and the registration that ends with it. */
export function passwordFailure(error: unknown): AccountFailure {
  if (error instanceof ApiError) {
    if (error.code === 'invalid') return { key: 'error.account.passwordLength' };
    if (error.code === 'rate_limited') return rateLimited(error);
  }
  return { key: apiErrorKey(error) };
}

export function failureText(failure: AccountFailure): string {
  if (failure.hours !== undefined) return tf(failure.key, { hours: failure.hours });
  return failure.minutes === undefined
    ? t(failure.key)
    : tf(failure.key, { minutes: failure.minutes });
}
