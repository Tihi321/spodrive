/**
 * Cover art: downscaled JPEGs cached in IndexedDB by track id. On a miss (e.g. a second device) the cover
 * is re-extracted from the head of the Drive file and cached. Blob URLs only live in memory.
 */
import { useEffect, useState } from "react";
import type { Track } from "@spodrive/core";
import { dbDel, dbGet, dbPut } from "./db";
import { useLibrary } from "./library";
import { downscaleCover, readMetadata } from "./metadata";

const urls = new Map<string, Promise<string | null>>();

let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export async function saveCover(trackId: string, cover: { data: Uint8Array; mime: string }): Promise<void> {
  await dbPut("covers", trackId, await downscaleCover(cover));
}

async function loadCover(track: Track): Promise<string | null> {
  if (!track.hasCover) return null;
  let blob = await dbGet<Blob>("covers", track.id);
  if (!blob) {
    if (!navigator.onLine) return null;
    const { cover } = await readMetadata({ id: track.driveFileId, name: track.title, mime: track.mime, size: track.size });
    if (!cover) return null;
    blob = await downscaleCover(cover);
    await dbPut("covers", track.id, blob).catch(() => undefined);
  }
  return URL.createObjectURL(blob);
}

export function getCoverUrl(track: Track | undefined | null): Promise<string | null> {
  if (!track?.hasCover) return Promise.resolve(null);
  const key = track.id;
  let p = urls.get(key);
  if (!p) {
    p = limited(() => loadCover(track)).then(
      (u) => {
        if (u === null) urls.delete(key); // retry later (e.g. went online)
        return u;
      },
      () => {
        urls.delete(key);
        return null;
      },
    );
    urls.set(key, p);
  }
  return p;
}

/** Forget cached covers of tracks that were removed or re-read. */
export async function dropCovers(ids: string[]): Promise<void> {
  for (const id of ids) {
    void urls.get(id)?.then((u) => u && URL.revokeObjectURL(u));
    urls.delete(id);
    await dbDel("covers", id).catch(() => undefined);
  }
}

/** Revoke all cover URLs (on sign out). */
export function revokeCovers(): void {
  for (const p of urls.values()) void p.then((u) => u && URL.revokeObjectURL(u));
  urls.clear();
}

/** React hook: cover blob URL for a track (null = none/loading). */
export function useCover(trackId: string | undefined | null): string | null {
  const track = useLibrary((s) => (trackId ? s.index?.byId.get(trackId) : undefined));
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!track) return;
    void getCoverUrl(track).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.hasCover]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
