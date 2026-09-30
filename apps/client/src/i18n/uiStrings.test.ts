// The i18n check (AGENTS.md §7.4): no UI strings outside the dictionaries (tests are not UI and
// may assert on dictionary text). Run alone with
// `pnpm check:i18n`; the key sets of the dictionaries are compared in i18n.test.ts.
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const components = import.meta.glob<string>('../**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sources = import.meta.glob<string>(
  ['../**/*.ts', '../**/*.svelte', '!./**', '!../**/*.test.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

/** Attributes whose text a viewer reads or hears. */
const UI_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'label',
  'placeholder',
  'title',
]);
const LETTER = /\p{L}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

/** Literal text in markup and in UI attributes: it must come from `t()` instead. */
function literalUiText(source: string): string[] {
  const found: string[] = [];
  const visit = (node: object): void => {
    if ('type' in node && node.type === 'Text' && 'data' in node && typeof node.data === 'string') {
      if (LETTER.test(node.data)) {
        found.push(node.data.trim());
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes' && Array.isArray(value)) {
        for (const attribute of value as AST.BaseElement['attributes']) {
          if (attribute.type === 'Attribute' && UI_ATTRIBUTES.has(attribute.name)) {
            const parts = Array.isArray(attribute.value) ? attribute.value : [attribute.value];
            for (const part of parts) {
              if (typeof part === 'object' && part.type === 'Text' && LETTER.test(part.data)) {
                found.push(`${attribute.name}="${part.data}"`);
              }
            }
          }
        }
      } else if (isFragment(value)) {
        value.nodes.forEach(visit);
      }
    }
  };
  parse(source, { modern: true }).fragment.nodes.forEach(visit);
  return found;
}

function isFragment(value: unknown): value is AST.Fragment {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'Fragment'
  );
}

describe('UI strings', () => {
  it('finds literal text (self-check of the scanner)', () => {
    const source =
      '<p title="Hint">Hello {name}</p>{#if x}<b>Да</b>{/if}<i class="a" aria-label={t("k")}>: 1</i>';
    expect(literalUiText(source)).toEqual(['title="Hint"', 'Hello', 'Да']);
  });

  it.each(Object.entries(components))('%s has no literal text in markup', (_path, source) => {
    expect(literalUiText(source)).toEqual([]);
  });

  it.each(Object.entries(sources))(
    '%s has no Russian text outside the dictionaries',
    (_path, source) => {
      expect(source.split('\n').filter((line) => CYRILLIC.test(line))).toEqual([]);
    },
  );
});
