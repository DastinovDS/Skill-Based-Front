/** Which server message makes which sound (#71). Pure: no audio here, so it is tested alone. */
import type { PlayerId, ServerMsg } from '../protocol.gen.ts';
import type { SoundId } from './recipes.ts';

/** A sound a message asks for; `tick` is set for an event (it plays when the map draws that tick). */
export interface SoundCue {
  id: SoundId;
  tick: number | null;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export function cuesOf(msg: ServerMsg, me: PlayerId): SoundCue[] {
  switch (msg.type) {
    case 'event': {
      const { kind, data, tick } = msg;
      switch (kind) {
        case 'fight_round': {
          const cues: SoundCue[] = [{ id: 'fightRound', tick }];
          if (num(data[`losses_${String(me)}`]) > 0) cues.push({ id: 'unitLoss', tick });
          return cues;
        }
        case 'attrition':
          return data.player === me ? [{ id: 'unitLoss', tick }] : [];
        case 'node_captured':
          return [{ id: data.player === me ? 'capture' : 'captureLost', tick }];
        default:
          return [];
      }
    }
    case 'ack':
      return msg.reject_code === null ? [{ id: 'orderOk', tick: null }] : [];
    case 'match_end':
      return [
        {
          id: msg.winner === null ? 'matchDraw' : msg.winner === me ? 'matchWin' : 'matchLose',
          tick: null,
        },
      ];
    default:
      return [];
  }
}
