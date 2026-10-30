/** User actions on the library: add music via the Picker, rescan folders, remove sources. */
import { create } from "zustand";
import { hasFullRead, requestFullRead, useAuth } from "./auth";
import { currentLibrary, commitLibrary } from "./library";
import { dropCovers, saveCover } from "./covers";
import { getFileMeta, listChildrenPage } from "./drive";
import { readMetadata } from "./metadata";
import { pickFolders, pickFromDrive, pickSongsIn } from "./picker";
import { FOLDER_MIME, addFolder, addPicked, removeSource, rescanSources, type ScanDeps, type ScanProgress, type ScanResult } from "./sources";
import { toast, toastError } from "../state/toasts";

interface ScanState {
  running: boolean;
  label: string;
  progress: ScanProgress;
}
export const useScan = create<ScanState>(() => ({ running: false, label: "", progress: { done: 0, total: 0, failed: 0 } }));

const realDeps: ScanDeps = {
  async listChildren(folderId) {
    const all = [];
    let pageToken: string | undefined;
    do {
      const page = await listChildrenPage(folderId, pageToken);
      all.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  },
  getMeta: getFileMeta,
  read: (f) => readMetadata(f),
  saveCover,
};

async function run(label: string, job: () => Promise<ScanResult | null>): Promise<ScanResult | null> {
  if (useScan.getState().running) {
    toast("A scan is already running");
    return null;
  }
  useScan.setState({ running: true, label, progress: { done: 0, total: 0, failed: 0 } });
  try {
    return await job();
  } finally {
    useScan.setState({ running: false });
  }
}

function summary(r: ScanResult): string {
  const parts = [`${r.added} ${r.added === 1 ? "track" : "tracks"} added`];
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.removedIds.length) parts.push(`${r.removedIds.length} removed`);
  if (r.failed) parts.push(`${r.failed} could not be read`);
  return parts.join(", ");
}

async function save(r: ScanResult): Promise<void> {
  try {
    await commitLibrary(r.library);
  } catch (e) {
    toastError(e, "Saved on this device, but uploading library.json to Drive failed");
  }
}

/** Open the Picker, scan what was picked and merge it into the library. */
export async function addMusic(): Promise<void> {
  let docs;
  try {
    docs = await pickFromDrive();
  } catch (e) {
    toastError(e);
    return;
  }
  if (docs.length === 0) return;
  try {
    const result = await run("Adding music", () =>
      addPicked(currentLibrary(), docs, realDeps, (progress) => useScan.setState({ progress })),
    );
    if (!result) return;
    if (result.emptyFolders.length) {
      const names = result.emptyFolders.join(", ");
      toast(
        hasFullRead(useAuth.getState().token)
          ? `No readable songs in ${names}.`
          : `No readable songs in ${names}. Google only gives Spodrive the files you select: use "Add folders" and select the songs inside each folder, or turn on "Read whole folders" in Settings.`,
        { kind: "info", durationMs: 12000 },
      );
    }
    if (result.added > 0 || result.updated > 0 || result.library.sources.length !== currentLibrary().sources.length) {
      await save(result);
      toast(summary(result), { kind: "success" });
    } else if (result.failed) toast(summary(result), { kind: "error" });
  } catch (e) {
    toastError(e, "Could not add music");
  }
}

/** Add one or more folders: choose the folders, then the songs inside each one (unless whole folders can be read). */
export async function addFolders(): Promise<void> {
  let folders;
  try {
    folders = (await pickFolders()).filter((d) => d.mimeType === FOLDER_MIME);
  } catch (e) {
    toastError(e);
    return;
  }
  if (folders.length === 0) return;
  const fullRead = hasFullRead(useAuth.getState().token);
  let folderCount = 0;
  try {
    const result = await run("Adding folders", async () => {
      let lib = currentLibrary();
      const total: ScanResult = { library: lib, added: 0, updated: 0, failed: 0, emptyFolders: [], removedIds: [] };
      for (const folder of folders) {
        // with whole-folder read the listing finds the songs; otherwise the user selects them
        const files = fullRead ? [] : await pickSongsIn(folder);
        if (!fullRead && files.length === 0) continue; // cancelled: skip this folder
        const r = await addFolder(lib, folder, files, realDeps, (progress) => useScan.setState({ progress }));
        lib = r.library;
        total.added += r.added;
        total.updated += r.updated;
        total.failed += r.failed;
        total.emptyFolders.push(...r.emptyFolders);
        if (r.emptyFolders.length === 0) folderCount++;
      }
      total.library = lib;
      return total;
    });
    if (!result) return;
    if (result.emptyFolders.length) {
      toast(`No readable songs in ${result.emptyFolders.join(", ")}.`, { kind: "info", durationMs: 12000 });
    }
    if (result.added > 0 || result.updated > 0 || result.library.sources.length !== currentLibrary().sources.length) {
      await save(result);
      const k = folderCount;
      toast(`${result.added} ${result.added === 1 ? "track" : "tracks"} added from ${k} ${k === 1 ? "folder" : "folders"}${result.failed ? `, ${result.failed} could not be read` : ""}`, {
        kind: "success",
      });
    } else if (result.failed) toast(summary(result), { kind: "error" });
  } catch (e) {
    toastError(e, "Could not add folders");
  }
}

/** Open the songs Picker inside an existing folder source, to add songs put there later. */
export async function addSongsToFolder(sourceId: string): Promise<void> {
  const source = currentLibrary().sources.find((s) => s.id === sourceId && s.kind === "folder");
  if (!source) return;
  const folder = { id: source.id, name: source.name, mimeType: FOLDER_MIME };
  try {
    const result = await run("Adding songs", async () => {
      const files = await pickSongsIn(folder);
      if (files.length === 0) return null;
      return addFolder(currentLibrary(), folder, files, realDeps, (progress) => useScan.setState({ progress }));
    });
    if (!result) return;
    if (result.added > 0 || result.updated > 0) {
      await save(result);
      toast(summary(result), { kind: "success" });
    } else toast(result.failed ? summary(result) : "Nothing new found", { kind: result.failed ? "error" : "info" });
  } catch (e) {
    toastError(e, "Could not add songs");
  }
}

/** Re-list folder sources (all when `sourceId` is omitted). */
export async function rescan(sourceId?: string): Promise<void> {
  const lib = currentLibrary();
  const ids = sourceId ? [sourceId] : lib.sources.filter((s) => s.kind === "folder").map((s) => s.id);
  if (ids.length === 0) return;
  try {
    const result = await run("Rescanning", () => rescanSources(lib, ids, realDeps, (progress) => useScan.setState({ progress })));
    if (!result) return;
    await dropCovers(result.removedIds);
    if (result.added > 0 || result.updated > 0 || result.removedIds.length > 0) {
      await save(result);
      toast(summary(result), { kind: "success" });
    } else toast(result.failed ? "Could not reach the folder" : "Nothing new found", { kind: result.failed ? "error" : "info" });
  } catch (e) {
    toastError(e, "Rescan failed");
  }
}

/** Remove a source and its tracks from the library. The user's files in Drive are never touched. */
export async function removeSourceById(sourceId: string): Promise<void> {
  const { library, removedIds } = removeSource(currentLibrary(), sourceId);
  await dropCovers(removedIds);
  await save({ library, added: 0, updated: 0, failed: 0, emptyFolders: [], removedIds });
  toast("Removed from your library");
}

/** Ask Google for read access to whole folders, then rescan the folders already in the library. */
export async function enableFullRead(): Promise<void> {
  let granted: boolean;
  try {
    granted = await requestFullRead();
  } catch (e) {
    toastError(e, "Google did not grant access");
    return;
  }
  if (!granted) {
    toast('Google did not grant read access. Try again and tick "See and download all your Google Drive files".', { kind: "error", durationMs: 10000 });
    return;
  }
  toast("Spodrive can now read whole folders. Add a folder and everything inside it comes along.", { kind: "success" });
  if (currentLibrary().sources.some((s) => s.kind === "folder")) await rescan();
}
