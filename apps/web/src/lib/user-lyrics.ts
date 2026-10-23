/**
 * The user's own lyrics: .lrc files in Spodrive/lyrics on Drive, one `<trackId>.lrc` per track.
 * An index of the folder (trackId -> file id + modifiedTime) is loaded once per session and refreshed when the
 * window regains focus or connectivity, so lyrics imported on another device show up. The text itself is cached
 * in the "lyrics" IDB store by the lookup in lyrics-fetch.ts and re-downloaded only when modifiedTime changes.
 */
import { create } from "zustand";
import { dbDel, dbPut } from "./db";
import {
  createFile,
  deleteFile,
  downloadBytes,
  ensureLyricsFolderId,
  findLyricsFolderId,
  getFileMeta,
  listChildrenPage,
  updateFile,
} from "./drive";
import { userEntry, type UserLyricsSource } from "./lyrics-fetch";

interface UserLyricsFile {
  fileId: string;
  modifiedTime: string;
}

/** undefined until the first successful load of the folder. */
let index: Map<string, UserLyricsFile> | undefined;

/** Bumped whenever user lyrics change (import, remove, or a different index after a refresh). */
export const useLyricsVersion = create<{ version: number }>(() => ({ version: 0 }));
const bump = () => useLyricsVersion.setState((s) => ({ version: s.version + 1 }));

const EXT = ".lrc";
const MIN_REFRESH_MS = 20_000;
let loading: Promise<void> | null = null;
let loadedAt = 0;

function sameIndex(a: Map<string, UserLyricsFile> | undefined, b: Map<string, UserLyricsFile>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const [id, f] of b) {
    const o = a.get(id);
    if (!o || o.fileId !== f.fileId || o.modifiedTime !== f.modifiedTime) return false;
  }
  return true;
}

/** List the lyrics folder (without creating it). Throttled; `force` skips the throttle. */
export function loadUserLyricsIndex(force = false): Promise<void> {
  if (loading) return loading;
  if (!force && index && Date.now() - loadedAt < MIN_REFRESH_MS) return Promise.resolve();
  loading = (async () => {
    const folderId = await findLyricsFolderId();
    const next = new Map<string, UserLyricsFile>();
    if (folderId) {
      let pageToken: string | undefined;
      do {
        const page = await listChildrenPage(folderId, pageToken);
        for (const f of page.files) {
          if (f.name.toLowerCase().endsWith(EXT) && f.modifiedTime) {
            next.set(f.name.slice(0, -EXT.length), { fileId: f.id, modifiedTime: f.modifiedTime });
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    const first = index === undefined;
    const changed = !sameIndex(index, next);
    index = next;
    loadedAt = Date.now();
    // the first load also matters when empty: lookups made before it fell back to whatever was cached
    if (first || changed) bump();
  })()
    .catch(() => undefined) // offline or signed out: keep what we have, retry on the next trigger
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Refresh the index on the same events as the playlists sync. */
export function installUserLyricsTriggers(): () => void {
  const trigger = () => navigator.onLine && void loadUserLyricsIndex();
  const onVisible = () => document.visibilityState === "visible" && trigger();
  window.addEventListener("focus", trigger);
  window.addEventListener("online", trigger);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", trigger);
    window.removeEventListener("online", trigger);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Forget the index (sign out). */
export function resetUserLyrics(): void {
  index = undefined;
  loadedAt = 0;
  bump();
}

export const hasUserLyrics = (trackId: string): boolean => index?.has(trackId) ?? false;

/** Re-renders when user lyrics change. */
export function useHasUserLyrics(trackId: string | undefined): boolean {
  useLyricsVersion((s) => s.version);
  return trackId ? hasUserLyrics(trackId) : false;
}

/** Plugs the index into fetchLyricsFor. */
export const userLyricsSource: UserLyricsSource = {
  modifiedTime: (trackId) => (index ? (index.get(trackId)?.modifiedTime ?? null) : undefined),
  download: async (trackId) => {
    const f = index?.get(trackId);
    if (!f) throw new Error("No lyrics file");
    return new TextDecoder().decode(await downloadBytes(f.fileId));
  },
};

/** Write (or overwrite) the track's lyrics file on Drive and make it the track's lyrics right away. */
export async function saveUserLyrics(trackId: string, lrcText: string): Promise<void> {
  const bytes = new TextEncoder().encode(lrcText);
  if (!index) await loadUserLyricsIndex(true); // so an existing file is overwritten, not duplicated
  const folderId = await ensureLyricsFolderId();
  let fileId = index?.get(trackId)?.fileId;
  if (fileId) {
    try {
      await updateFile(fileId, bytes);
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      fileId = undefined; // deleted in Drive since the index was loaded
    }
  }
  fileId ??= await createFile(folderId, trackId + EXT, bytes);
  const meta = await getFileMeta(fileId);
  const modifiedTime = meta.modifiedTime ?? new Date().toISOString();
  index = new Map(index ?? []).set(trackId, { fileId, modifiedTime });
  await dbPut("lyrics", trackId, userEntry(lrcText, modifiedTime, Date.now()));
  bump();
}

/** Delete the track's lyrics file; the track goes back to lrclib. */
export async function removeUserLyrics(trackId: string): Promise<void> {
  const f = index?.get(trackId);
  if (f) await deleteFile(f.fileId);
  if (index) {
    index = new Map(index);
    index.delete(trackId);
  }
  await dbDel("lyrics", trackId);
  bump();
}
