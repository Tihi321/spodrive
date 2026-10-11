import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import type { Library } from "@spodrive/core";
import { KV, getToken, kvGet } from "./lib/db";
import { trackIdFromStreamUrl } from "./lib/urls";
import { handleStreamRequest, type StreamTrack } from "./stream/handler";
import { createByteSource, createTokenRequester } from "./stream/sources";

interface SWClient {
  postMessage(m: unknown): void;
}
interface SWScope {
  registration: { scope: string };
  clients: { claim(): Promise<void>; matchAll(o?: unknown): Promise<SWClient[]> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (e: any) => void): void;
}
const sw = self as unknown as SWScope;

// vite-plugin-pwa replaces the literal `self.__WB_MANIFEST`
const precacheManifest =
  (self as unknown as { __WB_MANIFEST?: Array<string | { url: string; revision: string | null }> }).__WB_MANIFEST ?? [];
precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();
// In `vite dev` the manifest is empty (nothing precached): skip the app-shell route.
if (precacheManifest.length > 0) registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

sw.addEventListener("message", (e) => {
  const t = e.data?.type;
  if (t === "SKIP_WAITING") void sw.skipWaiting();
  if (t === "refresh") {
    libraryPromise = null;
    source.clearMemo();
  }
});
sw.addEventListener("activate", (e) => e.waitUntil(sw.clients.claim()));

// ---- library (read lazily from IndexedDB by the SW itself, memoized) ----
let libraryPromise: Promise<Map<string, StreamTrack>> | null = null;
let lastLoad = 0;

async function loadLibrary(): Promise<Map<string, StreamTrack>> {
  const lib = await kvGet<Library>(KV.library);
  if (!lib) throw new Error("Library is not cached");
  const map = new Map<string, StreamTrack>();
  for (const t of lib.tracks) {
    map.set(t.id, {
      id: t.id,
      driveFileId: t.driveFileId,
      size: t.size,
      mime: t.mime,
    });
  }
  return map;
}

async function getTrack(id: string): Promise<StreamTrack | undefined> {
  if (!libraryPromise) {
    lastLoad = Date.now();
    libraryPromise = loadLibrary();
  }
  let map: Map<string, StreamTrack>;
  try {
    map = await libraryPromise;
  } catch {
    libraryPromise = null;
    return undefined;
  }
  let t = map.get(id);
  if (!t && Date.now() - lastLoad > 2000) {
    // the page may have synced a newer library meanwhile
    lastLoad = Date.now();
    libraryPromise = loadLibrary();
    try {
      t = (await libraryPromise).get(id);
    } catch {
      libraryPromise = null;
    }
  }
  return t;
}

// ---- byte sources ----
const requestToken = createTokenRequester({
  getToken: async () => getToken(),
  async notify() {
    const clients = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: "need-token" });
  },
});
const source = createByteSource({
  scope: sw.registration.scope,
  getToken: async () => getToken(),
  requestToken,
});

sw.addEventListener("fetch", (event) => {
  const req: Request = event.request;
  if (req.method !== "GET") return;
  const id = trackIdFromStreamUrl(sw.registration.scope, req.url);
  if (id === null) return;
  event.respondWith(
    handleStreamRequest(req, id, {
      getTrack,
      fetchRange: source.fetchRange,
    }),
  );
});
