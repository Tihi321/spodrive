/** Library store: plain library.json on Drive (cached in IndexedDB for offline) -> in-memory index. */
import { create } from "zustand";
import { LIBRARY_FILE, emptyLibrary, type Library } from "@spodrive/core";
import { KV, kvGet, kvSet } from "./db";
import { createFile, downloadBytes, ensureRootId, forgetChildId, getChildId, getDriveIds, getRootId, saveDriveIds, updateFile } from "./drive";
import { buildIndex, type LibraryIndex } from "./library-index";
import { refreshSw } from "./sw-bridge";

interface LibraryState {
  library: Library | null;
  index: LibraryIndex | null;
  /** idle -> loading (first load) -> ready | empty | error */
  status: "idle" | "loading" | "ready" | "empty" | "error";
  syncing: boolean;
  error?: string;
  updatedAt?: string;
}

export const useLibrary = create<LibraryState>(() => ({ library: null, index: null, status: "idle", syncing: false }));

function apply(lib: Library) {
  const index = buildIndex(lib.tracks);
  useLibrary.setState({
    library: lib,
    index,
    status: index.tracks.length ? "ready" : "empty",
    error: undefined,
    updatedAt: lib.updatedAt,
  });
}

export const currentLibrary = (): Library => useLibrary.getState().library ?? emptyLibrary();

function parseLibrary(bytes: Uint8Array): Library {
  const lib = JSON.parse(new TextDecoder().decode(bytes)) as Library;
  if (lib?.format !== "spodrive-library" || lib.version !== 2 || !Array.isArray(lib.tracks)) {
    throw new Error("library.json has an unexpected format");
  }
  lib.sources ??= [];
  return lib;
}

/** Load the cached library (works offline). Returns false when nothing is cached. */
export async function loadCachedLibrary(): Promise<boolean> {
  const lib = await kvGet<Library>(KV.library);
  if (!lib) return false;
  apply(lib);
  return true;
}

/** Upload library.json (creating the Spodrive folder and the file on first use). */
async function pushLibrary(lib: Library): Promise<void> {
  const rootId = await ensureRootId();
  const bytes = new TextEncoder().encode(JSON.stringify(lib));
  const fileId = await getChildId(LIBRARY_FILE, rootId);
  if (fileId) {
    try {
      await updateFile(fileId, bytes);
      return;
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      await forgetChildId("libraryId");
    }
  }
  const id = await createFile(rootId, LIBRARY_FILE, bytes);
  const ids = await getDriveIds();
  await saveDriveIds({ ...(ids ?? { rootId }), rootId, libraryId: id });
}

/** Make `lib` the current library: update the index, cache it locally, then upload it to Drive. */
export async function commitLibrary(lib: Library): Promise<void> {
  const next: Library = { ...lib, updatedAt: new Date().toISOString() };
  apply(next);
  await kvSet(KV.library, next);
  refreshSw();
  await pushLibrary(next);
}

let durationTimer: ReturnType<typeof setTimeout> | undefined;
/** A track played with an unknown duration: remember it in memory and in the local cache (uploaded with the next write). */
export function setTrackDuration(id: string, durationSec: number): void {
  const t = useLibrary.getState().library?.tracks.find((x) => x.id === id);
  if (!t || t.durationSec > 0 || !(durationSec > 0)) return;
  t.durationSec = Math.round(durationSec * 1000) / 1000;
  clearTimeout(durationTimer);
  durationTimer = setTimeout(() => {
    const lib = useLibrary.getState().library;
    if (lib) void kvSet(KV.library, lib).catch(() => undefined);
  }, 2000);
}

/** Fetch library.json from Drive; update cache + index if it is newer (or upload the local copy if that is newer). */
let inflight: Promise<void> | null = null;
export function syncLibrary(): Promise<void> {
  inflight ??= doSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doSync(): Promise<void> {
  if (!navigator.onLine) return;
  useLibrary.setState({ syncing: true });
  try {
    const local = useLibrary.getState().library;
    const rootId = await getRootId();
    let fileId = rootId ? await getChildId(LIBRARY_FILE, rootId) : null;
    if (!rootId || !fileId) {
      // nothing on Drive yet: a cached library is pushed on the next write, otherwise we are simply empty
      if (!local) apply(emptyLibrary());
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await downloadBytes(fileId);
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        await forgetChildId("libraryId");
        fileId = await getChildId(LIBRARY_FILE, rootId);
        if (!fileId) throw e;
        bytes = await downloadBytes(fileId);
      } else throw e;
    }
    const remote = parseLibrary(bytes);
    if (local && Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) {
      await pushLibrary(local); // written while offline
      return;
    }
    if (local && local.updatedAt === remote.updatedAt && useLibrary.getState().index) return;
    await kvSet(KV.library, remote);
    apply(remote);
    refreshSw();
  } finally {
    useLibrary.setState({ syncing: false });
  }
}

export function resetLibrary(): void {
  useLibrary.setState({ library: null, index: null, status: "idle", syncing: false, error: undefined });
}
