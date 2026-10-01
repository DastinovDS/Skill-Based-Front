/**
 * The guest identity kept between visits: the token the server issued once (ID-01) and the nick.
 * `localStorage` may be missing or throw (private mode, blocked site data): then the guest lives
 * until the page closes and a new nick is asked next time. The token is never put in a URL.
 */
export interface SavedGuest {
  token: string;
  nick: string;
}

export const GUEST_STORAGE_KEY = 'sbf.guest';

export function loadGuest(storage: () => Storage): SavedGuest | null {
  try {
    const raw = storage().getItem(GUEST_STORAGE_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'token' in value &&
      'nick' in value &&
      typeof value.token === 'string' &&
      typeof value.nick === 'string' &&
      value.token !== ''
    ) {
      return { token: value.token, nick: value.nick };
    }
  } catch {
    // No storage or damaged content: ask for a nick again.
  }
  return null;
}

export function saveGuest(storage: () => Storage, guest: SavedGuest): void {
  try {
    storage().setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
  } catch {
    // Not remembered: the next visit asks for a nick again.
  }
}

export function forgetGuest(storage: () => Storage): void {
  try {
    storage().removeItem(GUEST_STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
}
