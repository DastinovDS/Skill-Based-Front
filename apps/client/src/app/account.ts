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

/** Why a form action failed: a string key, and the wait for a 429 that named one. */
export interface AccountFailure {
  readonly key: MessageKey;
  /** Whole minutes, rounded up, from `Retry-After`; only with `error.account.rateLimitedWait`. */
  readonly minutes?: number;
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
  return failure.minutes === undefined
    ? t(failure.key)
    : tf(failure.key, { minutes: failure.minutes });
}
