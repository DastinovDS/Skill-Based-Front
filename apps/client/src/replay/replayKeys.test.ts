import { describe, expect, it } from 'vitest';
import { replayKey, type ReplayKeyInput } from './replayKeys.ts';

const press = (code: string, extra: Partial<ReplayKeyInput> = {}): ReturnType<typeof replayKey> =>
  replayKey({ code, ctrlKey: false, metaKey: false, altKey: false, onControl: false, ...extra });

describe('replayKey', () => {
  it('maps the keys of ui-style 13.7', () => {
    expect(press('Space')).toEqual({ kind: 'toggle' });
    expect(press('ArrowLeft')).toEqual({ kind: 'skip', seconds: -5 });
    expect(press('ArrowRight')).toEqual({ kind: 'skip', seconds: 5 });
    expect(press('Digit1')).toEqual({ kind: 'speed', speed: 1 });
    expect(press('Digit2')).toEqual({ kind: 'speed', speed: 4 });
    expect(press('Numpad3')).toEqual({ kind: 'speed', speed: 16 });
    expect(press('Home')).toEqual({ kind: 'fit' });
    expect(press('KeyF')).toEqual({ kind: 'fog' });
    expect(press('Escape')).toEqual({ kind: 'back' });
  });

  it('leaves Space to a focused control and ignores other keys and shortcuts', () => {
    expect(press('Space', { onControl: true })).toBeNull();
    expect(press('KeyA')).toBeNull();
    expect(press('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(press('Digit1', { metaKey: true })).toBeNull();
  });
});
