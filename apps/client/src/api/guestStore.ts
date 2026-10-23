/**
 * The guest identity kept between visits: the token the server issued (ID-01; a password change
 * or a login replaces it, #374) and the nick.
 * `localStorage` may be missing or throw (private mode, blocked site data): then the guest lives
 * until the page closes and a new nick is asked next time. The token is never put in a URL.
 */
export interface SavedGuest {
  token: string;
  nick: string;
  /** The account has a password (#374): decides what "Log out" warns about while offline. */
  hasPassword: boolean;
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
      const hasPassword = 'hasPassword' in value && value.hasPassword === true;
      return { token: value.token, nick: value.nick, hasPassword };
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
