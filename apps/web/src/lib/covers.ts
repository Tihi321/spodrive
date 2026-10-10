/**
 * Cover art: encrypted SPB1 blobs are cached in IndexedDB (still encrypted at rest);
 * decrypted blob URLs only live in memory and are revoked on lock.
 */
import { useEffect, useState } from "react";
import { importContentKeyB64, openBlob, type Track } from "@spodrive/core";
import { dbGet, dbPut } from "./db";
import { downloadBytes } from "./drive";
import { useLibrary } from "./library";

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

async function loadCover(track: Track): Promise<string | null> {
  if (!track.coverFileId || !track.coverKey) return null;
  let enc = await dbGet<Uint8Array>("covers", track.coverFileId);
  if (!enc) {
    if (!navigator.onLine) return null;
    enc = await downloadBytes(track.coverFileId);
    await dbPut("covers", track.coverFileId, enc).catch(() => undefined);
  }
  const plain = await openBlob(await importContentKeyB64(track.coverKey), enc);
  return URL.createObjectURL(new Blob([plain as Uint8Array<ArrayBuffer>], { type: track.coverMime || "image/jpeg" }));
}

export function getCoverUrl(track: Track | undefined | null): Promise<string | null> {
  if (!track?.coverFileId) return Promise.resolve(null);
  const key = track.coverFileId;
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

/** Revoke all decrypted cover URLs (on lock / sign out). */
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
  }, [track?.coverFileId, track?.coverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
