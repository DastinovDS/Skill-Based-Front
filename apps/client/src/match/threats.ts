/**
 * Threats to the player's own cities for the arcs at the screen edge (UI round 2): an enemy takes
 * a city of mine, fights in one, or has aimed a planned order at one. Only what the player may
 * know goes in: the visible events of own cities (the server sends events by visibility) and the
 * public intents (DEC-04). The client decides nothing about the fight to come.
 */
import type { EventMsg, PlayerId, SnapshotMsg } from '../protocol.gen.ts';

/** What happened to the city: taken, fought in, or marched on (a planned order aims at it). */
export type ThreatKind = 'captured' | 'attack' | 'incoming';

export interface Threat {
  readonly node: number;
  readonly kind: ThreatKind;
}

/** A capture or a fight is shown at the edge this long, ms. */
export const THREAT_MS = 6000;

/** The threat an event is, or `null`. `mine`: owner of the city in the last snapshot. */
export function threatOfEvent(
  event: Pick<EventMsg, 'kind' | 'data'>,
  me: PlayerId,
  owner: (node: number) => PlayerId | null | undefined,
): Threat | null {
  const node = event.data.node;
  if (typeof node !== 'number') return null;
  if (event.kind === 'node_captured') {
    // The enemy took it: the city was mine a moment ago (the snapshot may already say otherwise).
    return event.data.player !== me && owner(node) === me ? { node, kind: 'captured' } : null;
  }
  // A fight starts in a city of mine (DEC-24: it lasts its rounds, the start is the news).
  if (event.kind === 'fight_started' && owner(node) === me) return { node, kind: 'attack' };
  return null;
}

/** Cities of mine that enemy planned orders aim at, from the public intents of a snapshot. */
export function incomingNodes(snapshot: SnapshotMsg, me: PlayerId): number[] {
  const nodes = new Set<number>();
  for (const intent of snapshot.view.intents) {
    if (intent.owner === me || intent.kind !== 'planned_move' || intent.target === null) continue;
    if (snapshot.view.nodes[intent.target]?.owner === me) nodes.add(intent.target);
  }
  return [...nodes].sort((a, b) => a - b);
}

/**
 * The threats of the match: events that live for `THREAT_MS`, and the incoming orders of the last
 * snapshot for as long as they stand. Plain data (no `$state`): the arcs read it every frame.
 */
export class ThreatLog {
  readonly #events = new Map<string, number>();
  #incoming: readonly number[] = [];

  constructor(
    private readonly me: PlayerId,
    private readonly now: () => number = () => performance.now(),
  ) {}

  onSnapshot(snapshot: SnapshotMsg): void {
    this.#incoming = incomingNodes(snapshot, this.me);
  }

  onEvent(
    event: Pick<EventMsg, 'kind' | 'data'>,
    owner: (node: number) => PlayerId | null | undefined,
  ): void {
    const threat = threatOfEvent(event, this.me, owner);
    if (threat !== null)
      this.#events.set(`${threat.kind}:${String(threat.node)}`, this.now() + THREAT_MS);
  }

  /** What to point at now, with the time left of an event threat (`null` for an incoming order). */
  active(): { threat: Threat; left: number | null }[] {
    const at = this.now();
    const found: { threat: Threat; left: number | null }[] = [];
    for (const [key, until] of this.#events) {
      if (until <= at) {
        this.#events.delete(key);
        continue;
      }
      const [kind, node] = key.split(':');
      found.push({
        threat: { kind: kind as ThreatKind, node: Number(node) },
        left: until - at,
      });
    }
    for (const node of this.#incoming)
      found.push({ threat: { kind: 'incoming', node }, left: null });
    return found;
  }

  reset(): void {
    this.#events.clear();
    this.#incoming = [];
  }
}
