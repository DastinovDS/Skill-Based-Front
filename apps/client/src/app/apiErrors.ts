import { ApiError, type ApiErrorCode } from '../api/http.ts';
import type { MessageKey } from '../i18n/index.ts';

/** The UI string for an API failure. */
const API_ERRORS: Record<ApiErrorCode, MessageKey> = {
  unauthorized: 'error.api.unauthorized',
  blocked: 'error.api.blocked',
  wrong_password: 'error.api.wrong_password',
  not_found: 'error.api.not_found',
  conflict: 'error.api.conflict',
  invalid: 'error.api.invalid',
  rate_limited: 'error.api.rate_limited',
  unavailable: 'error.api.unavailable',
  network: 'error.api.network',
  server: 'error.api.server',
};

export function apiErrorKey(error: unknown): MessageKey {
  return API_ERRORS[error instanceof ApiError ? error.code : 'network'];
}
