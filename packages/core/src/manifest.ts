export const ROOT_FOLDER = "Spodrive";
export const LIBRARY_FILE = "library.json";
export const PLAYLISTS_FILE = "playlists.json";

/** Something the user picked in the Google Picker: a folder (scanned recursively) or a single file. */
export interface Source {
  id: string;
  kind: "folder" | "file";
  name: string;
  /** ISO timestamp */
  addedAt: string;
}

export interface Track {
  /** = driveFileId */
  id: string;
  driveFileId: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** 0 when unknown: filled in from the <audio> element once it is played. */
  durationSec: number;
  /** bytes (from Drive metadata) */
  size: number;
  mime: string;
  /** Drive md5Checksum, used to detect changed files on rescan */
  md5: string;
  hasCover: boolean;
  /** ISO timestamp */
  addedAt: string;
}

export interface Library {
  format: "spodrive-library";
  version: 2;
  updatedAt: string;
  sources: Source[];
  tracks: Track[];
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface PlaylistsFile {
  format: "spodrive-playlists";
  version: 1;
  updatedAt: string;
  playlists: Playlist[];
}

export function emptyLibrary(now = new Date().toISOString()): Library {
  return { format: "spodrive-library", version: 2, updatedAt: now, sources: [], tracks: [] };
}
export function emptyPlaylists(now = new Date().toISOString()): PlaylistsFile {
  return { format: "spodrive-playlists", version: 1, updatedAt: now, playlists: [] };
}

const ts = (s: string) => Date.parse(s) || 0;

/** Per-playlist last-write-wins by updatedAt (ties keep `a`). Tombstones are preserved. */
export function mergePlaylists(a: PlaylistsFile, b: PlaylistsFile): PlaylistsFile {
  const map = new Map<string, Playlist>();
  for (const p of a.playlists) map.set(p.id, p);
  for (const p of b.playlists) {
    const cur = map.get(p.id);
    if (!cur || ts(p.updatedAt) > ts(cur.updatedAt)) map.set(p.id, p);
  }
  return {
    format: "spodrive-playlists",
    version: 1,
    updatedAt: ts(a.updatedAt) >= ts(b.updatedAt) ? a.updatedAt : b.updatedAt,
    playlists: [...map.values()],
  };
}
