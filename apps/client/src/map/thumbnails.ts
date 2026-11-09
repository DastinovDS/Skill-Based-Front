// The thumbnails of the baked grounds, `maps/<id>.thumb.webp` (#839): written by `gow-maps bake`
// next to each background, 200 px wide and about 2 KB, so they are bundled (inlined) and a map card
// in the lobby or the replays shows the map's own ground at once, without a request.
const thumbnails = import.meta.glob<string>(
  ['../../../../maps/*.thumb.webp', '../../../../maps/gen/*.thumb.webp'],
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
);

/** The URL of the ground thumbnail of the map `mapId`, or null when it has none. */
export function thumbnailUrl(mapId: string): string | null {
  const found = Object.entries(thumbnails).find(([path]) => path.endsWith(`/${mapId}.thumb.webp`));
  return found === undefined ? null : found[1];
}
