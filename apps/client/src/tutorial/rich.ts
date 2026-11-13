/**
 * The text of a tutorial card (`docs/design/tutorial.md`, section 4.0): a dictionary string with a
 * little markup, cut into segments the card draws, so no markup string reaches the page
 * (`AGENTS.md` 7.4: no `{@html}`). `**word**` is bold; `{click}` the mouse glyph; `{warn_sign}` the
 * amber "waiting for charges" sign of the map; `{shift}` and `{<action>_key}` a key cap with the
 * player's own binding.
 */
import type { KeyAction } from '../app/keyBindings.ts';

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'key'; readonly text: string }
  | { readonly kind: 'mouse' }
  | { readonly kind: 'warn' };

/** The key actions a card may name, by their placeholder (`{cancel_key}` -> `cancel`). */
const KEY_PLACEHOLDERS: Readonly<Record<string, KeyAction>> = {
  cancel_key: 'cancel',
  terrain_key: 'terrain',
  recruit_key: 'recruit',
  stance_key: 'stance',
  planned_key: 'planned',
  fortify_key: 'fortify',
  rally_key: 'rally',
};

export interface RichKeys {
  /** The readable name of the player's key for `action`. */
  label(action: KeyAction): string;
  /** The readable name of Shift. */
  readonly shift: string;
}

/** The segments of `source`; an unknown placeholder stays as text. */
export function richText(source: string, keys: RichKeys): Segment[] {
  const out: Segment[] = [];
  const push = (segment: Segment): void => {
    const last = out[out.length - 1];
    if (segment.kind === 'text' && last?.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + segment.text };
    } else if (segment.kind !== 'text' || segment.text !== '') out.push(segment);
  };
  const pattern = /\*\*(.+?)\*\*|\{(\w+)\}/g;
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    push({ kind: 'text', text: source.slice(at, match.index) });
    at = match.index + match[0].length;
    const bold = match[1];
    const name = match[2];
    if (bold !== undefined) push({ kind: 'bold', text: bold });
    else if (name === 'click') push({ kind: 'mouse' });
    else if (name === 'warn_sign') push({ kind: 'warn' });
    else if (name === 'shift') push({ kind: 'key', text: keys.shift });
    else if (name !== undefined && Object.hasOwn(KEY_PLACEHOLDERS, name)) {
      push({ kind: 'key', text: keys.label(KEY_PLACEHOLDERS[name] as KeyAction) });
    } else push({ kind: 'text', text: match[0] });
  }
  push({ kind: 'text', text: source.slice(at) });
  return out;
}
