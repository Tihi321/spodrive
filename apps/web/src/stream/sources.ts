/**
 * Byte sources for the streaming handler:
 * offline download cache -> prefetch cache -> Google Drive Range fetch.
 */
import type { StoredToken } from "../lib/db";
import { OFFLINE_CACHE, PREFETCH_CACHE, cacheKeyUrl, driveMediaUrl } from "../lib/urls";
import type { StreamTrack } from "./handler";

export interface SourceDeps {
  scope: string;
  getToken(): Promise<StoredToken | undefined>;
  /** Ask the page for a fresh token; resolves with the new token or undefined. */
  requestToken(staleAccessToken?: string): Promise<StoredToken | undefined>;
  fetch?: typeof fetch;
  caches?: CacheStorage;
}

export interface ByteSource {
  fetchRange(track: StreamTrack, start: number, endInclusive: number, signal: AbortSignal): Promise<Uint8Array | ReadableStream<Uint8Array>>;
  clearMemo(): void;
}

export function createByteSource(deps: SourceDeps): ByteSource {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const cacheStorage = () => deps.caches ?? caches;
  const memo = new Map<string, Blob>();

  async function localBlob(track: StreamTrack): Promise<Blob | null> {
    const hit = memo.get(track.id);
    if (hit) return hit;
    for (const name of [OFFLINE_CACHE, PREFETCH_CACHE]) {
      try {
        const cache = await cacheStorage().open(name);
        const res = await cache.match(cacheKeyUrl(deps.scope, name === OFFLINE_CACHE ? "offline" : "prefetch", track.id));
        if (!res) continue;
        const blob = await res.blob();
        if (blob.size !== track.size) continue; // partial/corrupt: ignore
        if (memo.size >= 4) memo.delete(memo.keys().next().value as string);
        memo.set(track.id, blob);
        return blob;
      } catch {
        /* cache unavailable */
      }
    }
    return null;
  }

  async function driveRange(
    track: StreamTrack,
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Uint8Array | ReadableStream<Uint8Array>> {
    let tok = await deps.getToken();
    if (!tok || tok.expiresAt < Date.now() + 15_000) tok = await deps.requestToken(tok?.accessToken);
    if (!tok) throw new Error("Not signed in to Google");
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await doFetch(driveMediaUrl(track.driveFileId), {
        headers: { Authorization: `Bearer ${tok.accessToken}`, Range: `bytes=${start}-${end}` },
        signal,
      });
      if (res.status === 401 && attempt === 0) {
        const fresh = await deps.requestToken(tok.accessToken);
        if (!fresh) break;
        tok = fresh;
        continue;
      }
      break;
    }
    if (!res || !res.ok) throw new Error(`Drive responded ${res ? res.status : "no response"}`);
    if (res.status === 206 && res.body) return res.body; // stream: playback starts before the range is complete
    const buf = new Uint8Array(await res.arrayBuffer());
    const want = end - start + 1;
    if (res.status === 200 && buf.length > want) return buf.subarray(start, end + 1); // server ignored Range
    return buf;
  }

  return {
    async fetchRange(track, start, end, signal) {
      const blob = await localBlob(track);
      if (blob) return new Uint8Array(await blob.slice(start, end + 1).arrayBuffer());
      return driveRange(track, start, end, signal);
    },
    clearMemo() {
      memo.clear();
    },
  };
}

/** SW-side: ask all window clients for a token and wait for IndexedDB to hold a newer one. */
export function createTokenRequester(opts: {
  getToken(): Promise<StoredToken | undefined>;
  /**
   * Renew without the page (server session). Matters with the screen off: the page may be frozen
   * and could not open a sign-in popup anyway.
   */
  refresh?(): Promise<StoredToken | undefined>;
  notify(): Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}) {
  let inflight: Promise<StoredToken | undefined> | null = null;
  const fresh = (t: StoredToken | undefined, stale?: string): t is StoredToken =>
    !!t && t.accessToken !== stale && t.expiresAt > Date.now() + 30_000;
  return (stale?: string): Promise<StoredToken | undefined> => {
    inflight ??= (async () => {
      try {
        const cur = await opts.getToken();
        if (fresh(cur, stale)) return cur;
        const renewed = await opts.refresh?.().catch(() => undefined);
        if (fresh(renewed, stale)) return renewed;
        await opts.notify();
        const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, opts.pollMs ?? 300));
          const t = await opts.getToken();
          if (fresh(t, stale)) return t;
        }
        return undefined;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
