/**
 * The data of the "How to play" screen (CLI-13, #72): the combat examples played by `gow_sim`
 * under the played ruleset and the rule numbers the texts quote. The file is generated
 * (`mise run regen:howto`, scripts/export_howto.py) and checked against drift in
 * tests/test_export_howto.py. The client draws it; it never works out a fight (AGENTS.md, 7.1).
 */
import raw from './combatExamples.gen.json';

export interface Count {
  readonly units: number;
  readonly charged: number;
}

export interface Pair<T> {
  readonly a: T;
  readonly b: T;
}

export interface Round {
  readonly round: number;
  readonly after_ticks: number;
  readonly after_seconds: number;
  readonly a: Count;
  readonly b: Count;
  readonly bonus_left: Pair<number>;
}

export type ExampleId = 'equal' | 'surplus' | 'defenseless' | 'planned';

export interface Example {
  readonly id: ExampleId;
  readonly start: Pair<Count>;
  readonly bonus_start: Pair<number>;
  readonly rounds: readonly Round[];
  readonly end: Pair<Count> & {
    readonly after_ticks: number;
    readonly node_taken: boolean;
    readonly attack_bounces: boolean;
    readonly losses: Pair<number>;
  };
}

export interface HowToRules {
  readonly round_seconds: number;
  readonly planned_delay_seconds: number;
  readonly planned_bonus_per_road: number;
  readonly defense_seconds_per_bonus: number;
  readonly cost_move_cp: number;
  readonly cost_planned_cp: number;
  readonly cost_defense_cp: number;
  readonly stance_charges_pct: {
    readonly economy: number;
    readonly balance: number;
    readonly war: number;
  };
  readonly vp_period_seconds: number;
  readonly capital_multiplier: number;
  readonly match_minutes: number;
}

export interface HowToData {
  readonly ruleset: string;
  readonly rules: HowToRules;
  readonly examples: readonly Example[];
}

export const HOWTO: HowToData = raw as HowToData;
