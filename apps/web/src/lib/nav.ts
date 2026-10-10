import type { Track } from "@spodrive/core";
import type { LibraryIndex } from "./library-index";

export function albumIdOf(index: LibraryIndex, track: Track): string | undefined {
  return index.albums.find((a) => a.trackIds.includes(track.id))?.id;
}

export function artistIdOf(index: LibraryIndex, track: Track): string | undefined {
  return index.artists.find((a) => a.trackIds.includes(track.id))?.id;
}
