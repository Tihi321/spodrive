/**
 * Playlists: stored as plain playlists.json on Drive, cached locally,
 * merged per playlist by updatedAt. Works offline: changes are saved locally first and
 * uploaded as soon as we are online (dirty flag).
 */
import { create } from "zustand";
import { PLAYLISTS_FILE, emptyPlaylists, mergePlaylists, type Playlist, type PlaylistsFile } from "@spodrive/core";
import { KV, kvGet, kvSet } from "./db";
import { createFile, downloadBytes, ensureRootId, forgetChildId, getChildId, getDriveIds, getRootId, saveDriveIds, updateFile } from "./drive";
import { toastError } from "../state/toasts";
import { isAuthError } from "./errors";

interface PlaylistsState {
  file: PlaylistsFile;
  loaded: boolean;
  syncing: boolean;
  /** Local changes not yet uploaded. */
  dirty: boolean;
  /** Bumped on each local mutation (to detect edits made during a sync). */
  rev: number;
  lastError?: string;
}

export const usePlaylists = create<PlaylistsState>(() => ({
  file: emptyPlaylists(),
  loaded: false,
  syncing: false,
  dirty: false,
  rev: 0,
}));

export const activePlaylists = (f: PlaylistsFile): Playlist[] =>
  f.playlists.filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

export function playlistsEqual(a: PlaylistsFile, b: PlaylistsFile): boolean {
  if (a.playlists.length !== b.playlists.length) return false;
  const m = new Map(b.playlists.map((p) => [p.id, p.updatedAt]));
  return a.playlists.every((p) => m.get(p.id) === p.updatedAt);
}

async function persistLocal(): Promise<void> {
  const { file, dirty } = usePlaylists.getState();
  await kvSet(KV.playlists, file);
  await kvSet(KV.playlistsDirty, dirty);
}

export async function loadLocalPlaylists(): Promise<void> {
  const cached = await kvGet<PlaylistsFile>(KV.playlists);
  const dirty = (await kvGet<boolean>(KV.playlistsDirty)) ?? false;
  const file = cached?.format === "spodrive-playlists" && Array.isArray(cached.playlists) ? cached : emptyPlaylists();
  usePlaylists.setState({ file, dirty, loaded: true });
}

export function resetPlaylists(): void {
  clearTimeout(saveTimer);
  usePlaylists.setState({ file: emptyPlaylists(), loaded: false, syncing: false, dirty: false, rev: 0, lastError: undefined });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let again = false;

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void syncPlaylists(), 1500);
}

function mutate(fn: (playlists: Playlist[], now: string) => Playlist[]): void {
  const now = new Date().toISOString();
  usePlaylists.setState((s) => ({
    file: { ...s.file, updatedAt: now, playlists: fn(s.file.playlists, now) },
    dirty: true,
    rev: s.rev + 1,
  }));
  void persistLocal().catch((e) => toastError(e, "Could not save playlists locally"));
  scheduleSave();
}

const touch = (p: Playlist, now: string, patch: Partial<Playlist>): Playlist => ({ ...p, ...patch, updatedAt: now });

export function createPlaylist(name: string, trackIds: string[] = []): string {
  const id = crypto.randomUUID();
  mutate((list, now) => [
    ...list,
    { id, name: name.trim() || "New playlist", trackIds: [...trackIds], createdAt: now, updatedAt: now },
  ]);
  return id;
}

export function renamePlaylist(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  mutate((list, now) => list.map((p) => (p.id === id ? touch(p, now, { name: n }) : p)));
}

/** Soft delete (tombstone) so the deletion propagates to other devices. */
export function deletePlaylist(id: string): void {
  mutate((list, now) => list.map((p) => (p.id === id ? touch(p, now, { deleted: true, trackIds: [] }) : p)));
}

export function addTracksToPlaylist(id: string, trackIds: string[]): void {
  mutate((list, now) => list.map((p) => (p.id === id ? touch(p, now, { trackIds: [...p.trackIds, ...trackIds] }) : p)));
}

export function removeTrackFromPlaylist(id: string, index: number): void {
  mutate((list, now) =>
    list.map((p) => (p.id === id ? touch(p, now, { trackIds: p.trackIds.filter((_, i) => i !== index) }) : p)),
  );
}

export function reorderPlaylist(id: string, from: number, to: number): void {
  mutate((list, now) =>
    list.map((p) => {
      if (p.id !== id) return p;
      const ids = p.trackIds.slice();
      const [it] = ids.splice(from, 1);
      if (it === undefined) return p;
      ids.splice(to, 0, it);
      return touch(p, now, { trackIds: ids });
    }),
  );
}

/** Download remote, merge, upload when needed. Safe to call often. */
export async function syncPlaylists(): Promise<void> {
  const st = usePlaylists.getState();
  if (!st.loaded) return;
  if (!navigator.onLine) return;
  if (st.syncing) {
    again = true;
    return;
  }
  usePlaylists.setState({ syncing: true, lastError: undefined });
  try {
    const snapshot0 = usePlaylists.getState();
    // nothing to upload and no root yet: do not create the Spodrive folder just for an empty playlist file
    const rootId = snapshot0.dirty ? await ensureRootId() : await getRootId();
    if (!rootId) return;
    let fileId = await getChildId(PLAYLISTS_FILE, rootId);
    let remote: PlaylistsFile | null = null;
    if (fileId) {
      try {
        remote = JSON.parse(new TextDecoder().decode(await downloadBytes(fileId))) as PlaylistsFile;
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          await forgetChildId("playlistsId");
          fileId = null;
        } else throw e;
      }
    }
    const snapshot = usePlaylists.getState();
    const merged = remote ? mergePlaylists(snapshot.file, remote) : snapshot.file;
    const needUpload = remote ? !playlistsEqual(merged, remote) : snapshot.dirty || merged.playlists.length > 0;
    if (needUpload) {
      const bytes = new TextEncoder().encode(JSON.stringify(merged));
      if (fileId) await updateFile(fileId, bytes);
      else {
        const id = await createFile(rootId, PLAYLISTS_FILE, bytes);
        const ids = await getDriveIds();
        await saveDriveIds({ ...(ids ?? { rootId }), rootId, playlistsId: id });
      }
    }
    const current = usePlaylists.getState();
    const editedMeanwhile = current.rev !== snapshot.rev;
    usePlaylists.setState({
      file: editedMeanwhile ? mergePlaylists(current.file, merged) : merged,
      dirty: editedMeanwhile,
    });
    await persistLocal();
    if (editedMeanwhile) scheduleSave();
  } catch (e) {
    usePlaylists.setState({ lastError: (e as Error).message });
    if (!isAuthError(e) && usePlaylists.getState().dirty) toastError(e, "Playlist sync failed (will retry)");
  } finally {
    usePlaylists.setState({ syncing: false });
    if (again) {
      again = false;
      scheduleSave();
    }
  }
}

/** Sync when the window regains focus / connectivity. */
export function installPlaylistSyncTriggers(): () => void {
  const trigger = () => void syncPlaylists();
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
