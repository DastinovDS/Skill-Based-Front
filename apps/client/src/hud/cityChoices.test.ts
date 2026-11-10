import { describe, expect, it } from 'vitest';
import { cityChoices } from './cityChoices.ts';

describe('cityChoices (DEC-26, DEC-41): what the menu of an own city offers', () => {
  it('a city without the barracks has no recruit sector at all: it offers the builds', () => {
    expect(cityChoices({ hasBarracks: false }, false, false, false)).toEqual([
      'barracks',
      'factory',
    ]);
  });

  it('the barracks is gone from the menu once it is built', () => {
    expect(cityChoices({ hasBarracks: true }, false, false, false)).toEqual(['recruit', 'factory']);
  });

  it('the factory is gone once the city is one, and while the own factories are at their max', () => {
    expect(cityChoices({ hasBarracks: true, factory: true }, false, false, false)).toEqual([
      'recruit',
    ]);
    expect(cityChoices({ hasBarracks: true, factory: false }, false, true, false)).toEqual([
      'recruit',
    ]);
  });

  it('an unknown state keeps the sectors (the server decides)', () => {
    expect(cityChoices(null, false, false, false)).toEqual(['recruit', 'barracks', 'factory']);
    expect(cityChoices({ hasBarracks: null, factory: null }, false, false, false)).toEqual([
      'recruit',
      'barracks',
      'factory',
    ]);
  });

  it('a city fortifies a road while one has no line (DEC-43, item D)', () => {
    expect(cityChoices({ hasBarracks: true, factory: true })).toEqual(['recruit', 'fortify']);
  });

  it('an own province offers only the road fortification, or nothing at all', () => {
    expect(cityChoices(null, true)).toEqual(['fortify']);
    expect(cityChoices(null, true, false, false)).toEqual([]);
    expect(cityChoices(null, true, false, true, true)).toEqual(['fortify']);
  });

  it('the rally point (DEC-48, item K7): with the rule, where a unit can be recruited', () => {
    const city = { hasBarracks: true, factory: true };
    expect(cityChoices(city, false, false, true, true)).toEqual(['recruit', 'rally', 'fortify']);
    expect(cityChoices(city)).toEqual(['recruit', 'fortify']);
    expect(cityChoices({ hasBarracks: false }, false, false, true, true)).not.toContain('rally');
  });
});
