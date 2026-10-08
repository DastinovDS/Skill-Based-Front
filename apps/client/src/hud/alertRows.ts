/**
 * The stack of alerts under the top bar (ui-style 10.4 and 12): one row per kind of alert, with
 * the count when several cities are concerned. Pure: `AlertStack.svelte` only draws the rows.
 */
import { getLocale, t, tf } from '../i18n/index.ts';
import type { IncomingAlert } from '../match/incoming.ts';
import type { OverflowAlert } from '../match/overflow.ts';
import { formatSeconds } from './format.ts';

/** Overcrowded cities: the one whose unit dies first, and how many there are. */
export interface OverflowRow {
  readonly kind: 'overflow';
  readonly cities: number;
  readonly first: OverflowAlert;
}

/** Cities that enemy planned orders aim at: the one they leave for first, and the counts. */
export interface IncomingRow {
  readonly kind: 'incoming';
  readonly cities: number;
  /** Orders in all. */
  readonly orders: number;
  readonly first: IncomingAlert;
}

export type AlertRow = OverflowRow | IncomingRow;

/** The rows to show: overcrowding first (it costs a unit), then the incoming attacks. */
export function alertRows(
  overflow: readonly OverflowAlert[],
  incoming: readonly IncomingAlert[],
): AlertRow[] {
  const rows: AlertRow[] = [];
  const hot = overflow[0];
  if (hot !== undefined) rows.push({ kind: 'overflow', cities: overflow.length, first: hot });
  const near = incoming[0];
  if (near !== undefined) {
    rows.push({
      kind: 'incoming',
      cities: incoming.length,
      orders: incoming.reduce((total, alert) => total + alert.count, 0),
      first: near,
    });
  }
  return rows;
}

/** The line of a row, in the language of the page. */
export function alertRowText(row: AlertRow, tickHz: number): string {
  const seconds = (ticks: number): string => formatSeconds(ticks, tickHz, getLocale());
  if (row.kind === 'overflow') {
    const { first } = row;
    const when =
      first.attritionIn !== null
        ? tf('alert.overflowIn', { seconds: seconds(first.attritionIn) })
        : tf('alert.overflowGrace', { seconds: seconds(first.graceLeft ?? 0) });
    return row.cities === 1
      ? tf('alert.overflow', {
          node: first.node,
          units: first.units,
          capacity: first.capacity,
          when,
        })
      : tf('alert.overflowMany', { count: row.cities, node: first.node, when });
  }
  const { first } = row;
  const when =
    first.ticksLeft === null
      ? t('alert.incomingGone')
      : tf('alert.incomingIn', { seconds: seconds(first.ticksLeft) });
  return row.cities === 1
    ? tf('alert.incoming', { node: first.node, count: first.count, when })
    : tf('alert.incomingMany', { count: row.cities, node: first.node, when });
}
