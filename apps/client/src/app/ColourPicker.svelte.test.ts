import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en.ts';
import type { MessageKey } from '../i18n/index.ts';
import type { PlayerColour } from '../protocol.gen.ts';
import { PLAYER_COLOUR_IDS } from '../theme/tokens.ts';
import ColourPicker from './ColourPicker.svelte';

describe('ColourPicker (DEC-49)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  const radios = (): HTMLButtonElement[] => [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];

  function setup(
    value: PlayerColour | null,
    answer: MessageKey | null = null,
  ): ReturnType<typeof vi.fn<(colour: PlayerColour) => Promise<MessageKey | null>>> {
    const onchange = vi.fn<(colour: PlayerColour) => Promise<MessageKey | null>>(() =>
      Promise.resolve(answer),
    );
    component = mount(ColourPicker, { target: document.body, props: { value, onchange } });
    flushSync();
    return onchange;
  }

  it('shows the six colours of the set by name, the current one checked', () => {
    setup('violet');
    const all = radios();
    expect(all.map((b) => b.textContent.trim())).toEqual([
      'Lapis',
      'Minium',
      'Glacier',
      'Shell',
      'Violet',
      'Madder',
    ]);
    expect(
      all.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent.trim()),
    ).toEqual(['Violet']);
    // One stop in the tab order: the checked one.
    expect(all.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(
      document.body.querySelector('[role="radiogroup"]')?.getAttribute('aria-labelledby'),
    ).toBeTruthy();
  });

  it('shows Lapis, the default of the server, while the colour is not known yet', () => {
    setup(null);
    expect(radios()[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('asks to save a clicked colour and says it was saved', async () => {
    const onchange = setup('lapis');
    radios()[3]?.click();
    await tick();
    await tick();
    expect(onchange).toHaveBeenCalledWith('shell');
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(
      'Colour saved: Shell.',
    );
  });

  it('moves the choice with the arrow keys, round the ends', () => {
    const onchange = setup('lapis');
    radios()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith('madder');
    radios()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith('minium');
    radios()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith('madder');
  });

  it('says why a colour was not saved', async () => {
    setup('lapis', 'error.api.network');
    radios()[1]?.click();
    await tick();
    await tick();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      en['error.api.network'],
    );
  });

  it('has a name in the dictionary for every colour of the set', () => {
    for (const id of PLAYER_COLOUR_IDS) expect(en[`colour.${id}`]).toBeTruthy();
  });
});
