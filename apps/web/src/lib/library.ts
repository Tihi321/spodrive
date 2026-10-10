/** Library store: encrypted index from Drive (cached in IndexedDB for offline) -> in-memory index. */
import { create } from "zustand";
import { bytesEqual, openJson, type Library } from "@spodrive/core";
import { KV, kvGet, kvSet } from "./db";
import { forgetChildId, downloadBytes, getChildId, getRootId } from "./drive";
import { buildIndex, type LibraryIndex } from "./library-index";
import { requireKek } from "./keyring";
import { refreshSw } from "./sw-bridge";

interface LibraryState {
  index: LibraryIndex | null;
  /** idle -> loading (first load) -> ready | empty | error */
  status: "idle" | "loading" | "ready" | "empty" | "error";
  syncing: boolean;
  error?: string;
  updatedAt?: string;
}

export const useLibrary = create<LibraryState>(() => ({ index: null, status: "idle", syncing: false }));

function apply(lib: Library) {
  const index = buildIndex(lib.tracks);
  useLibrary.setState({
    index,
    status: index.tracks.length ? "ready" : "empty",
    error: undefined,
    updatedAt: lib.updatedAt,
  });
}

/** Load the cached encrypted library (works offline). Returns false when nothing is cached. */
export async function loadCachedLibrary(): Promise<boolean> {
  const bytes = await kvGet<Uint8Array>(KV.libraryEnc);
  if (!bytes) return false;
  const lib = await openJson<Library>(requireKek(), bytes);
  apply(lib);
  return true;
}

export class KeyMismatchError extends Error {
  constructor() {
    super("The library could not be decrypted with the stored key. The passphrase may have changed.");
    this.name = "KeyMismatchError";
  }
}

/** Fetch library.enc from Drive; update cache + index if it changed. */
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
    const rootId = await getRootId();
    if (!rootId) throw new Error("Spodrive folder not found in Drive");
    let fileId = await getChildId("library.enc", rootId);
    if (!fileId) throw new Error("library.enc not found. Run `npm run spodrive -- init` / `add` first.");
    let bytes: Uint8Array;
    try {
      bytes = await downloadBytes(fileId);
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        await forgetChildId("libraryId");
        fileId = await getChildId("library.enc", rootId);
        if (!fileId) throw e;
        bytes = await downloadBytes(fileId);
      } else throw e;
    }
    const cached = await kvGet<Uint8Array>(KV.libraryEnc);
    if (cached && bytesEqual(cached, bytes) && useLibrary.getState().index) return;
    let lib: Library;
    try {
      lib = await openJson<Library>(requireKek(), bytes);
    } catch {
      throw new KeyMismatchError();
    }
    await kvSet(KV.libraryEnc, bytes);
    apply(lib);
    refreshSw();
  } finally {
    useLibrary.setState({ syncing: false });
  }
}

export function resetLibrary(): void {
  useLibrary.setState({ index: null, status: "idle", syncing: false, error: undefined });
}
