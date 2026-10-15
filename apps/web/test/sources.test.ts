import { describe, expect, it } from "vitest";
import { emptyLibrary, type Library, type Track } from "@spodrive/core";
import type { DriveFile } from "../src/lib/drive";
import {
  FOLDER_MIME,
  addPicked,
  adoptTracks,
  diffSource,
  expandFolder,
  mergeTracks,
  relocateTracks,
  removeSource,
  rescanSources,
  scanFiles,
  toFound,
  type FoundFile,
  type ScanDeps,
} from "../src/lib/sources";
import { audioMimeOf, mapTags } from "../src/lib/tags";

const file = (id: string, name: string, extra: Partial<DriveFile> = {}): DriveFile => ({
  id,
  name,
  mimeType: "audio/mpeg",
  size: "1000",
  md5Checksum: "md5-" + id,
  ...extra,
});
const folder = (id: string, name: string): DriveFile => ({ id, name, mimeType: FOLDER_MIME });

/** Fake Drive: folder id -> children. */
function fakeDeps(tree: Record<string, DriveFile[]>, over: Partial<ScanDeps> = {}): ScanDeps & { listed: string[]; covers: string[] } {
  const listed: string[] = [];
  const covers: string[] = [];
  return {
    listed,
    covers,
    now: () => "2024-01-01T00:00:00.000Z",
    async listChildren(id) {
      listed.push(id);
      const c = tree[id];
      if (!c) throw new Error("404");
      return c;
    },
    async getMeta(id) {
      for (const list of Object.values(tree)) {
        const f = list.find((x) => x.id === id);
        if (f) return f;
      }
      throw new Error("404");
    },
    async read(f) {
      const tags = f.name.startsWith("tagged") ? { title: "T-" + f.id, artist: "A", album: "B", duration: 12.3456 } : {};
      return { meta: mapTags(f.name, f.parentName, tags) };
    },
    async saveCover(id) {
      covers.push(id);
    },
    ...over,
  };
}

const track = (id: string, sourceId: string, md5 = "md5-" + id): Track => ({
  id,
  driveFileId: id,
  sourceId,
  title: id,
  artist: "A",
  album: "B",
  albumArtist: "A",
  durationSec: 0,
  size: 1000,
  mime: "audio/mpeg",
  md5,
  hasCover: false,
  addedAt: "2024-01-01T00:00:00.000Z",
});
const lib = (tracks: Track[], sources: Library["sources"] = []): Library => ({ ...emptyLibrary("2024-01-01T00:00:00.000Z"), tracks, sources });

describe("mapTags", () => {
  it("uses tags when present and rounds duration", () => {
    const m = mapTags("x.mp3", "Folder", {
      title: " Song ",
      artist: "Me",
      album: "Alb",
      albumartist: "Band",
      track: { no: 3 },
      disk: { no: 0 },
      year: 1999,
      duration: 61.23456,
    });
    expect(m).toEqual({ title: "Song", artist: "Me", album: "Alb", albumArtist: "Band", durationSec: 61.235, trackNo: 3, year: 1999 });
  });
  it("falls back to file name, parent folder and Unknown Artist", () => {
    expect(mapTags("01 - Intro.final.mp3", "My Album", {})).toEqual({
      title: "01 - Intro.final",
      artist: "Unknown Artist",
      album: "My Album",
      albumArtist: "Unknown Artist",
      durationSec: 0,
    });
    expect(mapTags("noext", undefined, { artist: "  " }).album).toBe("Unknown Album");
    expect(mapTags("a.mp3", "F", { artist: "Z" }).albumArtist).toBe("Z");
  });
});

describe("audioMimeOf / toFound", () => {
  it("accepts audio mimes and known extensions, rejects the rest", () => {
    expect(audioMimeOf("a.mp3", "audio/mpeg")).toBe("audio/mpeg");
    expect(audioMimeOf("a.M4A", "application/octet-stream")).toBe("audio/mp4");
    expect(audioMimeOf("a.m4a", "audio/x-m4a")).toBe("audio/mp4");
    expect(audioMimeOf("a.jpg", "image/jpeg")).toBeNull();
  });
  it("skips trashed files, folders and empty files", () => {
    expect(toFound(file("1", "a.mp3", { trashed: true }))).toBeNull();
    expect(toFound(folder("2", "d"))).toBeNull();
    expect(toFound(file("3", "a.mp3", { size: "0" }))).toBeNull();
    expect(toFound(file("4", "a.mp3"), { id: "P", path: ["Root", "Par"] })).toMatchObject({
      id: "4",
      size: 1000,
      md5: "md5-4",
      parentName: "Par",
      folderId: "P",
      folderPath: ["Root", "Par"],
    });
    expect(toFound(file("5", "a.mp3"))).not.toHaveProperty("folderId");
  });
});

describe("expandFolder", () => {
  it("lists recursively with parent folder names, skipping non-audio and unreadable subfolders", async () => {
    const deps = fakeDeps({
      root: [file("b", "b.mp3"), folder("sub", "Sub"), folder("bad", "Bad"), file("img", "c.jpg", { mimeType: "image/jpeg" }), file("a", "a.mp3")],
      sub: [file("c", "c.mp3"), folder("root", "Loop")], // cycles are ignored
    });
    const found = await expandFolder({ id: "root", name: "Root" }, deps.listChildren);
    expect(found.map((f) => [f.id, f.parentName, f.folderId, f.folderPath])).toEqual([
      ["a", "Root", "root", ["Root"]],
      ["b", "Root", "root", ["Root"]],
      ["c", "Sub", "sub", ["Root", "Sub"]],
    ]);
  });
  it("propagates an error of the picked folder itself", async () => {
    const deps = fakeDeps({});
    await expect(expandFolder({ id: "nope", name: "X" }, deps.listChildren)).rejects.toThrow("404");
  });
});

describe("diffSource / mergeTracks / removeSource", () => {
  const found = (id: string, md5 = "md5-" + id): FoundFile => ({ id, name: id + ".mp3", mime: "audio/mpeg", size: 1000, md5 });
  it("dedupes by md5, detects changes and removals", () => {
    const tracks = [track("a", "s1"), track("b", "s1"), track("c", "s2")];
    const d = diffSource(tracks, "s1", [found("a"), found("b", "other"), found("d"), found("c")]);
    expect(d.added.map((f) => f.id)).toEqual(["d"]);
    expect(d.changed.map((f) => f.id)).toEqual(["b"]);
    expect(d.removedIds).toEqual([]);
    expect(diffSource(tracks, "s1", [found("a")]).removedIds).toEqual(["b"]);
  });
  it("detects files that sit in another folder without re-reading them", () => {
    const tracks = [{ ...track("a", "s1"), folderId: "F1", folderPath: ["F1"] }, track("b", "s1"), track("c", "s1")];
    const d = diffSource(tracks, "s1", [
      { ...found("a"), folderId: "F2", folderPath: ["Top", "F2"] },
      { ...found("b"), folderId: "F1", folderPath: ["F1"] },
      found("c"), // folder unknown: nothing to record
    ]);
    expect(d.moved.map((f) => f.id)).toEqual(["a", "b"]);
    expect(d.added.length + d.changed.length).toBe(0);
    const l = relocateTracks(lib(tracks), d.moved);
    expect(l.tracks.map((t) => [t.id, t.folderId, t.folderPath])).toEqual([
      ["a", "F2", ["Top", "F2"]],
      ["b", "F1", ["F1"]],
      ["c", undefined, undefined],
    ]);
  });
  it("merge keeps the recorded folder when the new read does not know it", () => {
    const old = { ...track("a", "s1"), folderId: "F", folderPath: ["F"] };
    expect(mergeTracks(lib([old]), [{ ...track("a", "s1"), title: "new" }]).tracks[0]).toMatchObject({ title: "new", folderId: "F" });
  });
  it("adoptTracks moves loose-pick tracks into a folder source and drops emptied pick sources", () => {
    const start = lib(
      [track("a", "pick"), track("b", "pick"), track("c", "other")],
      [
        { id: "pick", kind: "file", name: "a.mp3", addedAt: "" },
        { id: "other", kind: "folder", name: "Other", addedAt: "" },
      ],
    );
    const half = adoptTracks(start, "F", ["a"]);
    expect(half.tracks.map((t) => t.sourceId)).toEqual(["F", "pick", "other"]);
    expect(half.sources.map((s) => s.id)).toEqual(["pick", "other"]);
    const all = adoptTracks(start, "F", ["a", "b", "c"]);
    expect(all.tracks.map((t) => t.sourceId)).toEqual(["F", "F", "other"]); // other folders keep theirs
    expect(all.sources.map((s) => s.id)).toEqual(["other"]);
  });
  it("merge replaces by id and appends new tracks", () => {
    const l = mergeTracks(lib([track("a", "s1"), track("b", "s1")]), [{ ...track("b", "s1"), title: "new" }, track("z", "s1")]);
    expect(l.tracks.map((t) => [t.id, t.title])).toEqual([
      ["a", "a"],
      ["b", "new"],
      ["z", "z"],
    ]);
  });
  it("removing a source prunes only its tracks", () => {
    const l = lib(
      [track("a", "s1"), track("b", "s2")],
      [
        { id: "s1", kind: "folder", name: "F", addedAt: "" },
        { id: "s2", kind: "file", name: "b.mp3", addedAt: "" },
      ],
    );
    const r = removeSource(l, "s1");
    expect(r.removedIds).toEqual(["a"]);
    expect(r.library.tracks.map((t) => t.id)).toEqual(["b"]);
    expect(r.library.sources.map((s) => s.id)).toEqual(["s2"]);
  });
});

describe("scanFiles", () => {
  it("reads with bounded concurrency, keeps order, saves covers and counts failures", async () => {
    let active = 0;
    let peak = 0;
    const files: FoundFile[] = Array.from({ length: 10 }, (_, i) => ({ id: "f" + i, name: `f${i}.mp3`, mime: "audio/mpeg", size: 1000, md5: "m" + i }));
    const deps = fakeDeps(
      {},
      {
        async read(f) {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          if (f.id === "f7") throw new Error("403");
          return { meta: mapTags(f.name, undefined, {}), cover: f.id === "f3" ? { data: new Uint8Array([1]), mime: "image/png" } : undefined };
        },
      },
    );
    const seen: number[] = [];
    const r = await scanFiles(files, "s1", deps, (p) => seen.push(p.done));
    expect(peak).toBeLessThanOrEqual(4);
    expect(r.failed).toBe(1);
    expect(r.tracks.map((t) => t.id)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f8", "f9"]);
    expect(r.tracks.find((t) => t.id === "f3")!.hasCover).toBe(true);
    expect(deps.covers).toEqual(["f3"]);
    expect(seen[seen.length - 1]).toBe(10);
  });
});

describe("addPicked / rescanSources", () => {
  it("adds a folder as a source, and reports folders without readable audio", async () => {
    const deps = fakeDeps({ F: [file("a", "tagged1.mp3"), file("b", "b.mp3")], E: [] });
    const r = await addPicked(
      lib([]),
      [
        { id: "F", name: "Music", mimeType: FOLDER_MIME },
        { id: "E", name: "Empty", mimeType: FOLDER_MIME },
        { id: "x", name: "gone", mimeType: FOLDER_MIME },
      ],
      deps,
    );
    expect(r.added).toBe(2);
    expect(r.emptyFolders).toEqual(["Empty", "gone"]);
    expect(r.library.sources).toEqual([{ id: "F", kind: "folder", name: "Music", addedAt: "2024-01-01T00:00:00.000Z" }]);
    expect(r.library.tracks.map((t) => [t.title, t.album, t.sourceId])).toEqual([
      ["b", "Music", "F"],
      ["T-a", "B", "F"],
    ]);
  });
  it("loose picked files form ONE source; re-picking unchanged files adds no source", async () => {
    const deps = fakeDeps({ root: [file("a", "a.mp3"), file("b", "b.mp3"), file("c", "c.mp3")] });
    const docs = ["a", "b", "c"].map((id) => ({ id, name: id + ".mp3", mimeType: "audio/mpeg" }));
    const first = await addPicked(lib([]), docs, deps);
    expect(first.added).toBe(3);
    expect(first.library.sources).toHaveLength(1);
    const src = first.library.sources[0]!;
    expect(src).toMatchObject({ kind: "file", name: "a.mp3 and 2 more" });
    expect(src.id.startsWith("pick_")).toBe(true);
    expect(first.library.tracks.every((t) => t.sourceId === src.id)).toBe(true);
    let reads = 0;
    const again = await addPicked(first.library, docs, { ...deps, read: async (f) => (reads++, deps.read(f)) });
    expect(reads).toBe(0);
    expect(again.library.tracks).toHaveLength(3);
    expect(again.library.sources).toHaveLength(1);
  });
  it("a new folder takes over its songs from loose picks, and records their folder", async () => {
    const deps = fakeDeps({ F: [file("a", "a.mp3")] });
    const start = lib([track("a", "pick")], [{ id: "pick", kind: "file", name: "a.mp3", addedAt: "" }]);
    let reads = 0;
    const r = await addPicked(start, [{ id: "F", name: "Kids", mimeType: FOLDER_MIME }], { ...deps, read: async (f) => (reads++, deps.read(f)) });
    expect(reads).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.library.sources.map((s) => s.id)).toEqual(["F"]);
    expect(r.library.tracks[0]).toMatchObject({ sourceId: "F", folderId: "F", folderPath: ["Kids"] });
  });
  it("a new folder whose files all belong to other folders is not added as a source", async () => {
    const deps = fakeDeps({ F: [file("a", "a.mp3")] });
    const start = lib([track("a", "other")], [{ id: "other", kind: "folder", name: "Other", addedAt: "" }]);
    const r = await addPicked(start, [{ id: "F", name: "F", mimeType: FOLDER_MIME }], deps);
    expect(r.library.sources.map((s) => s.id)).toEqual(["other"]);
  });
  it("loose picked files record their folder when Spodrive may read it", async () => {
    const deps = fakeDeps({
      top: [folder("P", "Kids")],
      P: [file("a", "a.mp3", { parents: ["P"] }), file("b", "b.mp3", { parents: ["P"] })],
      hidden: [file("c", "c.mp3", { parents: ["secret"] })],
    });
    const docs = ["a", "b", "c"].map((id) => ({ id, name: id + ".mp3", mimeType: "audio/mpeg" }));
    const r = await addPicked(lib([]), docs, deps);
    expect(r.library.tracks.map((t) => [t.id, t.folderId, t.folderPath, t.album])).toEqual([
      ["a", "P", ["Kids"], "Kids"],
      ["b", "P", ["Kids"], "Kids"],
      ["c", undefined, undefined, "Unknown Album"],
    ]);
  });
  it("a changed file keeps its addedAt and source", async () => {
    const old = { ...track("a", "F", "old"), addedAt: "2020-02-02T00:00:00.000Z" };
    const deps = fakeDeps({ F: [file("a", "a.mp3", { md5Checksum: "new" })] });
    const start = lib([old], [{ id: "F", kind: "folder", name: "F", addedAt: "" }]);
    const rs = await rescanSources(start, ["F"], deps);
    expect(rs.library.tracks[0]).toMatchObject({ md5: "new", addedAt: "2020-02-02T00:00:00.000Z", sourceId: "F" });
    const rp = await addPicked(start, [{ id: "a", name: "a.mp3", mimeType: "audio/mpeg" }], deps);
    expect(rp.library.tracks[0]).toMatchObject({ md5: "new", addedAt: "2020-02-02T00:00:00.000Z", sourceId: "F" });
    expect(rp.library.sources.map((s) => s.id)).toEqual(["F"]);
  });
  it("rescan adds new files, re-reads changed ones and drops removed ones (folders only)", async () => {
    const tree = { F: [file("a", "a.mp3"), file("b", "b.mp3", { md5Checksum: "changed" }), file("n", "n.mp3")] };
    const deps = fakeDeps(tree);
    const start = lib(
      [track("a", "F"), track("b", "F", "old"), track("gone", "F"), track("solo", "S")],
      [
        { id: "F", kind: "folder", name: "F", addedAt: "" },
        { id: "S", kind: "file", name: "solo", addedAt: "" },
      ],
    );
    const r = await rescanSources(start, ["F", "S"], deps);
    expect(r.added).toBe(2);
    expect(r.removedIds).toEqual(["gone"]);
    expect(r.library.tracks.map((t) => t.id).sort()).toEqual(["a", "b", "n", "solo"]);
    expect(r.library.tracks.find((t) => t.id === "b")!.md5).toBe("changed");
    expect(deps.listed).toEqual(["F"]);
  });
  it("rescan goes all the way down and finds songs added to subfolders later", async () => {
    const tree: Record<string, DriveFile[]> = { F: [folder("K", "Kids")], K: [file("a", "a.mp3")] };
    const deps = fakeDeps(tree);
    const first = await addPicked(lib([]), [{ id: "F", name: "Music", mimeType: FOLDER_MIME }], deps);
    tree.K = [...tree.K!, folder("D", "Deep")];
    tree.D = [file("n", "n.mp3")];
    const r = await rescanSources(first.library, ["F"], deps);
    expect(r.added).toBe(1);
    expect(r.library.tracks.find((t) => t.id === "n")).toMatchObject({ sourceId: "F", folderId: "D", folderPath: ["Music", "Kids", "Deep"] });
  });
  it("rescan keeps tracks when the folder cannot be listed", async () => {
    const start = lib([track("a", "F")], [{ id: "F", kind: "folder", name: "F", addedAt: "" }]);
    const r = await rescanSources(start, ["F"], fakeDeps({}));
    expect(r.library.tracks).toHaveLength(1);
    expect(r.failed).toBe(1);
  });
});
