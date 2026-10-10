/** Minimal Google Drive v3 REST client (drive.file scope). */
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

/** The Spodrive root folder created by the CLI (marked with appProperties.spodrive = root). */
export async function findRoot(): Promise<string | null> {
  const files = await list("appProperties has { key='spodrive' and value='root' } and trashed=false");
  return files[0]?.id ?? null;
}

export async function findChild(rootId: string, name: string): Promise<string | null> {
  const files = await list(`'${esc(rootId)}' in parents and name='${esc(name)}' and trashed=false`);
  return files[0]?.id ?? null;
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

/** Root id (cached), or null when the CLI has not created it yet. */
export async function getRootId(): Promise<string | null> {
  const ids = await getDriveIds();
  if (ids?.rootId) return ids.rootId;
  const rootId = await findRoot();
  if (rootId) await saveDriveIds({ rootId });
  return rootId;
}

export async function getChildId(name: "vault.json" | "library.enc" | "playlists.enc", rootId: string): Promise<string | null> {
  const key = name === "vault.json" ? "vaultId" : name === "library.enc" ? "libraryId" : "playlistsId";
  const ids = await getDriveIds();
  if (ids?.rootId === rootId && ids[key]) return ids[key]!;
  const id = await findChild(rootId, name);
  if (id) await saveDriveIds({ ...(ids?.rootId === rootId ? ids : { rootId }), [key]: id });
  return id;
}

/** Forget cached ids (e.g. file was deleted/recreated). */
export async function forgetChildId(key: "vaultId" | "libraryId" | "playlistsId"): Promise<void> {
  const ids = await getDriveIds();
  if (ids) await saveDriveIds({ ...ids, [key]: undefined });
}
