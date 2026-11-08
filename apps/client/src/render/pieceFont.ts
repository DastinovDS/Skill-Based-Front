import type { TextStyle } from 'pixi.js';
import { FONT } from '../theme/tokens.ts';

/**
 * The numbers of the Engraved pieces (#847) are set in EB Garamond (`FONT.text`, self-hosted by
 * `app.css`). A PixiJS text is drawn once with whatever font is loaded then, so a style starts in a
 * plain serif while the font is still on its way and takes EB Garamond when `document.fonts` has it:
 * the family changes, so every text of the style is drawn again (ui-style 58).
 */
const PROBE = "600 12px 'EB Garamond'";
const FALLBACK = "Georgia, 'Times New Roman', serif";

function fonts(): FontFaceSet | null {
  return typeof document === 'undefined' || !('fonts' in document) ? null : document.fonts;
}

/** The family to start a piece's text with: EB Garamond if it is loaded already, else the fallback. */
export function pieceFamily(): string {
  try {
    return fonts()?.check(PROBE) === true ? FONT.text : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Sets EB Garamond on `styles` once the font is loaded (at once if it is); a no-op without fonts. */
export function usePieceFont(styles: readonly TextStyle[]): void {
  const set = fonts();
  if (set === null) return;
  set.load(PROBE).then(
    () => {
      for (const style of styles) {
        if (style.fontFamily !== FONT.text) style.fontFamily = FONT.text;
      }
    },
    () => undefined,
  );
}
