import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES, setLocale, type Locale } from '../i18n/index.ts';
import { hasPlaceholders, LEGAL_CONTENT, type LegalPageId } from '../i18n/legal/index.ts';
import LegalFooter from './LegalFooter.svelte';
import LegalPage from './LegalPage.svelte';

const PAGES: readonly LegalPageId[] = ['impressum', 'privacy'];

describe('legal content', () => {
  it.each(PAGES)('%s has the same structure in every language', (page) => {
    const shape = (locale: Locale) =>
      LEGAL_CONTENT[locale][page].sections.map((s) => [s.body.length, s.items?.length ?? 0]);
    for (const locale of LOCALES) {
      expect(shape(locale), locale).toEqual(shape('en'));
    }
  });

  it('is a draft while operator placeholders are left', () => {
    expect(hasPlaceholders({ title: 'x', sections: [{ heading: 'h', body: ['<EMAIL>'] }] })).toBe(
      true,
    );
    expect(hasPlaceholders({ title: 'x', sections: [{ heading: 'h', body: ['a@b.de'] }] })).toBe(
      false,
    );
  });

  it('names exactly the browser storage keys the code uses', () => {
    // Every `sbf.*` key in the client source (not in tests, not in the legal text itself).
    const sources = import.meta.glob<string>(
      ['../**/*.ts', '../**/*.svelte', '!../**/*.test.ts', '!../i18n/legal/*.ts'],
      { eager: true, query: '?raw', import: 'default' },
    );
    const used = new Set<string>();
    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(/'(sbf\.[a-z]+(?:\.[a-z]+)*)'/g)) {
        used.add(match[1] ?? '');
      }
    }
    expect([...used].sort()).toEqual([
      'sbf.guest',
      'sbf.hints.last',
      'sbf.hints.matches',
      'sbf.locale',
    ]);
    for (const locale of LOCALES) {
      const text = JSON.stringify(LEGAL_CONTENT[locale].privacy);
      const named = new Set(text.match(/sbf\.[a-z]+(?:\.[a-z]+)*/g));
      expect([...named].sort(), locale).toEqual([...used].sort());
    }
  });

  it('does not send the reader to menu items that no longer exist', () => {
    for (const locale of LOCALES) {
      const text = JSON.stringify(LEGAL_CONTENT[locale].privacy);
      expect(text, locale).not.toContain('Change nickname');
    }
  });
});

describe('legal components', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  it('footer links to both pages in a new tab', () => {
    component = mount(LegalFooter, { target: document.body });
    flushSync();
    const links = [...document.body.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/impressum', '/privacy']);
    expect(links.every((a) => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
    expect(document.body.querySelector('[style]')).toBeNull();
  });

  it.each(LOCALES)('page renders the document and the draft notice in %s', (locale) => {
    setLocale(locale);
    component = mount(LegalPage, { target: document.body, props: { page: 'privacy' } });
    flushSync();
    expect(document.body.querySelector('h1')?.textContent).toBe(
      LEGAL_CONTENT[locale].privacy.title,
    );
    expect(document.body.querySelector('[role="note"]')).not.toBeNull();
    expect(document.body.querySelector('[style]')).toBeNull();
  });
});
