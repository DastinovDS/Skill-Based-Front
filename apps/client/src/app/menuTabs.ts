/** The tabs at the top of the screens before a match (#629, variant M5 of docs/design/mockups/menus-entry.html). */
export type MenuTab = 'play' | 'replays' | 'board' | 'howto';

/** Where each tab leads. */
export interface MenuTabActions {
  onplay: () => void;
  onreplays: () => void;
  onboard: () => void;
  onhowto: () => void;
}
