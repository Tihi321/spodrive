/**
 * One IndexedDB ("spodrive") shared by the page and the service worker.
 * Stores: kv (token, cached library/playlists, settings, ...), lyrics, covers (downscaled JPEGs by track id).
 * Must stay free of `window`/`document` references (it is bundled into the SW).
 */
import { openDB, type IDBPDatabase } from "idb";

export const DB_NAME = "spodrive";
export const STORES = ["kv", "lyrics", "covers"] as const;
const DB_VERSION = 2;
/** KV keys of the removed encrypted format; dropped on upgrade. */
const LEGACY_KV_KEYS = ["kek", "vault", "libraryEnc", "playlistsEnc"];
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      if (oldVersion >= 1 && oldVersion < 2) {
        // v1 held encrypted data: drop it (the library is re-read from the plain library.json)
        const names = db.objectStoreNames as unknown as DOMStringList;
        if (names.contains("headers")) db.deleteObjectStore("headers");
        for (const k of LEGACY_KV_KEYS) void tx.objectStore("kv").delete(k);
        void tx.objectStore("covers").clear();
        void tx.objectStore("kv").delete("driveIds");
      }
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
  /** space-separated scopes Google granted with this token */
  scope?: string;
}

/** Keys used in the `kv` store. */
export const KV = {
  token: "token",
  library: "library",
  playlists: "playlists",
  playlistsDirty: "playlistsDirty",
  settings: "settings",
  player: "player",
  driveIds: "driveIds",
  recent: "recent",
  userHint: "userHint",
  playbackLog: "playbackLog",
} as const;

export interface DriveIds {
  rootId: string;
  libraryId?: string;
  playlistsId?: string;
  /** Spodrive/Music: where Picker uploads go */
  uploadsId?: string;
}

export const getToken = () => kvGet<StoredToken>(KV.token);
