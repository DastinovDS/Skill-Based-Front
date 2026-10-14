/** What a menu on a city or on a group shows: which one, and the sector under the pointer. */
export interface TargetMenuData<T, Id extends string> {
  readonly open: boolean;
  /** The city (id) or the group (opaque id) the menu belongs to; `null` while closed. */
  readonly target: T | null;
  readonly hover: Id | null;
}

/**
 * The reactive side of the radial menu of a city or of a group (UI round 2): one field replaced as
 * a whole (AGENTS.md 7.2). The menu opens on a click on its object and follows it on the map.
 */
export class TargetMenuState<T, Id extends string> {
  current = $state.raw<TargetMenuData<T, Id>>({ open: false, target: null, hover: null });

  open(target: T): void {
    this.current = { open: true, target, hover: null };
  }

  close(): void {
    if (this.current.open) this.current = { open: false, target: null, hover: null };
  }

  hover(id: Id | null): void {
    if (this.current.hover !== id) this.current = { ...this.current, hover: id };
  }
}
