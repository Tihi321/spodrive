/**
 * One IndexedDB ("spodrive") shared by the page and the service worker.
 * Stores: kv (token, kek, cached encrypted blobs, settings, ...), lyrics, covers, headers.
 * Must stay free of `window`/`document` references (it is bundled into the SW).
 */
import { openDB, type IDBPDatabase } from "idb";

export const DB_NAME = "spodrive";
export const STORES = ["kv", "lyrics", "covers", "headers"] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(db) {
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    },
    terminated() {
      dbp = null;
    },
  });
  return dbp;
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return (await (await getDb()).get(store, key)) as T | undefined;
}
export async function dbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  await (await getDb()).put(store, value, key);
}
export async function dbDel(store: StoreName, key: string): Promise<void> {
  await (await getDb()).delete(store, key);
}
export async function dbClear(store: StoreName): Promise<void> {
  await (await getDb()).clear(store);
}

export const kvGet = <T>(key: string) => dbGet<T>("kv", key);
export const kvSet = (key: string, value: unknown) => dbPut("kv", key, value);
export const kvDel = (key: string) => dbDel("kv", key);

export interface StoredToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

/** Keys used in the `kv` store. */
export const KV = {
  token: "token",
  kek: "kek",
  vault: "vault",
  libraryEnc: "libraryEnc",
  playlistsEnc: "playlistsEnc",
  playlistsDirty: "playlistsDirty",
  settings: "settings",
  player: "player",
  driveIds: "driveIds",
  recent: "recent",
  userHint: "userHint",
} as const;

export interface DriveIds {
  rootId: string;
  vaultId?: string;
  libraryId?: string;
  playlistsId?: string;
}

export const getToken = () => kvGet<StoredToken>(KV.token);
