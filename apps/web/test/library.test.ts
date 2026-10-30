import { describe, expect, it } from "vitest";
import type { Track } from "@spodrive/core";
import { buildIndex, fold, formatDuration, searchLibrary } from "../src/lib/library-index";

let n = 0;
function track(p: Partial<Track>): Track {
  n++;
  return {
    id: `t${n}`,
    driveFileId: `d${n}`,
    title: `Title ${n}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "",
    durationSec: 100,
    sourceId: "s1",
    size: 1000,
    mime: "audio/mpeg",
    md5: "m" + n,
    hasCover: false,
    addedAt: "2024-01-01T00:00:00Z",
    ...p,
  };
}

const tracks: Track[] = [
  track({ id: "a2", title: "Faint", artist: "Linkin Park", album: "Meteora", trackNo: 7, year: 2003, hasCover: true }),
  track({ id: "a1", title: "Foreword", artist: "Linkin Park", album: "Meteora", trackNo: 1, year: 2003 }),
  track({ id: "b2", title: "In The End", artist: "Linkin Park", album: "Hybrid Theory", trackNo: 8, year: 2000 }),
  track({ id: "b1", title: "Papercut", artist: "Linkin Park", album: "Hybrid Theory", trackNo: 1, year: 2000 }),
  track({ id: "c1", title: "Café Song", artist: "Zoë", album: "Singles" }),
  track({ id: "d2", title: "Disc two", artist: "Band", album: "Double", discNo: 2, trackNo: 1 }),
  track({ id: "d1", title: "Disc one", artist: "Band", album: "Double", discNo: 1, trackNo: 5 }),
  track({ id: "f1", title: "Feat", artist: "Guest", albumArtist: "Linkin Park", album: "Meteora", trackNo: 3 }),
];

describe("buildIndex", () => {
  const idx = buildIndex(tracks);

  it("groups albums by albumArtist+album and sorts by disc/track", () => {
    const meteora = idx.albums.find((a) => a.title === "Meteora")!;
    expect(meteora.artist).toBe("Linkin Park");
    expect(meteora.trackIds).toEqual(["a1", "f1", "a2"]);
    expect(meteora.year).toBe(2003);
    expect(meteora.coverTrackId).toBe("a2");
    expect(meteora.durationSec).toBe(300);
    const dbl = idx.albums.find((a) => a.title === "Double")!;
    expect(dbl.trackIds).toEqual(["d1", "d2"]);
  });

  it("builds artists with album count", () => {
    const lp = idx.artists.find((a) => a.name === "Linkin Park")!;
    expect(lp.albumIds).toHaveLength(2);
    expect(lp.trackIds).toHaveLength(5);
    expect(idx.artists.map((a) => a.name)).toEqual(["Band", "Linkin Park", "Zoë"]);
  });

  it("indexes by id and orders songs by title", () => {
    expect(idx.byId.get("b2")?.title).toBe("In The End");
    expect(idx.tracks[0]!.title).toBe("Café Song");
    expect(idx.albumById.get(idx.albums[0]!.id)).toBe(idx.albums[0]);
  });

  it("merges case/diacritic variants of the same album", () => {
    const i = buildIndex([track({ artist: "X", album: "Café" }), track({ artist: "x", album: "CAFE" })]);
    expect(i.albums).toHaveLength(1);
    expect(i.artists).toHaveLength(1);
  });

  it("handles missing album and artist", () => {
    const i = buildIndex([track({ artist: "", album: "", albumArtist: "" })]);
    expect(i.albums[0]!.title).toBe("Unknown Album");
    expect(i.artists[0]!.name).toBe("Unknown Artist");
  });
});

describe("searchLibrary", () => {
  const idx = buildIndex(tracks);
  it("empty query returns nothing", () => {
    expect(searchLibrary(idx, "  ").tracks).toEqual([]);
  });
  it("matches title, artist and album, ignoring case and diacritics", () => {
    expect(searchLibrary(idx, "in the end").tracks.map((t) => t.id)).toEqual(["b2"]);
    expect(searchLibrary(idx, "cafe").tracks.map((t) => t.id)).toEqual(["c1"]);
    expect(searchLibrary(idx, "zoe").artists.map((a) => a.name)).toEqual(["Zoë"]);
    expect(searchLibrary(idx, "hybrid").albums.map((a) => a.title)).toEqual(["Hybrid Theory"]);
    expect(searchLibrary(idx, "linkin").tracks).toHaveLength(5);
  });
  it("requires every token to match", () => {
    expect(searchLibrary(idx, "linkin faint").tracks.map((t) => t.id)).toEqual(["a2"]);
    expect(searchLibrary(idx, "linkin nonsense").tracks).toEqual([]);
  });
  it("ranks prefix matches first", () => {
    const i = buildIndex([track({ id: "x1", title: "Stranger in Town" }), track({ id: "x2", title: "In Town" })]);
    expect(searchLibrary(i, "in town").tracks[0]!.id).toBe("x2");
  });
});

describe("helpers", () => {
  it("fold", () => expect(fold("  ÉCOLE  Été ")).toBe("ecole ete"));
  it("formatDuration", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(NaN)).toBe("0:00");
  });
});

describe("buildIndex folders", () => {
  it("groups by the folder a song sits in, skipping songs without one", () => {
    const idx = buildIndex([
      track({ id: "k2", title: "Two", trackNo: 2, folderId: "K", folderPath: ["Music", "Kids"], hasCover: true }),
      track({ id: "k1", title: "One", trackNo: 1, folderId: "K", folderPath: ["Kids"] }),
      track({ id: "r1", title: "Rock", folderId: "R", folderPath: ["Music", "Rock"] }),
      track({ id: "a1", title: "Abba", folderId: "A", folderPath: ["Abba"] }),
      track({ id: "x", title: "Loose" }),
    ]);
    expect(idx.folders.map((f) => [f.id, f.name, f.parents, f.trackIds])).toEqual([
      ["A", "Abba", [], ["a1"]],
      ["K", "Kids", ["Music"], ["k1", "k2"]],
      ["R", "Rock", ["Music"], ["r1"]],
    ]);
    expect(idx.folderById.get("K")!.coverTrackId).toBe("k2");
    expect(idx.folderById.get("K")!.durationSec).toBe(200);
  });
});
