import { describe, expect, it } from "vitest";
import { activeLineIndex, emptyPlaylists, mergePlaylists, parseLrc, type Playlist } from "../src/index";

describe("mergePlaylists", () => {
  const pl = (id: string, name: string, updatedAt: string, extra: Partial<Playlist> = {}): Playlist => ({
    id,
    name,
    trackIds: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt,
    ...extra,
  });
  it("last write wins per playlist, keeps tombstones and union", () => {
    const a = { ...emptyPlaylists("2024-01-02T00:00:00.000Z"), playlists: [pl("1", "old", "2024-01-01T00:00:00.000Z"), pl("2", "only-a", "2024-01-01T00:00:00.000Z")] };
    const b = {
      ...emptyPlaylists("2024-01-05T00:00:00.000Z"),
      playlists: [pl("1", "new", "2024-01-03T00:00:00.000Z"), pl("3", "gone", "2024-01-04T00:00:00.000Z", { deleted: true })],
    };
    const m = mergePlaylists(a, b);
    expect(m.playlists.find((p) => p.id === "1")!.name).toBe("new");
    expect(m.playlists.find((p) => p.id === "2")).toBeTruthy();
    expect(m.playlists.find((p) => p.id === "3")!.deleted).toBe(true);
    expect(m.updatedAt).toBe("2024-01-05T00:00:00.000Z");
    const m2 = mergePlaylists(b, a);
    expect(m2.playlists.find((p) => p.id === "1")!.name).toBe("new");
  });
});

describe("LRC", () => {
  it("parses formats, multi timestamps, sorting, metadata", () => {
    const lines = parseLrc(
      ["[ar:Artist]", "[ti:Title]", "[00:12.34]Second", "[00:01.5][00:30]Chorus", "[01:02.345] Third ", "[00:05]Five", "junk"].join("\n"),
    );
    expect(lines).toEqual([
      { timeMs: 1500, text: "Chorus" },
      { timeMs: 5000, text: "Five" },
      { timeMs: 12340, text: "Second" },
      { timeMs: 30000, text: "Chorus" },
      { timeMs: 62345, text: "Third" },
    ]);
  });
  it("applies offset and handles CRLF", () => {
    const lines = parseLrc("[offset:+500]\r\n[00:01.00]A\r\n[00:00.20]B");
    expect(lines).toEqual([
      { timeMs: 0, text: "B" },
      { timeMs: 500, text: "A" },
    ]);
  });
  it("activeLineIndex binary search", () => {
    const l = parseLrc("[00:01.00]a\n[00:02.00]b\n[00:03.00]c");
    expect(activeLineIndex(l, 0)).toBe(-1);
    expect(activeLineIndex(l, 1000)).toBe(0);
    expect(activeLineIndex(l, 2999)).toBe(1);
    expect(activeLineIndex(l, 99999)).toBe(2);
    expect(activeLineIndex([], 5)).toBe(-1);
  });
});
