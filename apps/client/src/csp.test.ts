import { describe, expect, it } from 'vitest';
import { CSP, CSP_DIRECTIVES } from '../csp.ts';

describe('target CSP', () => {
  it('allows neither eval nor inline code', () => {
    expect(CSP).not.toContain('unsafe-eval');
    expect(CSP).not.toContain('unsafe-inline');
  });

  it('keeps scripts, styles and workers locked down', () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['style-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['worker-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
  });
});
