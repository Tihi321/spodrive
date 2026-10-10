/** lrclib.net lookup with caching. Injectable fetch/store so it can be unit tested. */
import { parseLrc, type LrcLine } from "@spodrive/core";
import { pickBestMatch, type LrclibItem } from "./lyrics-match";

export const LRCLIB = "https://lrclib.net/api";
export const NOT_FOUND_RETRY_MS = 7 * 24 * 3600 * 1000;

export interface LyricsResult {
  synced: LrcLine[] | null;
  plain: string | null;
}

export interface LyricsCacheEntry {
  status: "found" | "missing";
  fetchedAt: number;
  syncedLrc?: string | null;
  plain?: string | null;
}

export interface LyricsStore {
  get(trackId: string): Promise<LyricsCacheEntry | undefined>;
  put(trackId: string, entry: LyricsCacheEntry): Promise<void>;
}

export interface LyricsDeps {
  fetchImpl?: typeof fetch;
  store: LyricsStore;
  now?: () => number;
  enabled?: boolean;
  signal?: AbortSignal;
}

export interface LyricsTrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

const none: LyricsResult = { synced: null, plain: null };

function fromEntry(e: LyricsCacheEntry): LyricsResult {
  if (e.status === "missing") return none;
  const synced = e.syncedLrc ? parseLrc(e.syncedLrc) : [];
  return { synced: synced.length ? synced : null, plain: e.plain?.trim() ? e.plain : null };
}

class NetworkError extends Error {}

export async function fetchLyricsFor(track: LyricsTrackInfo, deps: LyricsDeps): Promise<LyricsResult> {
  if (deps.enabled === false) return none;
  const now = deps.now ?? Date.now;
  const cached = await deps.store.get(track.id).catch(() => undefined);
  if (cached && (cached.status === "found" || now() - cached.fetchedAt < NOT_FOUND_RETRY_MS)) return fromEntry(cached);

  const f = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  // NOTE: no custom headers on purpose (would trigger a CORS preflight).
  const getJson = async (url: string): Promise<unknown | null> => {
    let res: Response;
    try {
      res = await f(url, { signal: deps.signal });
    } catch (e) {
      throw new NetworkError((e as Error).message);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new NetworkError(`lrclib ${res.status}`);
    return res.json();
  };

  let item: LrclibItem | null = null;
  try {
    const q = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
      album_name: track.album,
      duration: String(Math.round(track.durationSec)),
    });
    const direct = (await getJson(`${LRCLIB}/get?${q}`)) as LrclibItem | null;
    if (direct && (direct.syncedLyrics?.trim() || direct.plainLyrics?.trim()) && !direct.instrumental) item = direct;
    if (!item) {
      const sq = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
      const results = (await getJson(`${LRCLIB}/search?${sq}`)) as LrclibItem[] | null;
      item = Array.isArray(results) ? pickBestMatch(results, track.durationSec) : null;
    }
  } catch (e) {
    if (e instanceof NetworkError || (e as Error).name === "AbortError") return none; // transient: don't cache
    throw e;
  }

  const entry: LyricsCacheEntry = item
    ? { status: "found", fetchedAt: now(), syncedLrc: item.syncedLyrics ?? null, plain: item.plainLyrics ?? null }
    : { status: "missing", fetchedAt: now() };
  await deps.store.put(track.id, entry).catch(() => undefined);
  return fromEntry(entry);
}
