import { onUnitStyle, setUnitStyle, unitStyle, type UnitStyle } from './unitStyle.ts';

/** The unit look for markup (#784): reading `current` re-renders an icon when the viewer switches it. */
class UnitStyleState {
  #current = $state<UnitStyle>(unitStyle());

  constructor() {
    onUnitStyle((style) => {
      this.#current = style;
    });
  }

  get current(): UnitStyle {
    return this.#current;
  }

  set current(style: UnitStyle) {
    setUnitStyle(style);
  }

  get helmets(): boolean {
    return this.#current === 'helmet';
  }
}

export const unitLook = new UnitStyleState();
