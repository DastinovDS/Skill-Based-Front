/**
 * The sounds of the match (#71): short tones made with the Web Audio API, no files and no
 * dependency. A sound is a list of tones; `engine.ts` plays them.
 */

export type SoundId =
  | 'fightRound'
  | 'unitLoss'
  | 'capture'
  | 'captureLost'
  | 'orderOk'
  | 'matchWin'
  | 'matchLose'
  | 'matchDraw';

/** One tone: starts `at` seconds after the sound, glides from `from` to `to` Hz. */
export interface Tone {
  at: number;
  dur: number;
  from: number;
  to?: number;
  wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  /** Peak gain 0..1, before the master volume. */
  gain: number;
}

export const RECIPES: Readonly<Record<SoundId, readonly Tone[]>> = {
  // A dull hit per round of a fight.
  fightRound: [
    { at: 0, dur: 0.09, from: 190, to: 90, wave: 'square', gain: 0.1 },
    { at: 0, dur: 0.12, from: 70, to: 45, wave: 'sine', gain: 0.3 },
  ],
  // One of your units died: a falling buzz.
  unitLoss: [{ at: 0, dur: 0.24, from: 340, to: 110, wave: 'sawtooth', gain: 0.12 }],
  // Two rising notes: a node is yours.
  capture: [
    { at: 0, dur: 0.12, from: 523, wave: 'triangle', gain: 0.25 },
    { at: 0.1, dur: 0.22, from: 784, wave: 'triangle', gain: 0.25 },
  ],
  // Two falling notes: a node is lost.
  captureLost: [
    { at: 0, dur: 0.12, from: 392, wave: 'triangle', gain: 0.25 },
    { at: 0.1, dur: 0.24, from: 262, wave: 'triangle', gain: 0.25 },
  ],
  // A tiny tick: the order was accepted.
  orderOk: [{ at: 0, dur: 0.05, from: 880, to: 1100, wave: 'sine', gain: 0.14 }],
  matchWin: [
    { at: 0, dur: 0.18, from: 523, wave: 'triangle', gain: 0.25 },
    { at: 0.15, dur: 0.18, from: 659, wave: 'triangle', gain: 0.25 },
    { at: 0.3, dur: 0.5, from: 784, wave: 'triangle', gain: 0.25 },
  ],
  matchLose: [
    { at: 0, dur: 0.22, from: 392, wave: 'triangle', gain: 0.25 },
    { at: 0.2, dur: 0.22, from: 311, wave: 'triangle', gain: 0.25 },
    { at: 0.4, dur: 0.6, from: 233, wave: 'triangle', gain: 0.25 },
  ],
  matchDraw: [
    { at: 0, dur: 0.25, from: 440, wave: 'triangle', gain: 0.22 },
    { at: 0.3, dur: 0.45, from: 440, wave: 'triangle', gain: 0.22 },
  ],
};
