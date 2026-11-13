/**
 * The locks of a tutorial beat on the client (`docs/design/tutorial.md`, section 7.7): a command is
 * matched against the beat's `allow` patterns on the ids and nodes the client already has (the
 * group's node from the newest snapshot, the road's ends from the map), as the server matches it
 * (`gow_server.tutorial.pattern_matches`). The server refuses a command the beat does not allow
 * anyway; the client only disables the control so the player is never refused.
 */
import type { Allow, Command, CommandPattern, MapFile, Stance } from '../protocol.gen.ts';

/** What the client knows of the places a command names. */
export interface AllowContext {
  readonly map: MapFile;
  /** The node an own group stands in; `null`: on a road, unknown, or not own. */
  groupNode(group: string): number | null;
}

/**
 * The facts of a command the patterns compare (`CommandFacts` of the server). A field left
 * `undefined` is not known yet (a probe of a menu item before its target is picked) and matches
 * any value of a pattern.
 */
export interface CommandFacts {
  readonly command: keyof CommandPattern;
  readonly origin?: number | null;
  readonly dest?: number | null;
  readonly node?: number;
  readonly toward?: number | null;
  readonly planned?: boolean;
  readonly stance?: Stance;
  /** The nodes the groups of a group order stand in, sorted; `[]` when one is not standing. */
  readonly groups?: readonly number[];
}

/** The facts of `cmd`; `null` for a command no chapter allows (split, merge, release ...). */
export function factsOf(cmd: Command, ctx: AllowContext): CommandFacts | null {
  switch (cmd.type) {
    case 'move':
      return {
        command: 'move',
        origin: ctx.groupNode(cmd.group),
        dest: cmd.dest,
        planned: cmd.planned,
      };
    case 'cancel_order':
      return { command: 'cancel_order', origin: ctx.groupNode(cmd.group) };
    case 'build_factory':
    case 'build_barracks':
    case 'recruit':
      return { command: cmd.type, node: cmd.node };
    case 'set_stance':
      return { command: 'set_stance', stance: cmd.stance };
    case 'fortify_road': {
      const edge = ctx.map.edges[cmd.edge];
      const toward =
        edge === undefined
          ? null
          : edge.a === cmd.node
            ? edge.b
            : edge.b === cmd.node
              ? edge.a
              : null;
      return { command: 'fortify_road', node: cmd.node, toward };
    }
    case 'group_move': {
      const nodes = cmd.groups.map((g) => ctx.groupNode(g));
      const standing = nodes.filter((n): n is number => n !== null).sort((a, b) => a - b);
      return {
        command: 'group_move',
        dest: cmd.dest,
        planned: cmd.planned,
        groups: standing.length === nodes.length ? standing : [],
      };
    }
    case 'set_rally_point':
      return { command: 'set_rally_point', node: cmd.node, dest: cmd.target };
    default:
      return null;
  }
}

/** The command kind of an allow entry (exactly one pattern field is set). */
export function patternKind(entry: CommandPattern): keyof CommandPattern | null {
  for (const key of [
    'move',
    'cancel_order',
    'build_factory',
    'build_barracks',
    'recruit',
    'set_stance',
    'fortify_road',
    'group_move',
    'set_rally_point',
  ] as const) {
    if (entry[key] !== undefined && entry[key] !== null) return key;
  }
  return null;
}

/** `facts` is a command of `entry`: its type and every place the entry names. */
export function patternMatches(entry: CommandPattern, facts: CommandFacts, map: MapFile): boolean {
  if (patternKind(entry) !== facts.command) return false;
  const id = (name: string): number | undefined => map.nodes.find((n) => n.name === name)?.id;
  // A place the pattern names must be the fact's; an unknown fact (a probe) matches.
  const same = (name: string | null | undefined, value: number | null | undefined): boolean =>
    name === null || name === undefined || value === undefined || id(name) === value;
  const kind = (want: boolean | null | undefined): boolean =>
    want === null || want === undefined || facts.planned === undefined || want === facts.planned;
  if (entry.move != null) {
    return (
      same(entry.move.from, facts.origin) &&
      same(entry.move.to, facts.dest) &&
      kind(entry.move.planned)
    );
  }
  if (entry.cancel_order != null) return same(entry.cancel_order.from, facts.origin);
  const nodeOnly = entry.build_factory ?? entry.build_barracks ?? entry.recruit;
  if (nodeOnly != null) return same(nodeOnly.node, facts.node);
  if (entry.set_stance != null) {
    const want = entry.set_stance.stance;
    return (
      want === null || want === undefined || facts.stance === undefined || want === facts.stance
    );
  }
  if (entry.fortify_road != null) {
    return (
      same(entry.fortify_road.node, facts.node) && same(entry.fortify_road.toward, facts.toward)
    );
  }
  if (entry.group_move != null) {
    const want = entry.group_move.groups;
    const groups =
      want === null ||
      want === undefined ||
      facts.groups === undefined ||
      (want.length === facts.groups.length &&
        [...want.map(id)]
          .sort((a, b) => (a ?? -1) - (b ?? -1))
          .every((n, i) => n === facts.groups?.[i]));
    return groups && same(entry.group_move.to, facts.dest) && kind(entry.group_move.planned);
  }
  if (entry.set_rally_point != null) {
    return (
      same(entry.set_rally_point.node, facts.node) && same(entry.set_rally_point.to, facts.dest)
    );
  }
  return false;
}

/**
 * `facts` are admitted by `allow` with the counts `used` (the server's, per entry): an entry they
 * match that is not used up yet.
 */
export function admits(
  allow: readonly Allow[],
  used: readonly number[],
  facts: CommandFacts,
  map: MapFile,
): boolean {
  return allow.some((entry, i) => {
    if (entry.max != null && (used[i] ?? 0) >= entry.max) return false;
    return patternMatches(entry, facts, map);
  });
}

/** The command is allowed now. Leaving (`forfeit`) always is. */
export function commandAllowed(
  allow: readonly Allow[],
  used: readonly number[],
  cmd: Command,
  ctx: AllowContext,
): boolean {
  if (cmd.type === 'forfeit') return true;
  const facts = factsOf(cmd, ctx);
  return facts !== null && admits(allow, used, facts, ctx.map);
}
