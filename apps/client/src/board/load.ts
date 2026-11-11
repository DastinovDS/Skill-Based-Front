/**
 * A piece of the profile page that loads from the server (#871): loading, ready, or why it failed
 * (network, the per-IP limit of public reads, a missing player, the server), so the page can say
 * it and offer a retry.
 */
import { ApiError } from '../api/http.ts';

type FailureKind =
  /** The request did not reach the server. */
  | 'network'
  /** 429: the per-IP limit of public reads; `retryAfterS` says when to try again. */
  | 'limited'
  /** 404: unknown or blocked player. */
  | 'missing'
  | 'server';

export type Load<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | {
      readonly status: 'failed';
      readonly failure: FailureKind;
      readonly retryAfterS: number | null;
    };

export function failed(error: unknown): Load<never> {
  if (error instanceof ApiError) {
    if (error.code === 'network')
      return { status: 'failed', failure: 'network', retryAfterS: null };
    if (error.code === 'rate_limited') {
      return { status: 'failed', failure: 'limited', retryAfterS: error.retryAfterS };
    }
    if (error.code === 'not_found') {
      return { status: 'failed', failure: 'missing', retryAfterS: null };
    }
  }
  return { status: 'failed', failure: 'server', retryAfterS: null };
}
