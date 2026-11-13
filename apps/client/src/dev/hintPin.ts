/**
 * `?hint=<id>[,<node>]` on a frozen scene (#806, section 5): a hint of the first match pinned over
 * it, for the screenshots (`mise run shots`: `hint-<name>.png`). `H3` is the charges version (the
 * stance chip), `H3cp` the CP version (the CP gauge); the others ring `<node>`.
 */
import type { HintShow } from '../tutorial/hints.ts';
import { HINT_IDS } from '../tutorial/progress.ts';

export function parseHint(param: string | null): HintShow | null {
  if (param === null) return null;
  const [name = '', at] = param.split(',');
  if (name === 'H3cp') return { id: 'H3', variant: 'cp', node: null, road: null, hud: 'cp' };
  if (name === 'H3') {
    return { id: 'H3', variant: 'charges', node: null, road: null, hud: 'stance' };
  }
  const id = HINT_IDS.find((known) => known === name);
  const node = Number(at);
  if (id === undefined || !Number.isInteger(node)) return null;
  return { id, variant: null, node, road: null, hud: null };
}
