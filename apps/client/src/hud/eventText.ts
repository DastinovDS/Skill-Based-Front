/** Text of the visible-event feed: which dictionary entry a server event maps to (CLI-08, #64). */
import type { PlayerId, Stance } from '../protocol.gen.ts';
import { t, tf } from '../i18n/index.ts';
import type { HudEvent } from './hudData.ts';

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isStance(value: unknown): value is Stance {
  return value === 'economy' || value === 'balance' || value === 'war';
}

/** One line for the feed. Events the client does not know show their kind, never nothing. */
export function eventText(event: HudEvent, me: PlayerId): string {
  const { data } = event;
  const side = data.player === me ? 'mine' : 'enemy';
  switch (event.kind) {
    case 'node_captured':
      return tf(side === 'mine' ? 'event.node_captured.mine' : 'event.node_captured.enemy', {
        node: num(data.node),
      });
    case 'fight': {
      // `losses_<p>`: units player p lost.
      const values = {
        mine: num(data[`losses_${String(me)}`]),
        enemy: num(data[`losses_${String(1 - me)}`]),
      };
      return typeof data.node === 'number'
        ? tf('event.fight.node', { ...values, node: data.node })
        : tf('event.fight.edge', { ...values, edge: num(data.edge) });
    }
    case 'recruited':
      return tf(side === 'mine' ? 'event.recruited.mine' : 'event.recruited.enemy', {
        node: num(data.node),
      });
    case 'vp_awarded':
      return tf(side === 'mine' ? 'event.vp_awarded.mine' : 'event.vp_awarded.enemy', {
        vp: num(data.vp),
      });
    case 'stance_changed':
      return tf(side === 'mine' ? 'event.stance_changed.mine' : 'event.stance_changed.enemy', {
        stance: isStance(data.stance) ? t(`stance.${data.stance}`) : '?',
      });
    case 'warehouse_lost':
      return tf('event.warehouse_lost', { node: num(data.node) });
    case 'forfeit':
      return t(side === 'mine' ? 'event.forfeit.mine' : 'event.forfeit.enemy');
    case 'match_ended':
      return t('event.match_ended');
    default:
      return tf('event.other', { kind: event.kind });
  }
}
