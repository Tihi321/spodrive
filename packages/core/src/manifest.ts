export const ROOT_FOLDER = "Spodrive";
export const VAULT_FILE = "vault.json";
export const LIBRARY_FILE = "library.enc";
export const PLAYLISTS_FILE = "playlists.enc";
export const TRACKS_FOLDER = "tracks";
export const COVERS_FOLDER = "covers";

export interface Track {
  id: string;
  driveFileId: string;
  coverFileId?: string;
  coverMime?: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationSec: number;
  plainSize: number;
  chunkSize: number;
  mime: string;
  /** base64 raw 256-bit content key */
  key: string;
  coverKey?: string;
  sha256: string;
  /** ISO timestamp */
  addedAt: string;
}

export interface Library {
  format: "spodrive-library";
  version: 1;
  updatedAt: string;
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
  return { format: "spodrive-library", version: 1, updatedAt: now, tracks: [] };
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
