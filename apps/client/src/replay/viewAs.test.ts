import { describe, expect, it } from 'vitest';
import { blueSide, defaultView, otherSide } from './viewAs.ts';

describe('blueSide', () => {
  it('draws player 1 blue for "both" and the chosen side otherwise', () => {
    expect(blueSide('both')).toBe(0);
    expect(blueSide(0)).toBe(0);
    expect(blueSide(1)).toBe(1);
    expect(otherSide(0)).toBe(1);
    expect(otherSide(1)).toBe(0);
  });
});

describe('defaultView', () => {
  const nicks = ['Danya', 'Guest-7'] as const;

  it('opens as the side the app says the viewer played', () => {
    expect(defaultView(1, null, null)).toBe(1);
    expect(defaultView(0, nicks, 'Guest-7')).toBe(0);
  });

  it('finds the viewer by nick when the app does not know the side', () => {
    expect(defaultView(null, nicks, 'guest-7')).toBe(1);
    expect(defaultView(null, nicks, 'Danya')).toBe(0);
  });

  it('shows both for a stranger, an unknown nick, a file without nicks or a game against oneself', () => {
    expect(defaultView(null, nicks, 'Other')).toBe('both');
    expect(defaultView(null, null, 'Danya')).toBe('both');
    expect(defaultView(null, nicks, null)).toBe('both');
    expect(defaultView(null, ['Same', 'same'], 'Same')).toBe('both');
  });
});
