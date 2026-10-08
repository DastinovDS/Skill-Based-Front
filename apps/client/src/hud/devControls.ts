/** What only the dev screen puts in the menu: the map and scene pickers and the frame rate. */
export interface DevControls {
  readonly maps: readonly string[];
  readonly mapName: string;
  readonly scenes: readonly string[];
  readonly sceneId: string;
  readonly fps: number;
  readonly onselectmap: (name: string) => void;
  readonly onselectscene: (id: string) => void;
}
