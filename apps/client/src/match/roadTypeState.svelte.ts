import type { RoadType } from '../hud/radial.ts';
import type { RoadGain } from '../protocol.gen.ts';

/** What the road type menu shows (DEC-22): the first upgrade of a road chooses its type. */
export interface RoadTypeData {
  readonly open: boolean;
  /** The city that builds and the road it upgrades; `-1` while closed. */
  readonly node: number;
  readonly edge: number;
  /** The level the road gets (2 for the first upgrade). */
  readonly level: number;
  /** What each type adds (the server's `upgrade_gain`); `null`: the type is not offered. */
  readonly fast: RoadGain | null;
  readonly freight: RoadGain | null;
  /** Warehouse charges of the level; `null` if the ruleset lists no price. */
  readonly charges: number | null;
  /** The sector under the pointer; `null`: the dead zone, or nothing yet. */
  readonly hover: RoadType | null;
}

const CLOSED: RoadTypeData = {
  open: false,
  node: -1,
  edge: -1,
  level: 0,
  fast: null,
  freight: null,
  charges: null,
  hover: null,
};

/** The reactive side of the road type menu: one field replaced as a whole (AGENTS.md 7.2). */
export class RoadTypeState {
  current = $state.raw<RoadTypeData>(CLOSED);

  open(data: Omit<RoadTypeData, 'open' | 'hover'>): void {
    this.current = { ...data, open: true, hover: null };
  }

  close(): void {
    if (this.current.open) this.current = CLOSED;
  }

  hover(type: RoadType | null): void {
    if (this.current.hover !== type) this.current = { ...this.current, hover: type };
  }
}
