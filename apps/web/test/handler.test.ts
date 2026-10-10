import { beforeAll, describe, expect, it } from "vitest";
import { HEADER_SIZE, encryptFile, generateContentKey, toBase64 } from "@spodrive/core";
import { handleStreamRequest, parseRangeHeader, type StreamDeps, type StreamTrack } from "../src/stream/handler";
import { createTokenRequester } from "../src/stream/sources";

const CHUNK = 1024;
const SIZE = 10_000 + 37; // 10 chunks, last one partial
let plain: Uint8Array;
let enc: Uint8Array;
let track: StreamTrack;
let calls: Array<[number, number]>;
let aborted: boolean;
let deps: StreamDeps;
let headerStore: Map<string, Uint8Array>;

beforeAll(async () => {
  plain = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) plain[i] = (i * 31 + (i >> 8)) & 0xff;
  const key = generateContentKey();
  enc = await encryptFile(key, plain, CHUNK);
  track = { id: "t1", driveFileId: "f1", plainSize: SIZE, chunkSize: CHUNK, mime: "audio/mpeg", key: toBase64(key) };
});

function setup(opts: Partial<StreamDeps> = {}) {
  calls = [];
  aborted = false;
  headerStore = new Map();
  deps = {
    getTrack: async (id) => (id === "t1" ? track : undefined),
    fetchEnc: async (_t, s, e, signal) => {
      calls.push([s, e]);
      signal.addEventListener("abort", () => (aborted = true));
      return enc.slice(s, e + 1);
    },
    headerCache: {
      get: async (id) => headerStore.get(id),
      put: async (id, b) => void headerStore.set(id, b),
    },
    ...opts,
  };
}

const req = (range?: string) => ({ headers: new Headers(range ? { Range: range } : {}) });
const body = async (r: Response) => new Uint8Array(await r.arrayBuffer());

async function expectRange(range: string, start: number, end: number) {
  setup();
  const res = await handleStreamRequest(req(range), "t1", deps);
  expect(res.status).toBe(206);
  expect(res.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/${SIZE}`);
  expect(res.headers.get("Content-Length")).toBe(String(end - start + 1));
  expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  const out = await body(res);
  expect(out.length).toBe(end - start + 1);
  expect(Buffer.from(out).equals(Buffer.from(plain.subarray(start, end + 1)))).toBe(true);
}

describe("parseRangeHeader", () => {
  it("parses forms", () => {
    expect(parseRangeHeader(null, 100)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=0-1", 100)).toEqual({ kind: "range", start: 0, end: 1 });
    expect(parseRangeHeader("bytes=10-", 100)).toEqual({ kind: "range", start: 10, end: 99 });
    expect(parseRangeHeader("bytes=-5", 100)).toEqual({ kind: "range", start: 95, end: 99 });
    expect(parseRangeHeader("bytes=50-5000", 100)).toEqual({ kind: "range", start: 50, end: 99 });
    expect(parseRangeHeader("bytes=100-", 100)).toEqual({ kind: "invalid" });
    expect(parseRangeHeader("bytes=9-3", 100)).toEqual({ kind: "invalid" });
    expect(parseRangeHeader("bytes=-", 100)).toEqual({ kind: "invalid" });
    expect(parseRangeHeader("items=0-1", 100)).toEqual({ kind: "invalid" });
  });
});

describe("handleStreamRequest", () => {
  it("bytes=0-1", () => expectRange("bytes=0-1", 0, 1));
  it("bytes=0- (open ended, whole file)", () => expectRange("bytes=0-", 0, SIZE - 1));
  it("range inside one chunk", () => expectRange("bytes=100-200", 100, 200));
  it("range across a chunk boundary", () => expectRange(`bytes=${CHUNK - 3}-${CHUNK + 5}`, CHUNK - 3, CHUNK + 5));
  it("range ending exactly on a chunk boundary", () => expectRange(`bytes=${CHUNK}-${2 * CHUNK - 1}`, CHUNK, 2 * CHUNK - 1));
  it("mid range spanning many chunks (multiple batches)", () => expectRange("bytes=1500-9000", 1500, 9000));
  it("open ended from the middle", () => expectRange("bytes=5000-", 5000, SIZE - 1));
  it("last byte", () => expectRange(`bytes=${SIZE - 1}-${SIZE - 1}`, SIZE - 1, SIZE - 1));
  it("suffix range", () => expectRange("bytes=-100", SIZE - 100, SIZE - 1));
  it("end beyond size is clamped", () => expectRange(`bytes=9000-99999`, 9000, SIZE - 1));

  it("no Range header returns 200 with the whole file", async () => {
    setup();
    const res = await handleStreamRequest(req(), "t1", deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE));
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    const out = await body(res);
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
  });

  it("invalid range returns 416 with Content-Range */size", async () => {
    setup();
    for (const r of [`bytes=${SIZE}-`, `bytes=${SIZE + 5}-${SIZE + 9}`, "bytes=20-10", "bytes=abc"]) {
      const res = await handleStreamRequest(req(r), "t1", deps);
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
    }
  });

  it("unknown track returns 404", async () => {
    setup();
    expect((await handleStreamRequest(req(), "nope", deps)).status).toBe(404);
  });

  it("fetches encrypted data in batches and caches the header", async () => {
    setup({ firstBatchChunks: 2, batchChunks: 3 });
    const res = await handleStreamRequest(req("bytes=0-"), "t1", deps);
    await body(res);
    // 1 header fetch + batches of 2,3,3,2 chunks
    expect(calls[0]).toEqual([0, HEADER_SIZE - 1]);
    expect(calls.length).toBe(1 + 4);
    expect(headerStore.get("t1")?.length).toBe(HEADER_SIZE);
    // second request uses the cached header (no header fetch)
    calls.length = 0;
    const res2 = await handleStreamRequest(req("bytes=0-10"), "t1", deps);
    await body(res2);
    expect(calls.every(([s]) => s >= HEADER_SIZE)).toBe(true);
  });

  it("cancelling the body aborts remaining fetches", async () => {
    setup({ firstBatchChunks: 1, batchChunks: 1 });
    const res = await handleStreamRequest(req("bytes=0-"), "t1", deps);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(aborted).toBe(true);
    const before = calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(before);
  });

  it("returns 502 when the upstream fails before the first byte", async () => {
    setup({
      fetchEnc: async () => {
        throw new Error("boom");
      },
    });
    const res = await handleStreamRequest(req("bytes=0-1"), "t1", deps);
    expect(res.status).toBe(502);
  });

  it("detects tampered ciphertext", async () => {
    const bad = enc.slice();
    bad[HEADER_SIZE + 5] = bad[HEADER_SIZE + 5]! ^ 1;
    setup({ fetchEnc: async (_t, s, e) => bad.slice(s, e + 1) });
    const res = await handleStreamRequest(req("bytes=0-10"), "t1", deps);
    expect(res.status).toBe(502);
  });
});

describe("createTokenRequester", () => {
  it("resolves once a newer token appears and dedupes concurrent calls", async () => {
    let tok = { accessToken: "old", expiresAt: Date.now() + 3_600_000 };
    let notified = 0;
    const request = createTokenRequester({
      getToken: async () => tok,
      notify: async () => {
        notified++;
        setTimeout(() => (tok = { accessToken: "new", expiresAt: Date.now() + 3_600_000 }), 20);
      },
      pollMs: 5,
      timeoutMs: 1000,
    });
    const [a, b] = await Promise.all([request("old"), request("old")]);
    expect(a?.accessToken).toBe("new");
    expect(b?.accessToken).toBe("new");
    expect(notified).toBe(1);
  });
});
