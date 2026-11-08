import { describe, expect, it } from 'vitest';
import config, { COPYRIGHT_BANNER } from '../vite.config.ts';

// #835: the production bundle carries the copyright notice. `mise run build` plus
// `grep -L` over dist/**/*.js shows the real result; this guards the config.
describe('copyright banner', () => {
  it('is a legal comment (/*!) with the notice', () => {
    expect(COPYRIGHT_BANNER).toBe('/*! © 2026 Daniil Stepanov. All rights reserved. */');
  });

  it('is set on the build output and survives minification', () => {
    const output = config.build?.rolldownOptions?.output;
    expect(output).toMatchObject({ banner: COPYRIGHT_BANNER, comments: { legal: true } });
  });
});
