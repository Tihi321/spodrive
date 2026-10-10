/**
 * Pure, unit-testable request handler for `/stream/<trackId>`.
 * Maps an HTTP Range over the *plaintext* to encrypted chunk batches, decrypts them
 * progressively and returns a streaming 200/206/416 response.
 */
import {
  HEADER_SIZE,
  TAG_SIZE,
  chunkCount,
  decryptChunks,
  encryptedSize,
  importContentKeyB64,
  parseHeader,
  type StreamHeader,
} from "@spodrive/core";

export interface StreamTrack {
  id: string;
  driveFileId: string;
  plainSize: number;
  chunkSize: number;
  mime: string;
  /** base64 raw content key */
  key: string;
}

export interface HeaderCache {
  get(trackId: string): Promise<Uint8Array | undefined>;
  put(trackId: string, bytes: Uint8Array): Promise<void>;
}

export interface StreamDeps {
  getTrack(id: string): Promise<StreamTrack | undefined>;
  /** Encrypted bytes [start, endInclusive] of the whole SPD1 file. */
  fetchEnc(track: StreamTrack, start: number, endInclusive: number, signal: AbortSignal): Promise<Uint8Array>;
  headerCache?: HeaderCache;
  /** Chunks in the very first batch (small = fast start). Default 2. */
  firstBatchChunks?: number;
  /** Chunks per later batch (8 x 64 KiB = 512 KiB). Default 8. */
  batchChunks?: number;
}

export type ParsedRange = { kind: "full" } | { kind: "range"; start: number; end: number } | { kind: "invalid" };

export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (!header) return { kind: "full" };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return header.includes(",") ? { kind: "full" } : { kind: "invalid" };
  const a = m[1]!;
  const b = m[2]!;
  if (a === "" && b === "") return { kind: "invalid" };
  let start: number;
  let end: number;
  if (a === "") {
    const n = parseInt(b, 10); // suffix: last n bytes
    if (n <= 0) return { kind: "invalid" };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(a, 10);
    if (b !== "" && parseInt(b, 10) < start) return { kind: "invalid" };
    end = b === "" ? size - 1 : Math.min(parseInt(b, 10), size - 1);
  }
  if (start >= size) return { kind: "invalid" };
  return { kind: "range", start, end };
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function contentKey(b64: string): Promise<CryptoKey> {
  let k = keyCache.get(b64);
  if (!k) {
    if (keyCache.size > 200) keyCache.clear();
    k = importContentKeyB64(b64);
    keyCache.set(b64, k);
  }
  return k;
}

async function loadHeader(track: StreamTrack, deps: StreamDeps, signal: AbortSignal): Promise<StreamHeader> {
  const cached = await deps.headerCache?.get(track.id).catch(() => undefined);
  if (cached && cached.length >= HEADER_SIZE) {
    try {
      return parseHeader(cached);
    } catch {
      /* refetch */
    }
  }
  const bytes = await deps.fetchEnc(track, 0, HEADER_SIZE - 1, signal);
  const header = parseHeader(bytes);
  await deps.headerCache?.put(track.id, bytes.slice(0, HEADER_SIZE)).catch(() => undefined);
  return header;
}

function textResponse(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...extra } });
}

export async function handleStreamRequest(
  request: { headers: Headers; signal?: AbortSignal },
  trackId: string,
  deps: StreamDeps,
): Promise<Response> {
  const ac = new AbortController();
  if (request.signal) {
    if (request.signal.aborted) ac.abort();
    else request.signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  const track = await deps.getTrack(trackId);
  if (!track) return textResponse(404, "Unknown track");
  const size = track.plainSize;

  const common = {
    "Accept-Ranges": "bytes",
    "Content-Type": track.mime || "audio/mpeg",
    "Cache-Control": "no-store",
  };

  const parsed = parseRangeHeader(request.headers.get("Range"), size);
  if (size === 0) {
    return parsed.kind === "invalid"
      ? textResponse(416, "Range Not Satisfiable", { "Content-Range": "bytes */0" })
      : new Response(new Uint8Array(0), { status: 200, headers: { ...common, "Content-Length": "0" } });
  }
  if (parsed.kind === "invalid") {
    return textResponse(416, "Range Not Satisfiable", { "Content-Range": `bytes */${size}` });
  }
  const start = parsed.kind === "range" ? parsed.start : 0;
  const end = parsed.kind === "range" ? parsed.end : size - 1;

  let header: StreamHeader;
  let key: CryptoKey;
  try {
    header = await loadHeader(track, deps, ac.signal);
    key = await contentKey(track.key);
  } catch (e) {
    return textResponse(502, `Cannot open track: ${(e as Error).message}`);
  }

  const cs = header.chunkSize;
  const stride = cs + TAG_SIZE;
  const total = chunkCount(size, cs);
  const encTotal = encryptedSize(size, cs);
  const firstChunk = Math.floor(start / cs);
  const lastChunk = Math.floor(end / cs);

  // Batches of chunk indexes (inclusive). First one small for a fast start.
  const firstN = Math.max(1, deps.firstBatchChunks ?? 2);
  const restN = Math.max(1, deps.batchChunks ?? 8);
  const batches: Array<[number, number]> = [];
  for (let c = firstChunk, n = firstN; c <= lastChunk; c += n, n = restN) {
    batches.push([c, Math.min(c + n - 1, lastChunk)]);
  }

  const fetchBatch = async ([a, b]: [number, number]): Promise<Uint8Array> => {
    const encStart = HEADER_SIZE + a * stride;
    const encEnd = Math.min(HEADER_SIZE + (b + 1) * stride, encTotal) - 1;
    const enc = await deps.fetchEnc(track, encStart, encEnd, ac.signal);
    const pt = await decryptChunks(key, header, enc, a, total);
    const from = Math.max(start, a * cs) - a * cs;
    const to = Math.min(end + 1, (b + 1) * cs) - a * cs;
    return pt.subarray(from, to);
  };
  const begin = (i: number): Promise<Uint8Array> => {
    const p = fetchBatch(batches[i]!);
    p.catch(() => undefined); // avoid unhandled rejection if nobody awaits (cancelled)
    return p;
  };

  let firstData: Uint8Array;
  try {
    firstData = await begin(0);
  } catch (e) {
    return textResponse(502, `Upstream error: ${(e as Error).message}`);
  }

  let i = 1;
  let next: Promise<Uint8Array> | null = batches.length > 1 ? begin(1) : null;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(firstData);
        if (batches.length === 1) controller.close();
      },
      async pull(controller) {
        if (!next) return;
        const current = next;
        i++;
        next = i < batches.length ? begin(i) : null; // read-ahead one batch
        try {
          controller.enqueue(await current);
        } catch (e) {
          ac.abort();
          controller.error(e);
          return;
        }
        if (!next) controller.close();
      },
      cancel() {
        ac.abort();
      },
    },
    { highWaterMark: 1 },
  );

  const headers: Record<string, string> = { ...common, "Content-Length": String(end - start + 1) };
  if (parsed.kind === "range") {
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: 206, headers });
  }
  return new Response(body, { status: 200, headers });
}
