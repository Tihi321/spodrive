import { describe, expect, it, vi } from "vitest";
import { pickBestMatch, type LrclibItem } from "../src/lib/lyrics-match";
import { fetchLyricsFor, type LyricsCacheEntry, type LyricsStore } from "../src/lib/lyrics-fetch";

const synced = "[00:01.00] one\n[00:02.50] two";

describe("pickBestMatch", () => {
  it("prefers synced lyrics among similar durations", () => {
    const items: LrclibItem[] = [
      { id: 1, duration: 200, plainLyrics: "plain" },
      { id: 2, duration: 201, syncedLyrics: synced },
    ];
    expect(pickBestMatch(items, 200)?.id).toBe(2);
  });
  it("prefers a clearly closer duration over synced-ness", () => {
    const items: LrclibItem[] = [
      { id: 1, duration: 200, plainLyrics: "plain" },
      { id: 2, duration: 207, syncedLyrics: synced },
    ];
    expect(pickBestMatch(items, 200)?.id).toBe(1);
  });
  it("rejects results with a very different duration", () => {
    expect(pickBestMatch([{ id: 1, duration: 320, syncedLyrics: synced }], 200)).toBeNull();
  });
  it("skips instrumental and empty entries", () => {
    expect(
      pickBestMatch([{ id: 1, duration: 200, instrumental: true }, { id: 2, duration: 200, plainLyrics: "  " }], 200),
    ).toBeNull();
  });
  it("accepts anything when our duration is unknown", () => {
    expect(pickBestMatch([{ id: 3, duration: 999, plainLyrics: "x" }], 0)?.id).toBe(3);
  });
  it("picks smallest delta on equal synced-ness", () => {
    const items: LrclibItem[] = [
      { id: 1, duration: 204, syncedLyrics: synced },
      { id: 2, duration: 201, syncedLyrics: synced },
    ];
    expect(pickBestMatch(items, 200)?.id).toBe(2);
  });
});

function memStore(): LyricsStore & { map: Map<string, LyricsCacheEntry> } {
  const map = new Map<string, LyricsCacheEntry>();
  return { map, get: async (k) => map.get(k), put: async (k, v) => void map.set(k, v) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const trk = { id: "t", title: "Song", artist: "Art", album: "Alb", durationSec: 200.4 };

describe("fetchLyricsFor", () => {
  it("uses /api/get with rounded duration and no custom headers", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => json({ duration: 200, syncedLyrics: synced, plainLyrics: "x" }));
    const store = memStore();
    const r = await fetchLyricsFor(trk, { fetchImpl: fetchImpl as unknown as typeof fetch, store });
    expect(r.synced).toEqual([
      { timeMs: 1000, text: "one" },
      { timeMs: 2500, text: "two" },
    ]);
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.pathname).toBe("/api/get");
    expect(url.searchParams.get("duration")).toBe("200");
    expect(url.searchParams.get("track_name")).toBe("Song");
    expect(fetchImpl.mock.calls[0]![1]?.headers).toBeUndefined();
    expect(store.map.get("t")?.status).toBe("found");
  });

  it("falls back to /api/search on 404 and picks the best match", async () => {
    const fetchImpl = vi.fn(async (u: string) => {
      if (u.includes("/api/get")) return json({}, 404);
      return json([
        { id: 1, duration: 260, syncedLyrics: synced },
        { id: 2, duration: 199, plainLyrics: "just text" },
      ]);
    });
    const r = await fetchLyricsFor(trk, { fetchImpl: fetchImpl as unknown as typeof fetch, store: memStore() });
    expect(r.synced).toBeNull();
    expect(r.plain).toBe("just text");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches not-found and retries after 7 days", async () => {
    const fetchImpl = vi.fn(async (u: string) => (u.includes("/api/get") ? json({}, 404) : json([])));
    const store = memStore();
    let now = 1_000_000;
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, store, now: () => now };
    expect((await fetchLyricsFor(trk, deps)).synced).toBeNull();
    const calls = fetchImpl.mock.calls.length;
    await fetchLyricsFor(trk, deps);
    expect(fetchImpl.mock.calls.length).toBe(calls); // served from cache
    now += 8 * 24 * 3600 * 1000;
    await fetchLyricsFor(trk, deps);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it("does not cache network failures", async () => {
    const store = memStore();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const r = await fetchLyricsFor(trk, { fetchImpl: fetchImpl as unknown as typeof fetch, store });
    expect(r).toEqual({ synced: null, plain: null });
    expect(store.map.size).toBe(0);
  });

  it("does not hit the network when disabled", async () => {
    const fetchImpl = vi.fn();
    const r = await fetchLyricsFor(trk, { fetchImpl: fetchImpl as unknown as typeof fetch, store: memStore(), enabled: false });
    expect(r).toEqual({ synced: null, plain: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("user lyrics", () => {
    const userSrc = (mtime: string | null | undefined, text = "[00:05.00] mine") => ({
      modifiedTime: () => mtime,
      download: vi.fn(async () => text),
    });
    const noNet = () => vi.fn(async () => json({}, 404)) as unknown as typeof fetch;

    it("wins over lrclib without calling it", async () => {
      const fetchImpl = noNet();
      const store = memStore();
      const r = await fetchLyricsFor(trk, { fetchImpl, store, user: userSrc("m1") });
      expect(r.synced).toEqual([{ timeMs: 5000, text: "mine" }]);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.map.get("t")).toMatchObject({ status: "found", source: "user", modifiedTime: "m1" });
    });

    it("wins over a cached lrclib found/missing entry", async () => {
      for (const cached of [
        { status: "missing", fetchedAt: 1_000 },
        { status: "found", fetchedAt: 1_000, plain: "from lrclib" },
      ] as LyricsCacheEntry[]) {
        const store = memStore();
        store.map.set("t", cached);
        const r = await fetchLyricsFor(trk, { fetchImpl: noNet(), store, now: () => 2_000, user: userSrc("m1") });
        expect(r.synced?.[0]?.text).toBe("mine");
      }
    });

    it("shows plain user text as unsynced lyrics", async () => {
      const r = await fetchLyricsFor(trk, { fetchImpl: noNet(), store: memStore(), user: userSrc("m1", "just words") });
      expect(r).toEqual({ synced: null, plain: "just words" });
    });

    it("downloads again only when modifiedTime changes", async () => {
      const store = memStore();
      const user = userSrc("m1");
      const deps = { fetchImpl: noNet(), store, user };
      await fetchLyricsFor(trk, deps);
      await fetchLyricsFor(trk, deps);
      expect(user.download).toHaveBeenCalledTimes(1);
      await fetchLyricsFor(trk, { ...deps, user: { ...user, modifiedTime: () => "m2" } });
      expect(user.download).toHaveBeenCalledTimes(2);
      expect(store.map.get("t")?.modifiedTime).toBe("m2");
    });

    it("keeps the cached user lyrics when the download fails or the index is not loaded", async () => {
      const store = memStore();
      await fetchLyricsFor(trk, { fetchImpl: noNet(), store, user: userSrc("m1") });
      const failing = { modifiedTime: () => "m2", download: async () => Promise.reject(new TypeError("offline")) };
      expect((await fetchLyricsFor(trk, { fetchImpl: noNet(), store, user: failing })).synced?.[0]?.text).toBe("mine");
      expect((await fetchLyricsFor(trk, { fetchImpl: noNet(), store, user: userSrc(undefined) })).synced?.[0]?.text).toBe("mine");
    });

    it("falls back to lrclib once the user file is gone", async () => {
      const store = memStore();
      await fetchLyricsFor(trk, { fetchImpl: noNet(), store, user: userSrc("m1") });
      const fetchImpl = vi.fn(async () => json({ duration: 200, plainLyrics: "from lrclib" }));
      const r = await fetchLyricsFor(trk, { fetchImpl: fetchImpl as unknown as typeof fetch, store, user: userSrc(null) });
      expect(r.plain).toBe("from lrclib");
      expect(store.map.get("t")?.source).toBeUndefined();
    });
  });
});
