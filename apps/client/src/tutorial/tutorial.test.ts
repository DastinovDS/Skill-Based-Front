// The tutorial on the client (#806, docs/design/tutorial.md section 7.7): the chapter files and
// their texts, the gate of each beat (section 4.9), the allow matcher (section 7.3, the server's
// `pattern_matches`), the coach on recorded `tutorial` streams, the progress (section 7.8).
// Expected values come from tutorial.md, not from the code.
import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en.ts';
import type { Chapter, Command, MapFile, TutorialMsg, UiFlag } from '../protocol.gen.ts';
import { commandAllowed, type AllowContext } from './allow.ts';
import { chapterMap, chapterOf, CHAPTER_IDS, GOAL_COUNT, nodeNamed } from './chapters.ts';
import { BEAT_FALLBACK_MS, standingOrders, TutorialCoach } from './coach.svelte.ts';
import { allowOf, FULL_GATE, gateOf, UI_FLAGS } from './gate.ts';
import {
  defaultSeat,
  EMPTY_PROGRESS,
  fromWire,
  offerAllowed,
  sealStates,
  toFlags,
  type TutorialProgress,
} from './progress.ts';
import { richText } from './rich.ts';

/**
 * Chapter IV with the slides and the failure beat of the earlier rounds: no chapter has them since
 * review 5 (#1054: the head-on attack is the main path), but the client keeps both mechanisms.
 */
function withFailure(): Chapter {
  const attack = chapterOf('attack');
  return {
    ...attack,
    beats: attack.beats.map((b) => (b.id === '4' ? { ...b, slides: 3 } : b)) as Chapter['beats'],
    fails: [
      {
        id: 'F',
        on: { event: 'fight_ended', node: 'Ashwood', winner: 'enemy' },
        pause: 'continue',
        ui: ['planned'],
        allow: [{ move: { from: 'Fernhold', to: 'Ashwood', planned: true } }],
        mark: [{ node: 'Fernhold' }],
      },
    ],
  };
}

const KEYS = {
  label: (action: string) => action.toUpperCase().slice(0, 1),
  shift: 'Shift',
  esc: 'Esc',
};

describe('chapter files and texts', () => {
  it('bundles the eight chapters with their maps', () => {
    expect(CHAPTER_IDS).toHaveLength(8);
    for (const id of CHAPTER_IDS) {
      const chapter = chapterOf(id);
      expect(chapter.id).toBe(id);
      expect(chapterMap(chapter).meta.name).toBe(chapter.map);
    }
  });

  it('has the texts of every beat in the dictionary, and no text of a beat that is not there', () => {
    const keys = Object.keys(en);
    const META = /^(name|why|length|goal\d|lesson\d)$/;
    for (const id of CHAPTER_IDS) {
      const chapter = chapterOf(id);
      // A focus beat (review 4, P5) has no card and no text.
      const beats = [...chapter.beats, ...(chapter.fails ?? [])].filter((b) => b.focus == null);
      const want = new Set<string>();
      for (const beat of beats) {
        const base = `tutorial.${id}.${beat.id}`;
        if ((beat.slides ?? 1) > 1) {
          for (let n = 1; n <= (beat.slides ?? 1); n++) want.add(`${base}.${String(n)}`);
        } else want.add(base);
      }
      for (const key of want) expect(keys, key).toContain(key);
      // Back: every key of the chapter is a beat text, an action line of a beat, or the chapter's own words.
      const ids = new Set(beats.map((b) => b.id));
      for (const key of keys.filter((k) => k.startsWith(`tutorial.${id}.`))) {
        const rest = key.slice(`tutorial.${id}.`.length);
        if (META.test(rest)) continue;
        const beat = rest.split('.')[0] ?? '';
        expect(ids.has(beat), `${key} names no beat of ${id}`).toBe(true);
        expect(want.has(key) || key.endsWith('.act'), key).toBe(true);
      }
      for (let i = 1; i <= GOAL_COUNT[id]; i++)
        expect(keys).toContain(`tutorial.${id}.goal${String(i)}`);
      for (const meta of ['name', 'why', 'length', 'lesson1', 'lesson2', 'lesson3']) {
        expect(keys).toContain(`tutorial.${id}.${meta}`);
      }
    }
  });

  it('names only places of its map', () => {
    for (const id of CHAPTER_IDS) {
      const chapter = chapterOf(id);
      const map = chapterMap(chapter);
      for (const beat of [...chapter.beats, ...(chapter.fails ?? [])]) {
        for (const mark of beat.mark ?? []) {
          for (const name of [
            mark.node,
            mark.group,
            mark.at,
            mark.vp_badge,
            ...(mark.road ?? []),
          ]) {
            if (name != null)
              expect(nodeNamed(map, name), `${id} ${beat.id} ${name}`).toBeDefined();
          }
        }
        for (const turn of beat.turns ?? []) {
          for (const name of turn.nodes) expect(nodeNamed(map, name)).toBeDefined();
        }
      }
    }
  });
});

describe('card text', () => {
  it('cuts bold words, keys, the mouse and the amber sign', () => {
    expect(
      richText('Press {cancel_key}: **the army** turns back {click} {warn_sign}.', KEYS),
    ).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'key', text: 'C' },
      { kind: 'text', text: ': ' },
      { kind: 'bold', text: 'the army' },
      { kind: 'text', text: ' turns back ' },
      { kind: 'mouse' },
      { kind: 'text', text: ' ' },
      { kind: 'warn' },
      { kind: 'text', text: '.' },
    ]);
    expect(richText('{shift}-click {unknown}', KEYS)).toEqual([
      { kind: 'key', text: 'Shift' },
      { kind: 'text', text: '-click {unknown}' },
    ]);
  });
});

describe('gate (section 4.9)', () => {
  const flags = (id: Parameters<typeof chapterOf>[0], beat: string | null): UiFlag[] =>
    [...gateOf(chapterOf(id), beat)].sort();

  it('starts a chapter with the HUD of the chapters before it', () => {
    expect(flags('units', null)).toEqual([]);
    expect(flags('units', '1')).toEqual([]);
    expect(flags('economy', null)).toEqual(['terrainMode']);
    expect(flags('building', null)).toEqual(
      ['cp', 'notices', 'supply', 'terrainMode', 'warehouse'].sort(),
    );
    expect(flags('defence', null)).not.toContain('clock');
    expect(flags('defence', null)).toContain('vp');
  });

  it('unlocks each piece at its beat', () => {
    expect(flags('units', '6')).not.toContain('terrainMode');
    expect(flags('units', '7')).toContain('terrainMode');
    expect(flags('economy', '1')).toEqual(['cp', 'notices', 'terrainMode'].sort());
    expect(flags('economy', '2')).toContain('supply');
    expect(flags('economy', '2')).not.toContain('warehouse');
    expect(flags('economy', '3')).toContain('warehouse');
    expect(flags('building', '1')).toContain('buildings');
    expect(flags('building', '3')).not.toContain('recruit');
    expect(flags('building', '4')).toContain('recruit');
    expect(flags('building', '6')).not.toContain('factories');
    expect(flags('building', '7')).toContain('factories');
    expect(flags('building', '7')).not.toContain('stance');
    expect(flags('building', '8')).toContain('stance');
    expect(flags('attack', '7')).not.toContain('planned');
    expect(flags('attack', '8')).toContain('planned');
    expect(flags('attack', '10')).not.toContain('vp');
    expect(flags('attack', '11')).toEqual(expect.arrayContaining(['vp', 'clock']));
    // The clock stays to the end of chapter IV (review 5) and never carries over.
    expect(flags('attack', '13')).toEqual(expect.arrayContaining(['vp', 'clock']));
    expect(flags('defence', null)).not.toContain('terrainMarks');
    expect(flags('defence', '1')).toContain('terrainMarks');
    expect(flags('defence', '4')).toEqual(expect.arrayContaining(['alerts', 'fort']));
    expect(flags('group-orders', '1')).toContain('groupSelect');
    expect(flags('rally-points', '1')).toContain('rally');
  });

  it('shows everything outside a chapter', () => {
    expect([...FULL_GATE].sort()).toEqual([...UI_FLAGS].sort());
    expect(UI_FLAGS).toHaveLength(17);
  });

  it('keeps the allow of the beat before a beat that has none', () => {
    const units = chapterOf('units');
    expect(allowOf(units, null)).toEqual([]);
    expect(allowOf(units, '2')).toBe(units.beats[0].allow);
    expect(allowOf(units, '3')).toEqual([]);
    const failing = withFailure();
    expect(allowOf(failing, 'F')).toBe(failing.fails?.[0]?.allow);
    expect(allowOf(chapterOf('rally-points'), '3')).toBe(chapterOf('rally-points').beats[1]?.allow);
  });
});

describe('allow matcher (section 7.3)', () => {
  function context(map: MapFile, at: Record<string, string | null>): AllowContext {
    return {
      map,
      groupNode: (group) => {
        const name = at[group];
        return name == null ? null : (nodeNamed(map, name) ?? null);
      },
    };
  }
  const id = (map: MapFile, name: string): number => {
    const found = nodeNamed(map, name);
    if (found === undefined) throw new Error(name);
    return found;
  };
  const move = (group: string, dest: number, planned = false): Command => ({
    type: 'move',
    group,
    dest,
    planned,
    bonus: planned ? 1 : 0,
  });

  it('chapter I: the one move of the beat, ordinary only', () => {
    const units = chapterOf('units');
    const map = chapterMap(units);
    const ctx = context(map, { g: 'Highhold' });
    const allow = allowOf(units, '1');
    expect(commandAllowed(allow, [0], move('g', id(map, 'Ashford')), ctx)).toBe(true);
    expect(commandAllowed(allow, [0], move('g', id(map, 'Ashford'), true), ctx)).toBe(false);
    expect(commandAllowed(allow, [0], move('g', id(map, 'Reedwick')), ctx)).toBe(false);
    expect(commandAllowed(allow, [0], { type: 'recruit', node: id(map, 'Highhold') }, ctx)).toBe(
      false,
    );
    expect(commandAllowed(allow, [0], { type: 'merge', groups: ['g', 'h'] }, ctx)).toBe(false);
    // Leaving is always allowed; a beat that allows nothing allows nothing else.
    expect(commandAllowed([], [], { type: 'forfeit' }, ctx)).toBe(true);
    expect(commandAllowed(allowOf(units, '3'), [], move('g', id(map, 'Ashford')), ctx)).toBe(false);
  });

  it('chapter I.5: the move twice and the cancel once, counted by the server', () => {
    const units = chapterOf('units');
    const map = chapterMap(units);
    const allow = allowOf(units, '5');
    const there = context(map, { g: 'Ashford' });
    const marching = context(map, { g: null });
    expect(commandAllowed(allow, [0, 0], move('g', id(map, 'Elmstead')), there)).toBe(true);
    expect(commandAllowed(allow, [2, 0], move('g', id(map, 'Elmstead')), there)).toBe(false);
    expect(commandAllowed(allow, [1, 0], { type: 'cancel_order', group: 'g' }, marching)).toBe(
      true,
    );
    expect(commandAllowed(allow, [1, 1], { type: 'cancel_order', group: 'g' }, marching)).toBe(
      false,
    );
    // A group on a road stands nowhere: a move "from Ashford" is not its.
    expect(commandAllowed(allow, [0, 0], move('g', id(map, 'Elmstead')), marching)).toBe(false);
  });

  it('chapter IV.4 takes the head-on attack, IV.7 only the plan, IV.13 either', () => {
    const attack = chapterOf('attack');
    const map = chapterMap(attack);
    const ctx = context(map, { g: 'Fernhold' });
    const ashwood = id(map, 'Ashwood');
    // IV.4 the head-on attack only, IV.7 only the plan, IV.13 either (review 5, review 6 ids).
    expect(commandAllowed(allowOf(attack, '4'), [0], move('g', ashwood), ctx)).toBe(true);
    expect(commandAllowed(allowOf(attack, '4'), [0], move('g', ashwood, true), ctx)).toBe(false);
    expect(commandAllowed(allowOf(attack, '7'), [0], move('g', ashwood), ctx)).toBe(false);
    expect(commandAllowed(allowOf(attack, '7'), [0], move('g', ashwood, true), ctx)).toBe(true);
    // The wait for the refill (IV.6) allows nothing.
    expect(commandAllowed(allowOf(attack, '6'), [0], move('g', ashwood, true), ctx)).toBe(false);
    const actx = context(map, { g: 'Ashwood' });
    const storm = id(map, 'Stormcrown');
    expect(commandAllowed(allowOf(attack, '13'), [0], move('g', storm), actx)).toBe(true);
    expect(commandAllowed(allowOf(attack, '13'), [0], move('g', storm, true), actx)).toBe(true);
  });

  it('builds, recruits, stances, forts, group orders and rally points by their places', () => {
    const building = chapterOf('building');
    const bmap = chapterMap(building);
    const ctx = context(bmap, {});
    expect(
      commandAllowed(
        allowOf(building, '5'),
        [0],
        { type: 'build_factory', node: id(bmap, 'Millbrook') },
        ctx,
      ),
    ).toBe(true);
    expect(
      commandAllowed(
        allowOf(building, '5'),
        [0],
        { type: 'build_factory', node: id(bmap, 'Fernhill') },
        ctx,
      ),
    ).toBe(false);
    expect(
      commandAllowed(
        allowOf(building, '1'),
        [0],
        { type: 'build_barracks', node: id(bmap, 'Millbrook') },
        ctx,
      ),
    ).toBe(false);
    expect(
      commandAllowed(
        allowOf(building, '1'),
        [0],
        { type: 'build_barracks', node: id(bmap, 'Fernhill') },
        ctx,
      ),
    ).toBe(true);
    expect(
      commandAllowed(
        allowOf(building, '4'),
        [0],
        { type: 'recruit', node: id(bmap, 'Fernhill') },
        ctx,
      ),
    ).toBe(true);
    expect(
      commandAllowed(
        allowOf(building, '4'),
        [1],
        { type: 'recruit', node: id(bmap, 'Fernhill') },
        ctx,
      ),
    ).toBe(false);
    // III.8 takes every stance (review 6: War was locked and players asked why).
    expect(
      commandAllowed(allowOf(building, '8'), [0], { type: 'set_stance', stance: 'economy' }, ctx),
    ).toBe(true);
    expect(
      commandAllowed(allowOf(building, '8'), [0], { type: 'set_stance', stance: 'war' }, ctx),
    ).toBe(true);

    const defence = chapterOf('defence');
    const dmap = chapterMap(defence);
    const flatford = id(dmap, 'Flatford');
    const road = (a: number, b: number): number =>
      dmap.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))?.id ?? -1;
    const dctx = context(dmap, {});
    expect(
      commandAllowed(
        allowOf(defence, '4'),
        [0],
        { type: 'fortify_road', node: flatford, edge: road(flatford, id(dmap, 'Eastfield')) },
        dctx,
      ),
    ).toBe(true);
    expect(
      commandAllowed(
        allowOf(defence, '4'),
        [0],
        { type: 'fortify_road', node: flatford, edge: road(flatford, id(dmap, 'Millbrook')) },
        dctx,
      ),
    ).toBe(false);

    const group = chapterOf('group-orders');
    const gmap = chapterMap(group);
    const gctx = context(gmap, { a: 'Lowfield', b: 'Fernhold', c: 'Highhold' });
    const ashwood = id(gmap, 'Ashwood');
    const order = (groups: [string, ...string[]], planned = false): Command => ({
      type: 'group_move',
      groups,
      dest: ashwood,
      planned,
      bonus: 0,
    });
    expect(commandAllowed(allowOf(group, '1'), [0], order(['a', 'b']), gctx)).toBe(true);
    expect(commandAllowed(allowOf(group, '1'), [0], order(['b', 'a']), gctx)).toBe(true);
    expect(commandAllowed(allowOf(group, '1'), [0], order(['a', 'c']), gctx)).toBe(false);
    expect(commandAllowed(allowOf(group, '1'), [0], order(['a', 'b'], true), gctx)).toBe(false);
    expect(commandAllowed(allowOf(group, '1'), [0], move('a', ashwood), gctx)).toBe(false);

    const rally = chapterOf('rally-points');
    const rmap = chapterMap(rally);
    const rctx = context(rmap, {});
    const rp = (target: string): Command => ({
      type: 'set_rally_point',
      node: id(rmap, 'Highhold'),
      target: id(rmap, target),
    });
    expect(commandAllowed(allowOf(rally, '1'), [0], rp('Fernhold'), rctx)).toBe(true);
    expect(commandAllowed(allowOf(rally, '1'), [0], rp('Wyre'), rctx)).toBe(false);
  });
});

describe('coach on recorded tutorial streams', () => {
  const msg = (
    chapter: TutorialMsg['chapter'],
    beat: string | null,
    paused: boolean,
    used: number[] = [],
    done = false,
    tick = 0,
    clock_end: number | null = null,
    by_clock = false,
  ): TutorialMsg => ({
    type: 'tutorial',
    chapter,
    beat,
    paused,
    used,
    done,
    tick,
    clock_end,
    by_clock,
  });

  function coachOf(
    id: Parameters<typeof chapterOf>[0] | Chapter,
    at: Record<string, string | null> = {},
  ) {
    const chapter = typeof id === 'string' ? chapterOf(id) : id;
    const map = chapterMap(chapter);
    let resumed = 0;
    const coach = new TutorialCoach(chapter, {
      resume: () => {
        resumed += 1;
      },
      context: {
        map,
        groupNode: (g) => {
          const name = at[g];
          return name == null ? null : (nodeNamed(map, name) ?? null);
        },
      },
    });
    // The map has drawn the chapter's first tick: the beats of tick 0 show at once.
    coach.onRender(0);
    return { coach, map, resumed: () => resumed };
  }

  it('walks chapter I: a selection starts I.2, Continue resumes, the cancel is allowed in I.5', () => {
    const { coach, map, resumed } = coachOf('units', { g: 'Highhold' });
    expect(coach.current.card).toBeNull();
    coach.onMessage(msg('units', '1', true, [0]));
    expect(coach.current.card?.id).toBe('1');
    expect(coach.current.card?.step).toBe(1);
    expect(coach.current.card?.steps).toBe(7);
    expect(coach.current.card?.canContinue).toBe(false);
    expect(coach.current.paused).toBe(true);
    expect(coach.current.gate.size).toBe(0);
    // A selection elsewhere does nothing; the army's group starts the UI beat I.2.
    coach.onSelection({ node: nodeNamed(map, 'Ashford') ?? null });
    expect(coach.current.card?.id).toBe('1');
    coach.onSelection({ node: nodeNamed(map, 'Highhold') ?? null });
    expect(coach.current.card?.id).toBe('2');
    expect(coach.current.card?.step).toBe(2);
    expect(coach.current.paused).toBe(true);
    expect(
      coach.allows({
        type: 'move',
        group: 'g',
        dest: nodeNamed(map, 'Ashford') ?? -1,
        planned: false,
        bonus: 0,
      }),
    ).toBe(true);
    // The server names I.3 (the move accepted): a Continue card.
    coach.onMessage(msg('units', '3', true, []));
    expect(coach.current.card?.id).toBe('3');
    expect(coach.current.card?.canContinue).toBe(true);
    coach.continue();
    expect(resumed()).toBe(1);
    // Continued: the card and its marks go while the army walks (review 4, P2).
    coach.onMessage(msg('units', '3', false, []));
    expect(coach.current.card).toBeNull();
    expect(coach.current.paused).toBe(false);
    coach.onMessage(msg('units', '4', true, []));
    coach.onMessage(msg('units', '5', true, [0, 0]));
    expect(coach.current.card?.id).toBe('5');
    expect(coach.allows({ type: 'cancel_order', group: 'g' })).toBe(true);
    // The move stands: the card goes; called back, it comes again; sent again, it goes.
    coach.onMessage(msg('units', '5', false, [1, 0]));
    expect(coach.current.card).toBeNull();
    coach.onMessage(msg('units', '5', false, [1, 1]));
    expect(coach.current.card?.id).toBe('5');
    expect(coach.allows({ type: 'cancel_order', group: 'g' })).toBe(false);
    coach.onMessage(msg('units', '5', false, [2, 1]));
    expect(coach.current.card).toBeNull();
    coach.onMessage(msg('units', '7', true, [0]));
    expect(coach.current.card?.turns?.map((t) => t.word)).toEqual([
      'plains',
      'forest',
      'mountains',
    ]);
    expect(coach.shows('terrainMode')).toBe(true);
    // The goal: the match ends, the Seal shows at once.
    coach.onMessage(msg('units', '7', false, [1], true));
    expect(coach.sealed).toBe(false);
    coach.finish();
    expect(coach.sealed).toBe(true);
  });

  it('pages the slides of a card and keeps them on a new message of the same beat', () => {
    const { coach } = coachOf(withFailure(), { g: 'Fernhold' });
    coach.onMessage(msg('attack', '3', true, []));
    coach.onMessage(msg('attack', '4', true, [0]));
    expect(coach.current.card?.slides).toBe(3);
    expect(coach.slide).toBe(0);
    coach.nextSlide();
    coach.nextSlide();
    coach.nextSlide();
    expect(coach.slide).toBe(2);
    coach.onMessage(msg('attack', '4', true, [0]));
    expect(coach.slide).toBe(2);
    coach.onMessage(msg('attack', '5', true, []));
    expect(coach.slide).toBe(0);
  });

  it('pages the terrains of I.7 one a page: Next, never a timer (review 5, P9)', () => {
    const { coach } = coachOf('units', {});
    coach.onMessage(msg('units', '7', true, []));
    const card = coach.current.card;
    expect(card?.slides).toBe(1);
    expect(card?.turns?.map((turn) => turn.word)).toEqual(['plains', 'forest', 'mountains']);
    expect(card?.pages).toBe(3);
    expect(coach.slide).toBe(0);
    coach.nextSlide();
    coach.nextSlide();
    coach.nextSlide();
    expect(coach.slide).toBe(2);
    // A card with one terrain has one page (I.6): its Continue is on it.
    coach.onMessage(msg('units', '6', true, []));
    expect(coach.current.card?.pages).toBe(1);
  });

  it('walks a failure beat: Try again, the plan unlocked, only the plan allowed', () => {
    const { coach, map } = coachOf(withFailure(), { g: 'Fernhold' });
    coach.onMessage(msg('attack', '4', true, [0]));
    expect(coach.shows('planned')).toBe(false);
    coach.onMessage(msg('attack', 'F', true, [0]));
    expect(coach.current.card?.fail).toBe(true);
    expect(coach.current.card?.step).toBe(0);
    expect(coach.current.card?.canContinue).toBe(true);
    expect(coach.shows('planned')).toBe(true);
    const ashwood = nodeNamed(map, 'Ashwood') ?? -1;
    expect(
      coach.allows({ type: 'move', group: 'g', dest: ashwood, planned: false, bonus: 0 }),
    ).toBe(false);
    expect(coach.allows({ type: 'move', group: 'g', dest: ashwood, planned: true, bonus: 3 })).toBe(
      true,
    );
    // The planned order accepted: IV.9 shows no card while the army walks, the plan stays shown.
    coach.onMessage(msg('attack', '9', false, []));
    expect(coach.current.card).toBeNull();
    expect(coach.shows('planned')).toBe(true);
  });

  it('walks chapter IV: the head-on attack, the plan, and the clock to the end (review 5)', () => {
    const { coach, map } = coachOf('attack', { g: 'Fernhold' });
    // The rounds and no leaving a fight come before the first fight (review 6).
    coach.onMessage(msg('attack', '2', true, []));
    expect(coach.current.card?.canContinue).toBe(true);
    coach.onMessage(msg('attack', '4', true, [0]));
    expect(coach.current.card?.fail).toBe(false);
    expect(coach.shows('planned')).toBe(false);
    coach.onMessage(msg('attack', '5', true, [], false, 148));
    coach.onRender(148);
    expect(coach.current.card?.id).toBe('5');
    // The refill: a card that asks the player to wait, no Continue, no mark (review 6).
    coach.onMessage(msg('attack', '6', false, [], false, 148));
    expect(coach.current.card?.id).toBe('6');
    expect(coach.current.card?.canContinue).toBe(false);
    expect(coach.current.card?.marks).toEqual([]);
    expect(coach.current.focus).toBeNull();
    coach.onMessage(msg('attack', '7', true, [0], false, 218));
    coach.onRender(218);
    expect(coach.current.card?.id).toBe('7');
    coach.onSelection({ node: nodeNamed(map, 'Fernhold') ?? null });
    expect(coach.current.card?.id).toBe('8');
    expect(coach.shows('planned')).toBe(true);
    expect(coach.current.clockEnd).toBeNull();
    coach.onMessage(msg('attack', '11', true, [], false, 469, 1069));
    coach.onRender(469);
    expect(coach.shows('clock')).toBe(true);
    expect(coach.current.clockEnd).toBe(1069);
    coach.onMessage(msg('attack', '12', false, [], false, 469, 1069));
    expect(coach.current.card?.id).toBe('12');
    expect(coach.current.focus).toBeNull();
    coach.onMessage(msg('attack', '13', true, [0], false, 502, 1069));
    coach.onRender(502);
    expect(coach.shows('clock')).toBe(true);
    // The clock ran out: the chapter ends as won by VP.
    coach.onMessage(msg('attack', '13', false, [1], true, 502, 1069, true));
    expect(coach.current.byClock).toBe(true);
  });

  it('allows the stance at every beat after chapter III, never ending a pause (review 5)', () => {
    const war = { type: 'set_stance', stance: 'war' } as const;
    for (const id of ['attack', 'defence', 'group-orders', 'rally-points'] as const) {
      const { coach } = coachOf(id);
      coach.onMessage(msg(id, '1', true, [0]));
      expect(coach.allows(war)).toBe(true);
      expect(coach.allowsFacts({ command: 'set_stance' })).toBe(true);
    }
    const { coach } = coachOf('building');
    coach.onMessage(msg('building', '1', true, [0]));
    expect(coach.allows(war)).toBe(false);
  });

  it('walks the menu beat of chapter III when the menu of Fernhill opens', () => {
    const { coach, map } = coachOf('building');
    coach.onMessage(msg('building', '1', true, [0]));
    expect(coach.current.card?.id).toBe('1');
    coach.onMenu(nodeNamed(map, 'Millbrook') ?? null);
    expect(coach.current.card?.id).toBe('1');
    coach.onMenu(nodeNamed(map, 'Fernhill') ?? null);
    expect(coach.current.card?.id).toBe('2');
    expect(coach.menuMarks()).toEqual([{ item: 'barracks', node: nodeNamed(map, 'Fernhill') }]);
    coach.onMenu(null);
    expect(coach.current.card?.id).toBe('2');
    // The barracks ordered: the card goes (P2), the next server beat shows.
    coach.onMessage(msg('building', '1', false, [1]));
    expect(coach.current.card).toBeNull();
  });

  it('keeps the last card of a goal with Continue before the Seal (A1.5)', () => {
    const { coach, resumed } = coachOf('group-orders');
    coach.onMessage(msg('group-orders', '1', true, [0]));
    coach.onSelection({ node: null });
    expect(coach.current.card?.id).toBe('2');
    coach.onMessage(msg('group-orders', '3', false, []));
    coach.onMessage(msg('group-orders', '5', false, [], true));
    expect(coach.current.card?.canContinue).toBe(true);
    coach.finish();
    expect(coach.sealed).toBe(false);
    coach.continue();
    expect(resumed()).toBe(0);
    expect(coach.sealed).toBe(true);
  });

  it('shows a beat only once the map has drawn its tick (review 4, P1)', () => {
    const { coach } = coachOf('units', { g: 'Highhold' });
    coach.onMessage(msg('units', '3', true, [], false, 1));
    coach.onRender(1);
    expect(coach.current.card?.id).toBe('3');
    coach.onMessage(msg('units', '3', false, [], false, 1));
    // I.4 begins at 77; the map is still at 75: nothing shows, the pause is the server's already.
    coach.onRender(75);
    coach.onMessage(msg('units', '4', true, [], false, 77));
    expect(coach.current.card).toBeNull();
    expect(coach.current.paused).toBe(true);
    coach.onRender(76);
    expect(coach.current.card).toBeNull();
    coach.onRender(77);
    expect(coach.current.card?.id).toBe('4');
    expect(coach.current.card?.canContinue).toBe(true);
  });

  it('shows a beat anyway when the map draws nothing for a while', () => {
    vi.useFakeTimers();
    try {
      const { coach } = coachOf('units', { g: 'Highhold' });
      coach.onMessage(msg('units', '4', true, [], false, 77));
      expect(coach.current.card).toBeNull();
      vi.advanceTimersByTime(BEAT_FALLBACK_MS - 1);
      expect(coach.current.card).toBeNull();
      vi.advanceTimersByTime(1);
      expect(coach.current.card?.id).toBe('4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a card that asks for two orders until both stand (A2.2)', () => {
    const { coach } = coachOf('rally-points');
    coach.onMessage(msg('rally-points', '2', true, [0]));
    expect(coach.current.card?.id).toBe('2');
    coach.onMessage(msg('rally-points', '2', false, [1]));
    expect(coach.current.card?.id).toBe('2');
    coach.onMessage(msg('rally-points', '2', false, [2]));
    expect(coach.current.card).toBeNull();
  });

  it('builds the factory and the road fort in two steps, like the barracks (review 6)', () => {
    for (const [id, beat, node, item] of [
      ['building', '5', 'Millbrook', 'factory'],
      ['defence', '4', 'Flatford', 'fortify'],
    ] as const) {
      const { coach, map } = coachOf(id);
      coach.onMessage(msg(id, beat, true, [0]));
      expect(coach.current.card?.id).toBe(beat);
      coach.onMenu(nodeNamed(map, node) ?? null);
      const next = String(Number(beat) + 1);
      expect(coach.current.card?.id).toBe(next);
      expect(coach.menuMarks()).toEqual([{ item, node: nodeNamed(map, node) }]);
      // The item chosen and the order given: the card goes (P2).
      coach.onMessage(msg(id, beat, false, [1]));
      expect(coach.current.card).toBeNull();
    }
  });

  it('shows no card for a beat that answers the order while the army walks (A1.3, IV.9, A2.3)', () => {
    for (const [id, beat] of [
      ['group-orders', '3'],
      ['attack', '9'],
      ['rally-points', '3'],
    ] as const) {
      const { coach } = coachOf(id, { g: 'Fernhold' });
      coach.onMessage(msg(id, beat, false, []));
      expect(coach.current.card).toBeNull();
      expect(coach.hudMarks()).toEqual([]);
      // The next beat shows again.
      if (id !== 'rally-points') {
        coach.onMessage(msg(id, id === 'group-orders' ? '4' : '10', true, []));
        expect(coach.current.card).not.toBeNull();
      }
    }
  });

  it('keeps a failure card after Continue until the plan is given', () => {
    const { coach } = coachOf(withFailure(), { g: 'Fernhold' });
    coach.onMessage(msg('attack', 'F', true, [0]));
    coach.onMessage(msg('attack', 'F', false, [0]));
    expect(coach.current.card?.id).toBe('F');
    expect(coach.current.card?.canContinue).toBe(false);
    coach.onMessage(msg('attack', 'F', false, [1]));
    expect(coach.current.card).toBeNull();
  });

  it('walks a focus phase: no card, its marks, no step lozenge (review 4, P5)', () => {
    const { coach } = coachOf('economy');
    coach.onMessage(msg('economy', '1', true, []));
    expect(coach.current.card?.steps).toBe(5);
    expect(coach.current.focus).toBeNull();
    const seq = coach.current.seq;
    coach.onMessage(msg('economy', '1W', false, []));
    expect(coach.current.card).toBeNull();
    expect(coach.current.focus).toEqual([{ hud: 'cp' }]);
    expect(coach.hudMarks()).toEqual(['cp']);
    expect(coach.current.seq).toBeGreaterThan(seq);
    coach.onMessage(msg('economy', '2', true, [], false, 35));
    expect(coach.current.focus).toBeNull();
    coach.onRender(35);
    expect(coach.current.card?.id).toBe('2');
    expect(coach.current.card?.step).toBe(2);
    expect(coach.shows('supply')).toBe(true);
  });

  it('counts the standing orders, a cancel taking one back', () => {
    const allow = chapterOf('units').beats[4]?.allow ?? [];
    expect(standingOrders(allow, [0, 0])).toBe(0);
    expect(standingOrders(allow, [1, 0])).toBe(1);
    expect(standingOrders(allow, [1, 1])).toBe(0);
    expect(standingOrders(allow, [2, 1])).toBe(1);
  });

  it('shows no card before the first beat and allows nothing', () => {
    const { coach } = coachOf('defence');
    coach.onMessage(msg('defence', null, false, []));
    expect(coach.current.card).toBeNull();
    expect(coach.current.allow).toEqual([]);
    expect(coach.shows('vp')).toBe(true);
    expect(coach.shows('fort')).toBe(false);
  });
});

describe('progress (section 7.8) and Charter (section 3)', () => {
  it('reads the server progress and writes only the flags', () => {
    const wire = {
      done: ['units', 'nope', 'units'],
      offer_off: true,
      first_match: false,
      first_match_id: '7',
      hints: ['H3', 'H9', 'H1'],
      hints_off: true,
    } as unknown as Parameters<typeof fromWire>[0];
    const progress = fromWire(wire);
    expect(progress).toEqual({
      v: 1,
      done: ['units'],
      offerOff: true,
      firstMatch: false,
      firstMatchId: '7',
      hints: ['H1', 'H3'],
      hintsOff: true,
    });
    expect(toFlags(progress)).toEqual({
      offer_off: true,
      first_match: false,
      first_match_id: '7',
      hints: ['H1', 'H3'],
      hints_off: true,
    });
  });

  it('offers the tutorial until a chapter is done, the first match played or the box ticked', () => {
    expect(offerAllowed(EMPTY_PROGRESS)).toBe(true);
    expect(offerAllowed({ ...EMPTY_PROGRESS, done: ['units'] })).toBe(false);
    expect(offerAllowed({ ...EMPTY_PROGRESS, firstMatch: true })).toBe(false);
    expect(offerAllowed({ ...EMPTY_PROGRESS, offerOff: true })).toBe(false);
  });

  it('opens the seals as the walkthrough shows them (R.1 to R.3)', () => {
    expect(sealStates(EMPTY_PROGRESS)).toEqual({
      units: 'next',
      economy: 'locked',
      building: 'locked',
      attack: 'locked',
      defence: 'locked',
      match: 'open',
      'group-orders': 'locked',
      'rally-points': 'locked',
      'supply-distribution': 'locked',
    });
    expect(defaultSeat(EMPTY_PROGRESS)).toBe('units');
    const progress: TutorialProgress = {
      ...EMPTY_PROGRESS,
      done: ['units', 'economy', 'building'],
    };
    expect(sealStates(progress)).toMatchObject({
      building: 'done',
      attack: 'next',
      defence: 'locked',
      match: 'open',
    });
    const finished: TutorialProgress = {
      ...EMPTY_PROGRESS,
      done: ['units', 'economy', 'building', 'attack', 'defence', 'group-orders'],
      firstMatch: true,
    };
    expect(sealStates(finished)).toMatchObject({
      defence: 'done',
      match: 'done',
      'group-orders': 'done',
      'rally-points': 'next',
      'supply-distribution': 'open',
    });
    expect(defaultSeat(finished)).toBe('rally-points');
  });
});
