/** Pure library indexing and search (albums, artists, text search). */
import type { Track } from "@spodrive/core";

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  /** Sorted by disc, track number, title. */
  trackIds: string[];
  coverTrackId?: string;
  durationSec: number;
}

export interface Artist {
  id: string;
  name: string;
  albumIds: string[];
  trackIds: string[];
  coverTrackId?: string;
}

export interface LibraryIndex {
  tracks: Track[];
  byId: Map<string, Track>;
  albums: Album[];
  albumById: Map<string, Album>;
  artists: Artist[];
  artistById: Map<string, Artist>;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export const UNKNOWN_ALBUM = "Unknown Album";
export const UNKNOWN_ARTIST = "Unknown Artist";

/** Lowercase, strip diacritics, collapse whitespace. */
export function fold(s: string | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const artistOf = (t: Track) => (t.albumArtist || t.artist || UNKNOWN_ARTIST).trim();
const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

export function compareAlbumTracks(a: Track, b: Track): number {
  return (
    (a.discNo ?? 1) - (b.discNo ?? 1) ||
    (a.trackNo ?? Number.MAX_SAFE_INTEGER) - (b.trackNo ?? Number.MAX_SAFE_INTEGER) ||
    cmpText(a.title, b.title)
  );
}

export function buildIndex(input: readonly Track[]): LibraryIndex {
  const tracks = input.slice().sort((a, b) => cmpText(a.title, b.title) || cmpText(a.artist, b.artist));
  const byId = new Map(tracks.map((t) => [t.id, t]));

  const albumGroups = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = `${fold(artistOf(t))}|${fold(t.album || UNKNOWN_ALBUM)}`;
    const g = albumGroups.get(key);
    if (g) g.push(t);
    else albumGroups.set(key, [t]);
  }

  const albums: Album[] = [];
  for (const [key, group] of albumGroups) {
    group.sort(compareAlbumTracks);
    const first = group[0]!;
    const withCover = group.find((t) => t.hasCover);
    albums.push({
      id: "al_" + fnv1a(key),
      title: first.album?.trim() || UNKNOWN_ALBUM,
      artist: artistOf(first),
      year: group.map((t) => t.year).find((y) => !!y),
      trackIds: group.map((t) => t.id),
      coverTrackId: withCover?.id,
      durationSec: group.reduce((s, t) => s + (t.durationSec || 0), 0),
    });
  }
  albums.sort((a, b) => cmpText(a.artist, b.artist) || (a.year ?? 0) - (b.year ?? 0) || cmpText(a.title, b.title));
  const albumById = new Map(albums.map((a) => [a.id, a]));

  const artistGroups = new Map<string, { name: string; albums: Album[]; tracks: Track[] }>();
  for (const t of tracks) {
    const name = artistOf(t);
    const key = fold(name);
    let g = artistGroups.get(key);
    if (!g) artistGroups.set(key, (g = { name, albums: [], tracks: [] }));
    g.tracks.push(t);
  }
  for (const al of albums) {
    const g = artistGroups.get(fold(al.artist));
    if (g) g.albums.push(al);
  }
  const artists: Artist[] = [...artistGroups.entries()].map(([key, g]) => ({
    id: "ar_" + fnv1a(key),
    name: g.name,
    albumIds: g.albums.map((a) => a.id),
    trackIds: g.albums.flatMap((a) => a.trackIds),
    coverTrackId: g.albums.find((a) => a.coverTrackId)?.coverTrackId,
  }));
  artists.sort((a, b) => cmpText(a.name, b.name));
  const artistById = new Map(artists.map((a) => [a.id, a]));

  return { tracks, byId, albums, albumById, artists, artistById };
}

function tokens(q: string): string[] {
  return fold(q).split(" ").filter(Boolean);
}

function matchScore(haystacks: string[], toks: string[]): number {
  // every token must appear somewhere; earlier fields and prefix matches rank higher
  let score = 0;
  for (const tok of toks) {
    let best = -1;
    haystacks.forEach((h, i) => {
      const at = h.indexOf(tok);
      if (at < 0) return;
      const s = (at === 0 ? 3 : h.includes(" " + tok) ? 2 : 1) * 10 - i;
      if (s > best) best = s;
    });
    if (best < 0) return -1;
    score += best;
  }
  return score;
}

export function searchLibrary(index: LibraryIndex, query: string, limit = 200): SearchResult {
  const toks = tokens(query);
  if (toks.length === 0) return { tracks: [], albums: [], artists: [] };
  const rank = <T,>(items: readonly T[], fields: (x: T) => string[]): T[] =>
    items
      .map((x) => ({ x, s: matchScore(fields(x).map(fold), toks) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((r) => r.x);
  return {
    tracks: rank(index.tracks, (t) => [t.title, t.artist, t.album, t.albumArtist]),
    albums: rank(index.albums, (a) => [a.title, a.artist]),
    artists: rank(index.artists, (a) => [a.name]),
  };
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Track ids of one picked folder (library source), in album order (artist, year, album, disc, track). */
export function folderTrackIds(index: LibraryIndex, sourceId: string): string[] {
  return index.albums.flatMap((a) => a.trackIds).filter((id) => index.byId.get(id)?.sourceId === sourceId);
}
