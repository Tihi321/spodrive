/**
 * Scanner for the library: expands picked folders, diffs against the library, reads tags and builds Tracks.
 * Everything with side effects (Drive listing, tag reading, cover storage) is injected so it is unit-testable.
 */
import type { Library, Source, Track } from "@spodrive/core";
import type { DriveFile } from "./drive";
import type { FileRef, ReadResult } from "./metadata";
import { audioMimeOf } from "./tags";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_DEPTH = 12;

/** A readable audio file found in Drive. */
export interface FoundFile extends FileRef {
  md5: string;
}

export interface ScanDeps {
  /** All direct children of a folder (every page, subfolders included). */
  listChildren(folderId: string): Promise<DriveFile[]>;
  getMeta(fileId: string): Promise<DriveFile>;
  read(file: FoundFile): Promise<ReadResult>;
  saveCover(trackId: string, cover: { data: Uint8Array; mime: string }): Promise<void>;
  now?(): string;
}

export interface ScanProgress {
  done: number;
  total: number;
  failed: number;
}

export function toFound(f: DriveFile, parentName?: string): FoundFile | null {
  if (f.trashed || f.mimeType === FOLDER_MIME) return null;
  const mime = audioMimeOf(f.name, f.mimeType);
  const size = Number(f.size ?? 0);
  if (!mime || !(size > 0)) return null;
  return { id: f.id, name: f.name, mime, size, md5: f.md5Checksum ?? "", parentName };
}

/** Recursively list the audio files of a folder. Errors in the root folder propagate; unreadable subfolders are skipped. */
export async function expandFolder(
  folder: { id: string; name: string },
  listChildren: ScanDeps["listChildren"],
): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const seen = new Set<string>();
  async function walk(f: { id: string; name: string }, depth: number): Promise<void> {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    let children: DriveFile[];
    try {
      children = await listChildren(f.id);
    } catch (e) {
      if (depth === 0) throw e;
      return;
    }
    children = [...children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const c of children) {
      if (c.mimeType === FOLDER_MIME) {
        if (depth < MAX_DEPTH) await walk({ id: c.id, name: c.name }, depth + 1);
      } else {
        const found = toFound(c, f.name);
        if (found) out.push(found);
      }
    }
  }
  await walk(folder, 0);
  return out;
}

export interface SourceDiff {
  added: FoundFile[];
  /** md5 differs from the library: re-read the tags */
  changed: FoundFile[];
  /** tracks of this source whose file is gone */
  removedIds: string[];
}

/** Compare the files currently in a source with the library's tracks. Files already known (same md5) are skipped. */
export function diffSource(tracks: Track[], sourceId: string, found: FoundFile[]): SourceDiff {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const added: FoundFile[] = [];
  const changed: FoundFile[] = [];
  for (const f of found) {
    const cur = byId.get(f.id);
    if (!cur) added.push(f);
    else if (cur.md5 !== f.md5) changed.push(f);
  }
  const foundIds = new Set(found.map((f) => f.id));
  const removedIds = tracks.filter((t) => t.sourceId === sourceId && !foundIds.has(t.id)).map((t) => t.id);
  return { added, changed, removedIds };
}

export function buildTrack(file: FoundFile, sourceId: string, res: ReadResult, addedAt: string): Track {
  return {
    id: file.id,
    driveFileId: file.id,
    sourceId,
    ...res.meta,
    size: file.size,
    mime: file.mime,
    md5: file.md5,
    hasCover: !!res.cover,
    addedAt,
  };
}

/** Replace tracks with the same id (keeping their addedAt and source), append the rest. */
export function mergeTracks(lib: Library, tracks: Track[]): Library {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const kept = lib.tracks.map((old) => {
    const t = byId.get(old.id);
    return t ? { ...t, addedAt: old.addedAt, sourceId: old.sourceId } : old;
  });
  const known = new Set(lib.tracks.map((t) => t.id));
  return { ...lib, tracks: [...kept, ...tracks.filter((t) => !known.has(t.id))] };
}

export function upsertSource(lib: Library, source: Source): Library {
  return { ...lib, sources: [...lib.sources.filter((s) => s.id !== source.id), source] };
}

/** Drop a source and its tracks. Never touches the user's files in Drive. */
export function removeSource(lib: Library, sourceId: string): { library: Library; removedIds: string[] } {
  const removedIds = lib.tracks.filter((t) => t.sourceId === sourceId).map((t) => t.id);
  return {
    library: { ...lib, sources: lib.sources.filter((s) => s.id !== sourceId), tracks: lib.tracks.filter((t) => t.sourceId !== sourceId) },
    removedIds,
  };
}

export function dropTracks(lib: Library, ids: string[]): Library {
  const drop = new Set(ids);
  return { ...lib, tracks: lib.tracks.filter((t) => !drop.has(t.id)) };
}

/** Read tags for `files` with bounded concurrency. Files that cannot be read are counted as failed. */
export async function scanFiles(
  files: FoundFile[],
  sourceId: string,
  deps: ScanDeps,
  onProgress: (p: ScanProgress) => void = () => undefined,
  concurrency = 4,
): Promise<{ tracks: Track[]; failed: number }> {
  const tracks: Track[] = [];
  const progress: ScanProgress = { done: 0, total: files.length, failed: 0 };
  const now = deps.now?.() ?? new Date().toISOString();
  onProgress({ ...progress });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const f = files[next++]!;
      try {
        const res = await deps.read(f);
        const track = buildTrack(f, sourceId, res, now);
        if (res.cover) {
          try {
            await deps.saveCover(track.id, res.cover);
          } catch {
            track.hasCover = false;
          }
        }
        tracks.push(track);
      } catch {
        progress.failed++;
      }
      progress.done++;
      onProgress({ ...progress });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  // workers finish out of order: keep the listing order
  const order = new Map(files.map((f, i) => [f.id, i]));
  tracks.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { tracks, failed: progress.failed };
}

export interface PickedDoc {
  id: string;
  name: string;
  mimeType: string;
}

export interface ScanResult {
  library: Library;
  added: number;
  failed: number;
  /** picked folders that gave no readable audio (the drive.file limitation, or really empty) */
  emptyFolders: string[];
  removedIds: string[];
}

/** Short label for a source made of loose files picked together. */
export function pickLabel(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "Picked files") : `${names[0]} and ${names.length - 1} more`;
}

/**
 * Add picked folders/files to the library (storage-free: returns the new library).
 * Every folder is its own source; all loose files of one pick together form a single source.
 */
export async function addPicked(
  lib: Library,
  picked: PickedDoc[],
  deps: ScanDeps,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  let next = lib;
  let added = 0;
  let failed = 0;
  const emptyFolders: string[] = [];
  const now = deps.now?.() ?? new Date().toISOString();
  const owns = (l: Library, sourceId: string) => l.tracks.some((t) => t.sourceId === sourceId);

  const loose: FoundFile[] = [];
  for (const doc of picked) {
    if (doc.mimeType === FOLDER_MIME) continue;
    try {
      const f = toFound(await deps.getMeta(doc.id));
      if (f) loose.push(f);
    } catch {
      failed++;
    }
  }

  for (const doc of picked.filter((d) => d.mimeType === FOLDER_MIME)) {
    let found: FoundFile[] = [];
    try {
      found = await expandFolder(doc, deps.listChildren);
    } catch {
      /* not accessible: reported below */
    }
    if (found.length === 0) {
      emptyFolders.push(doc.name);
      continue;
    }
    const existed = next.sources.some((s) => s.id === doc.id);
    const diff = diffSource(next.tracks, doc.id, found);
    const res = await scanFiles([...diff.added, ...diff.changed], doc.id, deps, onProgress);
    failed += res.failed;
    added += res.tracks.length;
    next = mergeTracks(next, res.tracks);
    // a new folder whose files were all known already would own nothing: do not list it
    if (existed || owns(next, doc.id)) next = upsertSource(next, { id: doc.id, kind: "folder", name: doc.name, addedAt: now });
  }

  if (loose.length > 0) {
    const id = `pick_${crypto.randomUUID()}`;
    const diff = diffSource(next.tracks, id, loose);
    const res = await scanFiles([...diff.added, ...diff.changed], id, deps, onProgress);
    failed += res.failed;
    added += res.tracks.length;
    next = mergeTracks(next, res.tracks);
    if (owns(next, id)) next = upsertSource(next, { id, kind: "file", name: pickLabel(loose.map((f) => f.name)), addedAt: now });
  }
  return { library: next, added, failed, emptyFolders, removedIds: [] };
}

/** Re-list the given folder sources: add new files, re-read changed ones, drop tracks whose file is gone. */
export async function rescanSources(
  lib: Library,
  sourceIds: string[],
  deps: ScanDeps,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  let next = lib;
  let added = 0;
  let failed = 0;
  const removedIds: string[] = [];
  for (const src of lib.sources.filter((s) => s.kind === "folder" && sourceIds.includes(s.id))) {
    let found: FoundFile[];
    try {
      found = await expandFolder(src, deps.listChildren);
    } catch {
      failed++;
      continue; // folder not reachable right now: keep what we have
    }
    const diff = diffSource(next.tracks, src.id, found);
    const res = await scanFiles([...diff.added, ...diff.changed], src.id, deps, onProgress);
    failed += res.failed;
    added += res.tracks.length;
    next = dropTracks(mergeTracks(next, res.tracks), diff.removedIds);
    removedIds.push(...diff.removedIds);
  }
  return { library: next, added, failed, emptyFolders: [], removedIds };
}
