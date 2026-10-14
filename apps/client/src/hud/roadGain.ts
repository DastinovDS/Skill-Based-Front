/** What one more level of a road type adds, as the server says (DEC-22, item 7). */
import { tf } from '../i18n/index.ts';
import type { RoadGain } from '../protocol.gen.ts';

export function gainText(gain: RoadGain): string {
  const parts: string[] = [];
  if (gain.speed_pct > 0) parts.push(tf('roadType.speed', { value: gain.speed_pct }));
  if (gain.amount > 0) parts.push(tf('roadType.amount', { value: gain.amount }));
  return parts.join(', ');
}
