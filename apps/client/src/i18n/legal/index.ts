import type { Locale } from '../locale.ts';
import { en } from './en.ts';
import { ru } from './ru.ts';
import type { LegalContent } from './types.ts';

export { hasPlaceholders } from './types.ts';
export type { LegalContent, LegalDocument, LegalPageId, LegalSection } from './types.ts';

export const LEGAL_CONTENT: Readonly<Record<Locale, LegalContent>> = { ru, en };
