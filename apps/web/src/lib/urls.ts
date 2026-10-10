/** Shared (page + service worker) URL and cache naming conventions. */
export const OFFLINE_CACHE = "spodrive-offline";
export const PREFETCH_CACHE = "spodrive-prefetch";
export const PREFETCH_KEEP = 3;

export type CacheKind = "offline" | "prefetch";

/** `scope` must end with "/" (ServiceWorkerRegistration.scope does). */
export function streamUrl(scope: string, trackId: string): string {
  return new URL(`stream/${encodeURIComponent(trackId)}`, scope).href;
}
export function streamPrefix(scope: string): string {
  return new URL("stream/", scope).href;
}
export function trackIdFromStreamUrl(scope: string, url: string): string | null {
  const prefix = streamPrefix(scope);
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length).split(/[?#]/)[0] ?? "";
  if (!rest) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}
/** Synthetic URL used as Cache Storage key for the encrypted file of a track. */
export function cacheKeyUrl(scope: string, kind: CacheKind, trackId: string): string {
  return new URL(`_${kind}/${encodeURIComponent(trackId)}`, scope).href;
}
export function trackIdFromCacheKey(url: string): string {
  const last = url.split("/").pop() ?? "";
  return decodeURIComponent(last);
}

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const driveMediaUrl = (fileId: string) => `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;

/** Resolve the app scope (with trailing slash) from the page. */
export function pageScope(): string {
  return new URL(import.meta.env.BASE_URL, globalThis.location.href).href;
}
