/**
 * The maps of the server pool for the screens before a match (#473): the list (`GET /api/maps`)
 * and the files (`GET /api/maps/{id}`, about 20 KB each) the thumbnails and the backdrop draw.
 * Each file is fetched once and kept; a failure is not fatal (a picture is a convenience), the
 * screens fall back to a placeholder and the server picks a random map.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { Api, MapSummary } from '../api/http.ts';
import { isMatchMap } from '../map/art.ts';
import { thumbnailUrl } from '../map/thumbnails.ts';
import type { MapFile } from '../protocol.gen.ts';

export class MapCache {
  /** The pool, or null until it is known. */
  list = $state.raw<readonly MapSummary[] | null>(null);
  /** The list could not be loaded. */
  failed = $state(false);
  /** The files loaded so far, by map id. */
  files = $state.raw<Readonly<Record<string, MapFile>>>({});
  /** The thumbnails the server states for the maps the client does not bundle (#884). */
  thumbs = $state.raw<Readonly<Record<string, string>>>({});

  readonly #api: Api;
  #listing: Promise<void> | null = null;
  readonly #fetching = new SvelteMap<string, Promise<MapFile | null>>();

  constructor(api: Api) {
    this.#api = api;
  }

  /** Asks for the pool once; later calls share the answer (and a failed ask can be repeated). */
  load(): Promise<void> {
    this.#listing ??= this.#api.maps().then(
      (pool) => {
        this.list = pool;
        this.failed = false;
      },
      () => {
        this.failed = true;
        this.#listing = null;
      },
    );
    return this.#listing;
  }

  /** The file of a map, or null while it is not loaded (call `ensure` to fetch it). */
  get(id: string): MapFile | null {
    return this.files[id] ?? null;
  }

  /** The ground thumbnail of a map: bundled, or for a per-match map from its summary. */
  thumb(id: string): string | null {
    return thumbnailUrl(id) ?? this.thumbs[id] ?? null;
  }

  /** Fetches the file of a map unless it is there or on its way; null if it cannot be had. */
  ensure(id: string): Promise<MapFile | null> {
    const have = this.files[id];
    if (have !== undefined) return Promise.resolve(have);
    let pending = this.#fetching.get(id);
    if (pending === undefined) {
      if (isMatchMap(id)) this.#askThumb(id);
      pending = this.#api.map(id).then(
        (file) => {
          this.files = { ...this.files, [id]: file };
          this.#fetching.delete(id);
          return file;
        },
        () => {
          this.#fetching.delete(id);
          return null;
        },
      );
      this.#fetching.set(id, pending);
    }
    return pending;
  }

  /** A per-match map is not bundled: its summary names the thumbnail (none: a plain frame). */
  #askThumb(id: string): void {
    this.#api.mapSummary(id).then(
      (summary) => {
        if (summary.thumb_url != null) this.thumbs = { ...this.thumbs, [id]: summary.thumb_url };
      },
      () => undefined,
    );
  }
}
