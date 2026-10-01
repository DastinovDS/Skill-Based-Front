/**
 * Static legal pages (LEG-01, #87): per-locale content files, not dictionary entries, because
 * they are long documents. Placeholders look like `<OPERATOR_NAME>`; the page shows a draft
 * notice while any is left (`hasPlaceholders`). A lawyer must review the texts before publishing
 * (docs/ops/legal.md).
 */
export interface LegalSection {
  readonly heading: string;
  /** Paragraphs of text. */
  readonly body: readonly string[];
  /** Optional bullet list after the paragraphs. */
  readonly items?: readonly string[];
}

export interface LegalDocument {
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

export interface LegalContent {
  readonly impressum: LegalDocument;
  readonly privacy: LegalDocument;
}

export type LegalPageId = keyof LegalContent;

/** A placeholder the operator has to fill in, e.g. `<OPERATOR_NAME>`. */
export const PLACEHOLDER = /<[A-Z][A-Z0-9_]*>/;

export function hasPlaceholders(document: LegalDocument): boolean {
  return document.sections.some((section) =>
    [section.heading, ...section.body, ...(section.items ?? [])].some((text) =>
      PLACEHOLDER.test(text),
    ),
  );
}
