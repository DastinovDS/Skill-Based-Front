/**
 * The design tokens of the Lapis style (outside the match, #826) and the Engraved style (the match,
 * #829), for code that cannot read CSS: the PixiJS render side and the HUD tweens. The CSS custom
 * properties of `app.css` (`:root`) carry the same values; `tokens.test.ts` keeps the two in step.
 *
 * Sources: `docs/design/ui-style.md` sections 51 and 53 to 57, and the decided mockups
 * `docs/design/mockups/out-of-game-style-r2.html`, `-r3.html` (Double rule edges) and
 * `in-game-style-r5.html`. Dark only: there is no light theme (ui-style 22, 50).
 */

import type { PlayerColour } from '../protocol.gen.ts';

/**
 * The colours a player can choose (DEC-49, #906, the set Engraved six), as 0xRRGGBB, in the order
 * of the picker. Lapis and Minium are today's pair (`ENGRAVED.own`, `ENGRAVED.enemy`), so a player
 * who never chose sees the game as before. CSS `--colour-<id>`. The names are i18n keys
 * (`colour.<id>`); the server keeps the same ids (`gow_server.colours`).
 */
export const PLAYER_COLOURS: Readonly<Record<PlayerColour, number>> = {
  lapis: 0x86a6ea,
  minium: 0xe5785e,
  glacier: 0xa6e0e8,
  shell: 0xf4b4a4,
  violet: 0x966fd6,
  madder: 0xc8587e,
};

/** The ids of the set in the order of the picker. */
export const PLAYER_COLOUR_IDS = Object.keys(PLAYER_COLOURS) as readonly PlayerColour[];

/**
 * The colour an illustrative opponent wears outside a match (the versus line, a menu picture): never
 * the player's own, and far from it in lightness or hue. Lapis and Minium keep today's pair; the
 * real opponent colour is only known once a match pairs (`welcome.colours`, DEC-49).
 */
export const CONTRAST_COLOUR: Readonly<Record<PlayerColour, PlayerColour>> = {
  lapis: 'minium',
  minium: 'lapis',
  glacier: 'madder',
  shell: 'violet',
  violet: 'shell',
  madder: 'glacier',
};

/**
 * Outside a match: sets `--own` to the player's chosen colour and `--enemy` to the contrasting one on
 * the page root (DEC-49), so every helmet and mark that stands for the viewer wears the choice. A
 * match, a replay and the result card set their own pair below the root. Returns the undo.
 */
export function applyPlayerColour(colour: PlayerColour | null): () => void {
  const own = colour ?? 'lapis';
  const style = document.documentElement.style;
  style.setProperty('--own', colourVar(own));
  style.setProperty('--enemy', colourVar(CONTRAST_COLOUR[own]));
  return () => {
    style.removeProperty('--own');
    style.removeProperty('--enemy');
  };
}

/** The CSS of a player colour: its custom property of `app.css` (`--colour-<id>`). */
export function colourVar(id: PlayerColour): string {
  return `var(--colour-${id})`;
}

/** Lapis: black stone, ivory ink, incised rules (ui-style 50, 51, 56). Colours as 0xRRGGBB. */
export const LAPIS = {
  /** The page: black stone. CSS `--stone-bg` (and the old `--bg`). */
  bg: 0x16130f,
  /** A panel, a dialog, a toast. CSS `--stone-panel`. */
  panel: 0x1d1a15,
  /** A raised stone: the corner of a frame, a field. CSS `--stone-raised` (the old `--surface-2`). */
  raised: 0x221e18,
  /** The ink of text and of the primary button. CSS `--ink` (the old `--text`, `--paper`). */
  ink: 0xece4d1,
  /** A softer ink (a hovered rule, a secondary mark). CSS `--ink-soft`. */
  inkSoft: 0xcfc4ab,
  /** Secondary text, labels. CSS `--ink-dim` (the old `--text-dim`). */
  inkDim: 0xada38f,
  /** The rule of a secondary button. CSS `--rule`. */
  rule: 0x7d7363,
  /** The lit lower lip of an incised rule, and a quiet line. CSS `--line` (the old `--border`). */
  line: 0x3d372d,
  /** The dark cut of an incised rule. CSS `--cut`. */
  cut: 0x050403,
  /** The lozenge where the two rules of a Double rule frame turn. CSS `--frame-lozenge`. */
  lozenge: 0x8f8573,
  /** The sides outside the match (lapis and minium). CSS `--own-lapis`, `--enemy-lapis`. */
  own: 0x7d9ce2,
  enemy: 0xe0735a,
} as const;

/** Engraved: line and hatching on a dark plate, every mark on a dark casing (ui-style 52 to 57). */
export const ENGRAVED = {
  /** The plate under the map and the HUD strip. CSS `--plate`. */
  plate: 0x0e0c09,
  /** The dark casing round every coloured mark. CSS `--casing`. */
  casing: 0x060504,
  ink: 0xece4d1,
  /**
   * The own side when no colours are known (Lapis; an old replay, a screen outside a match). CSS
   * `--own` (the old `--you`); a match sets it to the player's colour (DEC-49).
   */
  own: PLAYER_COLOURS.lapis,
  /** The opponent when no colours are known (Minium). CSS `--enemy`; a match sets it (DEC-49). */
  enemy: PLAYER_COLOURS.minium,
  /** Neutral places and dim marks. CSS `--neutral`. */
  neutral: 0xb3a88f,
  /** The fill of a neutral place. CSS `--neutral-fill`. */
  neutralFill: 0x221e18,
  /** An empty segment of a scale. CSS `--segment-empty`. */
  segmentEmpty: 0x5a5243,
  /** Victory points: the gilt lozenge. CSS `--vp`. */
  vp: 0xcfab62,
  /** Warnings (amber), never the opponent. CSS `--warn`. */
  warn: 0xe6ab42,
  /** The advantage and disadvantage chevrons. CSS `--badge-up`, `--badge-down`. */
  up: 0x8cc79a,
  down: 0xec6654,
} as const;

/**
 * The owner hatch (ui-style 52 III, 53): own lines are horizontal, the enemy's at 45 degrees
 * (top left to bottom right on screen), so the owner reads without colour. Pitch and width in CSS
 * px at 100 % zoom; a fine inner hatch keeps a pitch of at least `minPitch` (ui-style 53, "Line
 * weights under zoom"). CSS `--hatch-own`, `--hatch-enemy`.
 */
export const HATCH = {
  own: { angle: 0, pitch: 3, width: 1 },
  enemy: { angle: 45, pitch: 3.4, width: 1.2 },
  minPitch: 3,
} as const;

/** Line weights in CSS px (ui-style 53 to 55): a stroke is never thinner than one device pixel. */
export const LINE = {
  /** An ink hairline. CSS `--line-hair`. */
  hair: 1,
  /** The dark casing under an ink hairline (the CP scale, the arrows). CSS `--line-casing`. */
  casing: 3,
  /** The ink of a city highlight ring and its casing (Fine rings, ui-style 55p). */
  ringInk: 1,
  ringCasing: 2.6,
  /** The space between the two rules of a Double rule frame (ui-style 56 II). CSS `--frame-gap`. */
  frameGap: 4,
} as const;

/** Corner radii in CSS px: Lapis is cut stone, every corner is square. CSS `--radius`. */
export const RADIUS = 0;

/**
 * Durations in milliseconds of the decided rounds. CSS `--t-<name>` (kebab case of the key).
 * `cp*`: the CP gauge (ui-style 57a); `reveal*`: the Burin reveal of the hover cards (ui-style 57r,
 * slowed to about 550 ms by the owner); `captureWalk`: Walk in (54j); `buildRun` and `buildDone`:
 * the build of a city's icon (57k, 73); `planStep`: one asked bonus of a scheduled order easing full
 * (53e); `intro`: the opening scene (56).
 */
export const DURATION = {
  cpSpend: 700,
  cpSliver: 1000,
  cpIncome: 800,
  cpRoll: 500,
  cpFrameIn: 700,
  cpFrameOut: 400,
  revealLeader: 80,
  revealIn: 550,
  revealOut: 160,
  revealHover: 120,
  revealReduced: 100,
  captureWalk: 600,
  buildRun: 350,
  buildDone: 500,
  planStep: 900,
  intro: 7000,
} as const;

/** Cubic Bézier easing curves (the CSS `cubic-bezier()` arguments). CSS `--ease-<name>`. */
export const EASE = {
  /** easeInOutSine: every CP move (ui-style 57a) and the calm moves of the HUD. */
  engrave: [0.37, 0, 0.63, 1],
  /** easeOutCubic: a mark that settles (the mockups' `eOut`). */
  settle: [0.33, 1, 0.68, 1],
  /** easeInOutCubic: a mark that travels (the mockups' `eInOut`). */
  travel: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** easeInOutSine of `p` in 0..1, the JS twin of `EASE.engrave` for canvas tweens. */
export function easeEngrave(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/** easeOutCubic, the twin of `EASE.settle`. */
export function easeSettle(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return 1 - (1 - t) ** 3;
}

/** easeInOutCubic, the twin of `EASE.travel`. */
export function easeTravel(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The font stacks (self-hosted, SIL OFL: `src/theme/fonts/`). Cinzel: cut capitals for titles,
 * labels, buttons and place names; EB Garamond: running text and numerals. CSS `--font-display`,
 * `--font-text`. A PixiJS text must wait for `document.fonts.load()` of its family before it is
 * drawn, or it is drawn once in the fallback.
 */
export const FONT = {
  display: "'Cinzel', 'Times New Roman', serif",
  text: "'EB Garamond', Georgia, 'Times New Roman', serif",
} as const;
