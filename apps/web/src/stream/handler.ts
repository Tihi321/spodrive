/**
 * Pure, unit-testable request handler for `/stream/<trackId>`.
 * A plain Range proxy: serves the requested bytes from a local copy (offline/prefetch) or from Drive,
 * as a 200/206/416 response with the headers <audio> needs for seeking.
 */

export interface StreamTrack {
  id: string;
  driveFileId: string;
  /** bytes */
  size: number;
  mime: string;
}

export interface StreamDeps {
  getTrack(id: string): Promise<StreamTrack | undefined>;
  /** Bytes [start, endInclusive] of the file: from a local copy, or streamed from Drive. */
  fetchRange(track: StreamTrack, start: number, endInclusive: number, signal: AbortSignal): Promise<Uint8Array | ReadableStream<Uint8Array>>;
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
  const size = track.size;

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

  let data: Uint8Array | ReadableStream<Uint8Array>;
  try {
    data = await deps.fetchRange(track, start, end, ac.signal);
  } catch (e) {
    return textResponse(502, `Upstream error: ${(e as Error).message}`);
  }

  const headers: Record<string, string> = { ...common, "Content-Length": String(end - start + 1) };
  if (parsed.kind === "range") {
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(data as BodyInit, { status: 206, headers });
  }
  return new Response(data as BodyInit, { status: 200, headers });
}
