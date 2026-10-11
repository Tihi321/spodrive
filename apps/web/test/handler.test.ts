import { beforeAll, describe, expect, it } from "vitest";
import { handleStreamRequest, parseRangeHeader, type StreamDeps, type StreamTrack } from "../src/stream/handler";
import { createByteSource, createTokenRequester } from "../src/stream/sources";
import { OFFLINE_CACHE, cacheKeyUrl } from "../src/lib/urls";

const SIZE = 10_000 + 37;
const SCOPE = "https://example.test/app/";
let plain: Uint8Array;
let track: StreamTrack;
let calls: Array<[number, number]>;
let aborted: boolean;
let deps: StreamDeps;

beforeAll(() => {
  plain = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) plain[i] = (i * 31 + (i >> 8)) & 0xff;
  track = { id: "t1", driveFileId: "f1", size: SIZE, mime: "audio/mpeg" };
});

function setup(opts: Partial<StreamDeps> = {}) {
  calls = [];
  aborted = false;
  deps = {
    getTrack: async (id) => (id === "t1" ? track : undefined),
    fetchRange: async (_t, s, e, signal) => {
      calls.push([s, e]);
      signal.addEventListener("abort", () => (aborted = true));
      return plain.slice(s, e + 1);
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
  expect(calls).toEqual([[start, end]]);
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
  it("mid range", () => expectRange("bytes=1500-9000", 1500, 9000));
  it("open ended from the middle", () => expectRange("bytes=5000-", 5000, SIZE - 1));
  it("last byte", () => expectRange(`bytes=${SIZE - 1}-${SIZE - 1}`, SIZE - 1, SIZE - 1));
  it("suffix range", () => expectRange("bytes=-100", SIZE - 100, SIZE - 1));
  it("end beyond size is clamped", () => expectRange("bytes=9000-99999", 9000, SIZE - 1));

  it("no Range header returns 200 with the whole file", async () => {
    setup();
    const res = await handleStreamRequest(req(), "t1", deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE));
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(calls).toEqual([[0, SIZE - 1]]);
    expect(Buffer.from(await body(res)).equals(Buffer.from(plain))).toBe(true);
  });

  it("invalid range returns 416 with Content-Range */size and does not fetch", async () => {
    setup();
    for (const r of [`bytes=${SIZE}-`, `bytes=${SIZE + 5}-${SIZE + 9}`, "bytes=20-10", "bytes=abc"]) {
      const res = await handleStreamRequest(req(r), "t1", deps);
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
    }
    expect(calls).toEqual([]);
  });

  it("unknown track returns 404", async () => {
    setup();
    expect((await handleStreamRequest(req(), "nope", deps)).status).toBe(404);
  });

  it("passes a streamed upstream body through", async () => {
    setup({
      fetchRange: async (_t, s, e) =>
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(plain.slice(s, s + 10));
            c.enqueue(plain.slice(s + 10, e + 1));
            c.close();
          },
        }),
    });
    const res = await handleStreamRequest(req("bytes=100-299"), "t1", deps);
    expect(res.status).toBe(206);
    expect(Buffer.from(await body(res)).equals(Buffer.from(plain.subarray(100, 300)))).toBe(true);
  });

  it("aborts the upstream fetch when the request is aborted", async () => {
    setup();
    const ac = new AbortController();
    await handleStreamRequest({ headers: new Headers(), signal: ac.signal }, "t1", deps);
    ac.abort();
    expect(aborted).toBe(true);
  });

  it("returns 502 when the upstream fails", async () => {
    setup({
      fetchRange: async () => {
        throw new Error("boom");
      },
    });
    const res = await handleStreamRequest(req("bytes=0-1"), "t1", deps);
    expect(res.status).toBe(502);
  });
});

describe("createByteSource", () => {
  const driveRes = (status: number, start = 0, end = 0) =>
    status === 206
      ? new Response(plain.slice(start, end + 1), { status: 206 })
      : new Response(status === 200 ? plain.slice() : "", { status });

  function fakeCaches(blobs: Record<string, Blob>): CacheStorage {
    return {
      open: async (name: string) => ({
        match: async (url: string) => (name === OFFLINE_CACHE && blobs[url] ? new Response(blobs[url]) : undefined),
      }),
    } as unknown as CacheStorage;
  }
  const token = { accessToken: "tok", expiresAt: Date.now() + 3_600_000 };
  const bytesOf = async (out: Uint8Array | ReadableStream<Uint8Array>) =>
    out instanceof Uint8Array ? out : new Uint8Array(await new Response(out).arrayBuffer());

  it("serves from the local copy when its size matches (no Drive request)", async () => {
    let fetched = 0;
    const src = createByteSource({
      scope: SCOPE,
      getToken: async () => token,
      requestToken: async () => token,
      fetch: async () => (fetched++, driveRes(206)),
      caches: fakeCaches({ [cacheKeyUrl(SCOPE, "offline", "t1")]: new Blob([plain.slice()]) }),
    });
    const out = await bytesOf(await src.fetchRange(track, 100, 199, new AbortController().signal));
    expect(Buffer.from(out).equals(Buffer.from(plain.subarray(100, 200)))).toBe(true);
    expect(fetched).toBe(0);
  });

  it("ignores a local copy with the wrong size and asks Drive with the Range header", async () => {
    const seen: Array<{ url: string; range: string | null; auth: string | null }> = [];
    const src = createByteSource({
      scope: SCOPE,
      getToken: async () => token,
      requestToken: async () => token,
      fetch: async (url, init) => {
        const h = new Headers(init?.headers);
        seen.push({ url: String(url), range: h.get("Range"), auth: h.get("Authorization") });
        return driveRes(206, 5, 14);
      },
      caches: fakeCaches({ [cacheKeyUrl(SCOPE, "offline", "t1")]: new Blob([plain.slice(0, 50)]) }),
    });
    const out = await bytesOf(await src.fetchRange(track, 5, 14, new AbortController().signal));
    expect(Buffer.from(out).equals(Buffer.from(plain.subarray(5, 15)))).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toContain("/files/f1?alt=media");
    expect(seen[0]!.range).toBe("bytes=5-14");
    expect(seen[0]!.auth).toBe("Bearer tok");
  });

  it("401 -> asks for a fresh token and retries once", async () => {
    const used: string[] = [];
    const requested: Array<string | undefined> = [];
    const src = createByteSource({
      scope: SCOPE,
      getToken: async () => token,
      requestToken: async (stale) => {
        requested.push(stale);
        return { accessToken: "fresh", expiresAt: Date.now() + 3_600_000 };
      },
      fetch: async (_url, init) => {
        const auth = new Headers(init?.headers).get("Authorization")!;
        used.push(auth);
        return auth === "Bearer fresh" ? driveRes(206, 0, 9) : driveRes(401);
      },
      caches: fakeCaches({}),
    });
    const out = await bytesOf(await src.fetchRange(track, 0, 9, new AbortController().signal));
    expect(out.length).toBe(10);
    expect(used).toEqual(["Bearer tok", "Bearer fresh"]);
    expect(requested).toEqual(["tok"]);
  });

  it("slices the range when Drive ignores it and answers 200", async () => {
    const src = createByteSource({
      scope: SCOPE,
      getToken: async () => token,
      requestToken: async () => token,
      fetch: async () => driveRes(200),
      caches: fakeCaches({}),
    });
    const out = await bytesOf(await src.fetchRange(track, 20, 29, new AbortController().signal));
    expect(Buffer.from(out).equals(Buffer.from(plain.subarray(20, 30)))).toBe(true);
  });

  it("throws when Drive refuses", async () => {
    const src = createByteSource({
      scope: SCOPE,
      getToken: async () => token,
      requestToken: async () => token,
      fetch: async () => driveRes(403),
      caches: fakeCaches({}),
    });
    await expect(src.fetchRange(track, 0, 9, new AbortController().signal)).rejects.toThrow(/403/);
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
