/** User actions on the library: add music via the Picker, rescan folders, remove sources. */
import { create } from "zustand";
import { hasFullRead, requestFullRead, useAuth } from "./auth";
import { currentLibrary, commitLibrary } from "./library";
import { dropCovers, saveCover } from "./covers";
import { getFileMeta, listChildrenPage } from "./drive";
import { readMetadata } from "./metadata";
import { pickFromDrive } from "./picker";
import { addPicked, removeSource, rescanSources, type ScanDeps, type ScanProgress, type ScanResult } from "./sources";
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
          : `No readable songs in ${names}. Google only gives Spodrive the files you select: turn on "Read whole folders" in Settings, or open the folder in the picker and select the songs inside it.`,
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
