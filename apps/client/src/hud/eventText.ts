/** Text of the visible-event feed: which dictionary entry a server event maps to (CLI-08, #64). */
import type { PlayerId, Stance } from '../protocol.gen.ts';
import { t, tf } from '../i18n/index.ts';
import type { HudEvent } from './hudData.ts';
import type { NodeNamer } from './nodeName.ts';

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
  // The score is in the top bar already (ui-style U2): a VP line would repeat it every few seconds.
  'vp_awarded',
  // DEC-41: a full factory warehouse burns a charge (the gauge shows it full), every payment of a
  // building (the Crown arc shows what is owed) and every charge a gathering plan takes (the plan
  // shows its bonus) are bookkeeping, every few seconds.
  'charge_burned',
  'build_paid',
  'plan_charged',
  // DEC-48: the rally point alerts; the client part of #896 gives them a line and a toast.
  'rally_point_cleared',
  'rally_walk_no_cp',
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
  'build_stopped',
  'barracks_built',
  'packet_lost',
  'starvation',
  // A capture the group could not pay for (DEC-38): only its player gets it.
  'capture_failed',
  // DEC-41, #649: a factory done.
  'factory_built',
  // Road fortifications (DEC-43, item D; #707): a line starts to work or is lost with its city, and a
  // toll paid or taken (the map shows each as a beam, the feed keeps the count).
  'road_fort_built',
  'road_fort_destroyed',
  'toll_paid',
  'toll_taken',
]);

/** Does the feed show this kind? An unknown kind is not shown (never a raw kind name). */
export function isLogged(kind: string): boolean {
  return LOGGED_EVENT_KINDS.has(kind);
}

/**
 * One line for the feed; only for kinds `isLogged` accepts (others give an empty string). A place
 * is told by its name from the map (`names`, #449), never by its number.
 */
export function eventText(event: HudEvent, me: PlayerId, names: NodeNamer): string {
  const { data } = event;
  // Read on demand: only the kinds that name a `player` ask who it is (ARC-02).
  const mine = (): boolean => data.player === me;
  switch (event.kind) {
    case 'node_captured':
      return tf(mine() ? 'event.node_captured.mine' : 'event.node_captured.enemy', {
        node: names(num(data.node)),
      });
    case 'fight_ended': {
      // `losses_<p>`: units player p lost in the whole fight (DEC-24).
      const values = {
        mine: num(data[`losses_${String(me)}`]),
        enemy: num(data[`losses_${String(1 - me)}`]),
      };
      return typeof data.node === 'number'
        ? tf('event.fight.node', { ...values, node: names(data.node) })
        : tf('event.fight.edge', { ...values, edge: num(data.edge) });
    }
    case 'recruited':
      return tf(mine() ? 'event.recruited.mine' : 'event.recruited.enemy', {
        node: names(num(data.node)),
      });
    case 'stance_changed':
      return tf(mine() ? 'event.stance_changed.mine' : 'event.stance_changed.enemy', {
        stance: isStance(data.stance) ? t(`stance.${data.stance}`) : '?',
      });
    case 'warehouse_lost':
      return tf('event.warehouse_lost', { node: names(num(data.node)) });
    case 'recruit_queue_lost':
      return tf('event.recruit_queue_lost', {
        node: names(num(data.node)),
        units: num(data.units),
      });
    case 'forfeit':
      return t(mine() ? 'event.forfeit.mine' : 'event.forfeit.enemy');
    case 'match_ended':
      return t('event.match_ended');
    case 'attrition':
      return tf('event.attrition', { node: names(num(data.node)) });
    case 'build_started':
      // DEC-26: a city builds the barracks; DEC-41: a factory; DEC-43: a road fortification.
      if (data.kind === 'factory')
        return tf('event.build_started.factory', { node: names(num(data.node)) });
      if (data.kind === 'road_fort')
        return tf('event.build_started.road_fort', { node: names(num(data.node)) });
      return tf('event.build_started.barracks', { node: names(num(data.node)) });
    case 'build_stopped':
      return tf('event.build_stopped.city', { node: names(num(data.node)) });
    case 'barracks_built':
      return tf('event.barracks_built', { node: names(num(data.node)) });
    case 'packet_lost':
      return tf('event.packet_lost', { edge: num(data.edge), charges: num(data.charges) });
    case 'starvation':
      return tf('event.starvation', {
        node: names(num(data.node)),
        warehouse: num(data.warehouse),
        units: num(data.units),
      });
    case 'factory_built':
      return tf('event.factory_built', { node: names(num(data.node)) });
    case 'road_fort_built':
      return tf('event.road_fort_built', { node: names(num(data.node)), edge: num(data.edge) });
    case 'road_fort_destroyed':
      return tf(
        data.built === true ? 'event.road_fort_destroyed' : 'event.road_fort_destroyed.unfinished',
        { node: names(num(data.node)), edge: num(data.edge) },
      );
    case 'toll_paid':
      return tf('event.toll_paid', { node: names(num(data.node)), charges: num(data.charges) });
    case 'toll_taken':
      return tf('event.toll_taken', { node: names(num(data.node)), charges: num(data.charges) });
    case 'capture_failed':
      // DEC-38: `bounce`, the group turns back; `encircled`, a returning group could not retake its home and died.
      return tf(
        data.result === 'encircled'
          ? 'event.capture_failed.encircled'
          : 'event.capture_failed.bounce',
        { node: names(num(data.node)) },
      );
    default:
      return '';
  }
}
