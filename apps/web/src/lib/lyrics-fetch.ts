/** Lyrics lookup (own .lrc files first, then lrclib.net) with caching. Injectable fetch/store so it can be unit tested. */
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
  /** "user": an imported .lrc from Drive. Absent on older entries (= lrclib). */
  source?: "lrclib" | "user";
  /** Drive modifiedTime of the user file this entry was downloaded from */
  modifiedTime?: string;
}

export interface LyricsStore {
  get(trackId: string): Promise<LyricsCacheEntry | undefined>;
  put(trackId: string, entry: LyricsCacheEntry): Promise<void>;
}

/** The user's own lyrics (imported .lrc files on Drive). */
export interface UserLyricsSource {
  /** Drive modifiedTime of the track's file, null when it has none, undefined when not known yet (index not loaded). */
  modifiedTime(trackId: string): string | null | undefined;
  /** Text of the track's file. */
  download(trackId: string): Promise<string>;
}

export interface LyricsDeps {
  fetchImpl?: typeof fetch;
  store: LyricsStore;
  now?: () => number;
  enabled?: boolean;
  signal?: AbortSignal;
  /** Checked first: user lyrics beat lrclib, including a cached "missing" entry. */
  user?: UserLyricsSource;
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

/** Cache entry for a user file: timed lines go to syncedLrc, anything else is shown as plain text. */
export function userEntry(text: string, modifiedTime: string | undefined, fetchedAt: number): LyricsCacheEntry {
  const timed = parseLrc(text).length > 0;
  return {
    status: "found",
    fetchedAt,
    source: "user",
    modifiedTime,
    syncedLrc: timed ? text : null,
    plain: timed ? null : text,
  };
}

class NetworkError extends Error {}

export async function fetchLyricsFor(track: LyricsTrackInfo, deps: LyricsDeps): Promise<LyricsResult> {
  if (deps.enabled === false) return none;
  const now = deps.now ?? Date.now;
  let cached = await deps.store.get(track.id).catch(() => undefined);

  const mtime = deps.user?.modifiedTime(track.id);
  if (deps.user && mtime) {
    if (cached?.source === "user" && cached.modifiedTime === mtime) return fromEntry(cached);
    try {
      const entry = userEntry(await deps.user.download(track.id), mtime, now());
      await deps.store.put(track.id, entry).catch(() => undefined);
      return fromEntry(entry);
    } catch (e) {
      // offline or Drive hiccup: keep showing what we had, and don't cache anything new
      if (cached?.source === "user") return fromEntry(cached);
      if ((e as Error).name === "AbortError") return none;
      // otherwise fall through to lrclib
    }
  }
  // a user entry whose file is gone (removed elsewhere) is stale; only keep it while the index is unknown
  if (cached?.source === "user" && mtime !== undefined) cached = undefined;
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
