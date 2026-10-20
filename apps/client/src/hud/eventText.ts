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

/**
 * Kinds the server sends to a player that the feed does not show: the economy ticks (every few
 * seconds), movement and supply bookkeeping, and the start, the rounds and the per-group part of a
 * fight (the `fight_ended` line says it all, DEC-24). The list of everything the server sends is `packages/protocol/vectors/
 * event_kinds.json`; `eventText.test.ts` checks that each kind is either here or has a text.
 */
export const HIDDEN_EVENT_KINDS: ReadonlySet<string> = new Set([
  'charges_produced',
  'charges_overflow',
  'cp_burned',
  'fight_group',
  'fight_round',
  'fight_started',
  'group_arrived',
  'group_split',
  'groups_merged',
  'packet_sent',
  'packet_delivered',
  // A cancel of a recruit is the player's own act: the CP bar shows the refund (DEC-25).
  'recruit_cancelled',
  // Front markers and the rear minimum (DEC-28) are the player's own settings; their UI: #293.
  'front_set',
  'rear_min_set',
  // The score is in the top bar already (ui-style U2): a VP line would repeat it every few seconds.
  'vp_awarded',
]);

/** Kinds with a line in the feed. */
export const LOGGED_EVENT_KINDS: ReadonlySet<string> = new Set([
  'node_captured',
  'fight_ended',
  'recruited',
  'stance_changed',
  'warehouse_lost',
  'recruit_queue_lost',
  'forfeit',
  'match_ended',
  'attrition',
  'build_started',
  'road_upgraded',
  'build_stopped',
  'barracks_built',
  'warehouse_upgraded',
  'packet_lost',
  'transfer_started',
  'starvation',
]);

/** Does the feed show this kind? An unknown kind is not shown (never a raw kind name). */
export function isLogged(kind: string): boolean {
  return LOGGED_EVENT_KINDS.has(kind);
}

/** One line for the feed; only for kinds `isLogged` accepts (others give an empty string). */
export function eventText(event: HudEvent, me: PlayerId): string {
  const { data } = event;
  const side = data.player === me ? 'mine' : 'enemy';
  switch (event.kind) {
    case 'node_captured':
      return tf(side === 'mine' ? 'event.node_captured.mine' : 'event.node_captured.enemy', {
        node: num(data.node),
      });
    case 'fight_ended': {
      // `losses_<p>`: units player p lost in the whole fight (DEC-24).
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
    case 'stance_changed':
      return tf(side === 'mine' ? 'event.stance_changed.mine' : 'event.stance_changed.enemy', {
        stance: isStance(data.stance) ? t(`stance.${data.stance}`) : '?',
      });
    case 'warehouse_lost':
      return tf('event.warehouse_lost', { node: num(data.node) });
    case 'recruit_queue_lost':
      return tf('event.recruit_queue_lost', { node: num(data.node), units: num(data.units) });
    case 'forfeit':
      return t(side === 'mine' ? 'event.forfeit.mine' : 'event.forfeit.enemy');
    case 'match_ended':
      return t('event.match_ended');
    case 'attrition':
      return tf('event.attrition', { node: num(data.node) });
    case 'road_upgraded':
      return tf('event.road_upgraded', { edge: num(data.edge), width: num(data.width) });
    case 'build_started':
      // DEC-26: a city builds a road level, the barracks or a warehouse level.
      if (data.kind === 'barracks')
        return tf('event.build_started.barracks', { node: num(data.node) });
      if (data.kind === 'warehouse') {
        return tf('event.build_started.warehouse', {
          node: num(data.node),
          level: num(data.level),
        });
      }
      return tf('event.build_started', {
        node: num(data.node),
        edge: num(data.edge),
        width: num(data.width),
        charges: num(data.charges),
      });
    case 'build_stopped':
      return typeof data.edge === 'number'
        ? tf('event.build_stopped', { edge: data.edge })
        : tf('event.build_stopped.city', { node: num(data.node) });
    case 'barracks_built':
      return tf('event.barracks_built', { node: num(data.node) });
    case 'warehouse_upgraded':
      return tf('event.warehouse_upgraded', { node: num(data.node), level: num(data.level) });
    case 'packet_lost':
      return tf('event.packet_lost', { edge: num(data.edge), charges: num(data.charges) });
    case 'starvation':
      return tf('event.starvation', {
        node: num(data.node),
        warehouse: num(data.warehouse),
        units: num(data.units),
      });
    case 'transfer_started':
      return tf('event.transfer_started', {
        charges: num(data.charges),
        from: num(data.from_node),
        to: num(data.to_node),
      });
    default:
      return '';
  }
}
