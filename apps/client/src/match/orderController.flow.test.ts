import { describe, expect, it } from 'vitest';
import { DEV_RULES_STANCES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// Stances of the automatic supply flow rules (DEC-44).
const map = DEFAULT_MAP;

describe('stances of economy v2 (DEC-44)', () => {
  function stances() {
    const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES_STANCES, map });
    hud.onSnapshot(devSnapshot(map, DEV_RULES_STANCES, 30));
    const sent: Command[] = [];
    const controller = new OrderController({
      hud,
      map,
      rules: DEV_RULES_STANCES,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    return { sent, controller };
  }

  it('Q opens the menu and a sector sends the stance', () => {
    const { controller, sent } = stances();
    expect(controller.openRadial(true)).toBe(true);
    controller.chooseStance('war');
    expect(sent).toEqual([{ type: 'set_stance', stance: 'war' }]);
  });

  it('the stance in force sends nothing', () => {
    const { controller, sent } = stances();
    controller.openRadial(true);
    controller.chooseStance('balance');
    expect(sent).toEqual([]);
  });
});
