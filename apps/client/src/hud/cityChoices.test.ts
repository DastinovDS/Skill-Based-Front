import { describe, expect, it } from 'vitest';
import { cityChoices } from './cityChoices.ts';

const on = { enabled: true, warehouse_max_level: 2 };

describe('cityChoices (DEC-26): what the menu of an own city offers', () => {
  it('without the city development: recruit and roads only', () => {
    expect(
      cityChoices({ ...on, enabled: false }, { hasBarracks: false, warehouseLevel: 0 }),
    ).toEqual(['recruit', 'roads']);
  });

  it('a city without the barracks and with a warehouse to raise offers both builds', () => {
    expect(cityChoices(on, { hasBarracks: false, warehouseLevel: 0 })).toEqual([
      'recruit',
      'roads',
      'barracks',
      'warehouse',
    ]);
  });

  it('the barracks is gone from the menu once it is built', () => {
    expect(cityChoices(on, { hasBarracks: true, warehouseLevel: 1 })).toEqual([
      'recruit',
      'roads',
      'warehouse',
    ]);
  });

  it('the warehouse is gone at its top level', () => {
    expect(cityChoices(on, { hasBarracks: false, warehouseLevel: 2 })).toEqual([
      'recruit',
      'roads',
      'barracks',
    ]);
  });

  it('both gone: recruit and roads', () => {
    expect(cityChoices(on, { hasBarracks: true, warehouseLevel: 2 })).toEqual(['recruit', 'roads']);
  });

  it('an unknown state keeps the sectors (the server decides)', () => {
    expect(cityChoices(on, null)).toEqual(['recruit', 'roads', 'barracks', 'warehouse']);
    expect(cityChoices(on, { hasBarracks: null, warehouseLevel: null })).toEqual([
      'recruit',
      'roads',
      'barracks',
      'warehouse',
    ]);
  });
});
