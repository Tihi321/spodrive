/** Read tags + embedded cover from the head of a Drive file (shared by the scanner and lazy cover loading). */
import { parseBuffer, selectCover } from "music-metadata";
import { downloadRange } from "./drive";
import { HEAD_MIN, headBytesNeeded, mapTags, type TrackMeta } from "./tags";

export interface ReadResult {
  meta: TrackMeta;
  cover?: { data: Uint8Array; mime: string };
}

export interface FileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  parentName?: string;
}

/** Fetch the head of the file: first HEAD_MIN bytes, then more when the ID3v2 tag is bigger. */
export async function fetchHead(file: Pick<FileRef, "id" | "size">, signal?: AbortSignal): Promise<Uint8Array> {
  const first = Math.min(file.size, HEAD_MIN);
  let head = await downloadRange(file.id, 0, Math.max(0, first - 1), signal);
  const need = headBytesNeeded(head, file.size);
  if (need > head.length) {
    const more = await downloadRange(file.id, head.length, need - 1, signal);
    const all = new Uint8Array(head.length + more.length);
    all.set(head);
    all.set(more, head.length);
    head = all;
  }
  return head;
}

/** Unreadable metadata falls back to defaults derived from the file/folder name. */
export async function readMetadata(file: FileRef, signal?: AbortSignal): Promise<ReadResult> {
  const head = await fetchHead(file, signal);
  try {
    // duration:false -> we only hold the head, a full scan would measure the truncated buffer
    const md = await parseBuffer(head, { mimeType: file.mime, size: file.size }, { duration: false });
    const pic = selectCover(md.common.picture);
    return {
      meta: mapTags(file.name, file.parentName, { ...md.common, duration: md.format.duration }),
      cover: pic ? { data: pic.data, mime: pic.format } : undefined,
    };
  } catch {
    return { meta: mapTags(file.name, file.parentName, {}) };
  }
}

/** Downscale cover art to a JPEG of at most `max` px (keeps IndexedDB small). Falls back to the original bytes. */
export async function downscaleCover(cover: { data: Uint8Array; mime: string }, max = 512): Promise<Blob> {
  const original = new Blob([cover.data as Uint8Array<ArrayBuffer>], { type: cover.mime || "image/jpeg" });
  try {
    const bmp = await createImageBitmap(original);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  } catch {
    return original;
  }
}
