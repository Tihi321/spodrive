/** Minimal Google Drive v3 REST client (drive.file scope). */
import { ROOT_FOLDER } from "@spodrive/core";
import { DRIVE_API, DRIVE_UPLOAD, driveMediaUrl } from "./urls";
import { KV, kvGet, kvSet, type DriveIds } from "./db";
import { getAccessToken, refreshToken } from "./auth";

export class DriveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

async function authed(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    await refreshToken();
    return authed(url, init, false);
  }
  return res;
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* ignore */
    }
    throw new DriveError(res.status, `${what} failed (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  return res;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function list(q: string): Promise<Array<{ id: string; name: string }>> {
  const url = `${DRIVE_API}/files?${new URLSearchParams({
    q,
    fields: "files(id,name)",
    pageSize: "20",
    spaces: "drive",
  })}`;
  const res = await ok(await authed(url), "Drive list");
  return ((await res.json()) as { files: Array<{ id: string; name: string }> }).files;
}

/** The Spodrive root folder created by the app (marked with appProperties.spodrive = root). */
export async function findRoot(): Promise<string | null> {
  const files = await list("appProperties has { key='spodrive' and value='root' } and trashed=false");
  return files[0]?.id ?? null;
}

export async function createFolder(name: string, appProperties?: Record<string, string>, parents?: string[]): Promise<string> {
  const res = await authed(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", appProperties, parents }),
  });
  await ok(res, "Drive create folder");
  return ((await res.json()) as { id: string }).id;
}

export async function findChild(rootId: string, name: string): Promise<string | null> {
  const files = await list(`'${esc(rootId)}' in parents and name='${esc(name)}' and trashed=false`);
  return files[0]?.id ?? null;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Drive returns the size as a string; absent for folders */
  size?: string;
  md5Checksum?: string;
  /** RFC 3339 */
  modifiedTime?: string;
  parents?: string[];
  trashed?: boolean;
}
const FILE_FIELDS = "id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed";

/** One page of the direct children of a folder (subfolders included). */
export async function listChildrenPage(
  folderId: string,
  pageToken?: string,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: `'${esc(folderId)}' in parents and trashed=false`,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: "1000",
    spaces: "drive",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const res = await ok(await authed(`${DRIVE_API}/files?${params}`), "Drive list");
  return (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  const res = await ok(await authed(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`), "Drive get");
  return (await res.json()) as DriveFile;
}

export async function downloadBytes(fileId: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await ok(await authed(driveMediaUrl(fileId), { signal }), "Drive download");
  return new Uint8Array(await res.arrayBuffer());
}

export async function downloadRange(fileId: string, start: number, endInclusive: number, signal?: AbortSignal) {
  const res = await ok(
    await authed(driveMediaUrl(fileId), { signal, headers: { Range: `bytes=${start}-${endInclusive}` } }),
    "Drive range download",
  );
  return new Uint8Array(await res.arrayBuffer());
}

/** Stream a whole file, reporting progress. */
export async function downloadBlob(
  fileId: string,
  opts: { signal?: AbortSignal; onProgress?: (received: number) => void } = {},
): Promise<Blob> {
  const res = await ok(await authed(driveMediaUrl(fileId), { signal: opts.signal }), "Drive download");
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value as Uint8Array<ArrayBuffer>);
    received += value.length;
    opts.onProgress?.(received);
  }
  return new Blob(parts);
}

export async function updateFile(fileId: string, bytes: Uint8Array): Promise<void> {
  const res = await authed(`${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  await ok(res, "Drive update");
}

/** Delete a file (permanently; a missing file counts as deleted). */
export async function deleteFile(fileId: string): Promise<void> {
  const res = await authed(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (res.status === 404) return;
  await ok(res, "Drive delete");
}

/** Multipart upload creating a new file inside `parentId`. Returns the new file id. */
export async function createFile(parentId: string, name: string, bytes: Uint8Array): Promise<string> {
  const boundary = "spodrive" + crypto.randomUUID().replace(/-/g, "");
  const meta = JSON.stringify({ name, parents: [parentId], mimeType: "application/octet-stream" });
  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes as Uint8Array<ArrayBuffer>,
    enc.encode(`\r\n--${boundary}--`),
  ]);
  const res = await authed(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  await ok(res, "Drive create");
  return ((await res.json()) as { id: string }).id;
}

// ---- cached folder/file ids ----
export async function getDriveIds(): Promise<DriveIds | undefined> {
  return kvGet<DriveIds>(KV.driveIds);
}
export async function saveDriveIds(ids: DriveIds): Promise<void> {
  await kvSet(KV.driveIds, ids);
}

/** Root id (cached), or null when it has not been created yet. */
export async function getRootId(): Promise<string | null> {
  const ids = await getDriveIds();
  if (ids?.rootId) return ids.rootId;
  const rootId = await findRoot();
  if (rootId) await saveDriveIds({ rootId });
  return rootId;
}

/** Root id, creating the Spodrive folder on first use. */
let rootInflight: Promise<string> | null = null;
export function ensureRootId(): Promise<string> {
  // shared promise: concurrent first writes (library + playlists) must not create two folders
  rootInflight ??= (async () => {
    const existing = await getRootId();
    if (existing) return existing;
    const rootId = await createFolder(ROOT_FOLDER, { spodrive: "root" });
    await saveDriveIds({ rootId });
    return rootId;
  })().finally(() => {
    rootInflight = null;
  });
  return rootInflight;
}

/** Subfolders of the Spodrive root: name in Drive, appProperties marker, and where the id is cached. */
const SUBFOLDERS = {
  uploadsId: { name: "Music", tag: "uploads" },
  lyricsId: { name: "lyrics", tag: "lyrics" },
} as const;
type SubfolderKey = keyof typeof SUBFOLDERS;

async function findSubfolder(rootId: string, name: string): Promise<string | null> {
  const found = await list(
    `'${esc(rootId)}' in parents and name='${esc(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  return found[0]?.id ?? null;
}

/** Id of a Spodrive subfolder (cached and verified), creating it on first use. */
const subfolderInflight = new Map<SubfolderKey, Promise<string>>();
export function ensureSubfolderId(key: SubfolderKey): Promise<string> {
  let p = subfolderInflight.get(key);
  if (!p) {
    const { name, tag } = SUBFOLDERS[key];
    p = (async () => {
      const rootId = await ensureRootId();
      const ids = await getDriveIds();
      const cachedId = ids?.rootId === rootId ? ids[key] : undefined;
      if (cachedId) {
        // the user may have deleted or trashed it in Drive
        const meta = await getFileMeta(cachedId).catch(() => null);
        if (meta && !meta.trashed) return cachedId;
      }
      const id = (await findSubfolder(rootId, name)) ?? (await createFolder(name, { spodrive: tag }, [rootId]));
      const latest = await getDriveIds();
      await saveDriveIds({ ...(latest?.rootId === rootId ? latest : { rootId }), [key]: id });
      return id;
    })().finally(() => {
      subfolderInflight.delete(key);
    });
    subfolderInflight.set(key, p);
  }
  return p;
}

/** Spodrive/Music folder id (the Picker's upload target), creating it on first use. */
export const ensureUploadsFolderId = () => ensureSubfolderId("uploadsId");

/** Spodrive/lyrics folder id (imported .lrc files), creating it on first use. */
export const ensureLyricsFolderId = () => ensureSubfolderId("lyricsId");

/** Spodrive/lyrics folder id without creating it, or null when there is none yet. */
export async function findLyricsFolderId(): Promise<string | null> {
  const rootId = await getRootId();
  if (!rootId) return null;
  const ids = await getDriveIds();
  if (ids?.rootId === rootId && ids.lyricsId) return ids.lyricsId;
  const id = await findSubfolder(rootId, SUBFOLDERS.lyricsId.name);
  if (id) await saveDriveIds({ ...(ids?.rootId === rootId ? ids : { rootId }), lyricsId: id });
  return id;
}

export async function getChildId(name: "library.json" | "playlists.json", rootId: string): Promise<string | null> {
  const key = name === "library.json" ? "libraryId" : "playlistsId";
  const ids = await getDriveIds();
  if (ids?.rootId === rootId && ids[key]) return ids[key]!;
  const id = await findChild(rootId, name);
  if (id) await saveDriveIds({ ...(ids?.rootId === rootId ? ids : { rootId }), [key]: id });
  return id;
}

/** Forget cached ids (e.g. file was deleted/recreated). */
export async function forgetChildId(key: "libraryId" | "playlistsId"): Promise<void> {
  const ids = await getDriveIds();
  if (ids) await saveDriveIds({ ...ids, [key]: undefined });
}
