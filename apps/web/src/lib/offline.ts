/**
 * Offline downloads + prefetch. The audio files are stored as-is in Cache Storage under
 * synthetic URLs; the service worker slices ranges out of them.
 */
import { create } from "zustand";
import type { Track } from "@spodrive/core";
import { downloadBlob } from "./drive";
import { OFFLINE_CACHE, PREFETCH_CACHE, PREFETCH_KEEP, cacheKeyUrl, pageScope, trackIdFromCacheKey } from "./urls";
import { refreshSw } from "./sw-bridge";
import { toast, toastError } from "../state/toasts";

interface OfflineState {
  downloaded: Set<string>;
  /** trackId -> 0..1 for in-flight downloads */
  progress: Record<string, number>;
}
export const useOffline = create<OfflineState>(() => ({ downloaded: new Set(), progress: {} }));

const has = (typeof caches !== "undefined");

export async function refreshDownloaded(): Promise<void> {
  if (!has) return;
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  useOffline.setState({ downloaded: new Set(keys.map((k) => trackIdFromCacheKey(k.url))) });
}

async function putBlob(cacheName: string, kind: "offline" | "prefetch", track: Track, blob: Blob) {
  const cache = await caches.open(cacheName);
  await cache.put(
    cacheKeyUrl(pageScope(), kind, track.id),
    new Response(blob, { headers: { "Content-Type": track.mime || "audio/mpeg", "Content-Length": String(blob.size) } }),
  );
}

function checkSize(track: Track, blob: Blob) {
  if (blob.size !== track.size) throw new Error(`Downloaded file has wrong size (${blob.size} != ${track.size})`);
}

export const isDownloaded = (id: string) => useOffline.getState().downloaded.has(id);

/** The audio file of a track from offline -> prefetch -> Drive (does not store). */
export async function getAudioBlob(track: Track, signal?: AbortSignal): Promise<Blob> {
  if (has) {
    for (const [name, kind] of [
      [OFFLINE_CACHE, "offline"],
      [PREFETCH_CACHE, "prefetch"],
    ] as const) {
      const res = await (await caches.open(name)).match(cacheKeyUrl(pageScope(), kind, track.id));
      if (res) {
        const blob = await res.blob();
        if (blob.size === track.size) return blob;
      }
    }
  }
  const blob = await downloadBlob(track.driveFileId, { signal });
  checkSize(track, blob);
  return blob;
}

let queue: Promise<void> = Promise.resolve();

async function downloadOne(track: Track): Promise<void> {
  if (isDownloaded(track.id)) return;
  const total = track.size;
  const setProgress = (v: number | null) =>
    useOffline.setState((s) => {
      const progress = { ...s.progress };
      if (v === null) delete progress[track.id];
      else progress[track.id] = v;
      return { progress };
    });
  setProgress(0);
  try {
    // reuse a prefetched copy when available
    const pre = await (await caches.open(PREFETCH_CACHE)).match(cacheKeyUrl(pageScope(), "prefetch", track.id));
    let blob: Blob;
    if (pre && (blob = await pre.blob()).size === total) {
      /* use it */
    } else {
      blob = await downloadBlob(track.driveFileId, { onProgress: (n) => setProgress(Math.min(0.99, n / total)) });
      checkSize(track, blob);
    }
    await putBlob(OFFLINE_CACHE, "offline", track, blob);
    useOffline.setState((s) => ({ downloaded: new Set(s.downloaded).add(track.id) }));
    refreshSw();
  } finally {
    setProgress(null);
  }
}

/** Queue downloads (sequential, so progress and bandwidth stay sane). */
export function downloadTracks(tracks: Track[], label?: string): Promise<void> {
  const todo = tracks.filter((t) => !isDownloaded(t.id));
  if (todo.length === 0) {
    toast("Already downloaded");
    return Promise.resolve();
  }
  if (!navigator.onLine) {
    toast("You are offline", { kind: "error" });
    return Promise.resolve();
  }
  toast(`Downloading ${label ?? (todo.length === 1 ? todo[0]!.title : todo.length + " tracks")}`);
  // mark as pending immediately for UI
  useOffline.setState((s) => {
    const progress = { ...s.progress };
    for (const t of todo) progress[t.id] ??= 0;
    return { progress };
  });
  const run = queue.then(async () => {
    let failed = 0;
    for (const t of todo) {
      try {
        await downloadOne(t);
      } catch (e) {
        failed++;
        if (failed === 1) toastError(e, `Could not download "${t.title}"`);
      }
    }
    if (failed === 0) toast(`Downloaded ${label ?? (todo.length === 1 ? todo[0]!.title : todo.length + " tracks")}`, { kind: "success" });
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function removeDownloads(ids: string[]): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE);
  await Promise.all(ids.map((id) => cache.delete(cacheKeyUrl(pageScope(), "offline", id))));
  useOffline.setState((s) => {
    const downloaded = new Set(s.downloaded);
    ids.forEach((id) => downloaded.delete(id));
    return { downloaded };
  });
  refreshSw();
}

export async function removeAllDownloads(): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
  await caches.delete(PREFETCH_CACHE);
  useOffline.setState({ downloaded: new Set() });
  refreshSw();
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    return (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    return {};
  }
}

// ---- prefetch of the next track ----
let prefetchAbort: AbortController | null = null;

export async function prefetchTrack(track: Track): Promise<void> {
  if (!has || !navigator.onLine || isDownloaded(track.id)) return;
  const key = cacheKeyUrl(pageScope(), "prefetch", track.id);
  const cache = await caches.open(PREFETCH_CACHE);
  if (await cache.match(key)) return;
  prefetchAbort?.abort();
  const ac = (prefetchAbort = new AbortController());
  try {
    const blob = await downloadBlob(track.driveFileId, { signal: ac.signal });
    checkSize(track, blob);
    await putBlob(PREFETCH_CACHE, "prefetch", track, blob);
    refreshSw();
    // keep only the most recent few
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - PREFETCH_KEEP))) await cache.delete(k);
  } catch {
    /* best effort */
  } finally {
    if (prefetchAbort === ac) prefetchAbort = null;
  }
}
