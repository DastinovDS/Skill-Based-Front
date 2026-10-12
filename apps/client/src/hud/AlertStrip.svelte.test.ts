import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import AlertStrip from './AlertStrip.svelte';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 100);
const mine = snapshot.view.nodes.find((n) => n.owner === 0);
const theirs = snapshot.view.nodes.find((n) => n.owner === 1);
if (mine === undefined || theirs === undefined) throw new Error('small map');

describe('AlertStrip', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    setLocale(initial);
    document.body.innerHTML = '';
  });

  it('says that enemies are coming for a city of mine, with a countdown and the key', () => {
    setLocale('en');
    const hud = new HudState({ me: 0, rules: DEV_RULES, map: DEFAULT_MAP });
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(AlertStrip, { target, props: { alerts: hud.alerts } });
    expect(target.querySelector('.alerts')).toBeNull();
    hud.onSnapshot({
      ...snapshot,
      view: {
        ...snapshot.view,
        intents: [
          {
            id: 'i',
            owner: 1,
            kind: 'planned_move',
            origin: theirs.id,
            target: mine.id,
            created_tick: 90,
          },
        ],
      },
    });
    flushSync();
    const text = target.textContent.replace(/\s+/g, ' ');
    expect(text).toContain(`They are coming for city ${String(mine.id)}`);
    // 30 ticks of delay, 10 passed: 20 ticks = 2.0 s.
    expect(text).toContain('they leave in 2.0 s');
    expect(text).toContain('Space');
    hud.onSnapshot(snapshot);
    flushSync();
    expect(target.querySelector('.alerts')).toBeNull();
  });
});
