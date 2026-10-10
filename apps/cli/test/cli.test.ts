import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptFile, fromBase64, openBlob, importContentKeyB64 } from "@spodrive/core";
import { findAudioFiles, mapTags, readMetadata } from "../src/scan.js";
import { runAdd } from "../src/commands/add.js";
import { formatList, matchTracks, removeTracks, verifyTracks } from "../src/commands/library.js";
import { LocalStore } from "../src/store.js";
import { openSession } from "../src/vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "../../../.claude/temp/cli-test-" + process.pid);
const PASS = "correct horse";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

beforeAll(async () => {
  process.env.SPODRIVE_PASSPHRASE = PASS;
  process.env.SPODRIVE_KDF_ITERATIONS = "1000";
  await fs.mkdir(path.join(work, "in", "sub"), { recursive: true });
});
afterAll(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe("scan", () => {
  it("falls back to filename / Unknown values", () => {
    const m = mapTags("/music/My Song.FLAC", {});
    expect(m).toEqual({
      title: "My Song",
      artist: "Unknown Artist",
      album: "Unknown Album",
      albumArtist: "Unknown Artist",
      durationSec: 0,
      mime: "audio/flac",
    });
  });

  it("maps tags, albumArtist defaults to artist, zero numbers dropped", () => {
    const m = mapTags("a.mp3", {
      title: " In The End ",
      artist: "Linkin Park",
      album: "Hybrid Theory",
      track: { no: 8 },
      disk: { no: 0 },
      year: 2000,
      duration: 216.2345,
    });
    expect(m).toMatchObject({
      title: "In The End",
      artist: "Linkin Park",
      albumArtist: "Linkin Park",
      trackNo: 8,
      year: 2000,
      mime: "audio/mpeg",
      durationSec: 216.235,
    });
    expect(m.discNo).toBeUndefined();
    expect(mapTags("a.m4a", {}).mime).toBe("audio/mp4");
  });

  it("finds audio files recursively and ignores others", async () => {
    const d = path.join(work, "scan");
    await fs.mkdir(path.join(d, "x"), { recursive: true });
    await fs.writeFile(path.join(d, "a.mp3"), "1");
    await fs.writeFile(path.join(d, "x", "b.M4A"), "2");
    await fs.writeFile(path.join(d, "x", "c.txt"), "3");
    const files = await findAudioFiles([d]);
    expect(files.map((f) => path.basename(f))).toEqual(["a.mp3", "b.M4A"]);
  });

  it("unparseable files get fallback metadata", async () => {
    const f = path.join(work, "garbage.mp3");
    await fs.writeFile(f, "not really audio");
    const r = await readMetadata(f);
    expect(r.meta.title).toBe("garbage");
    expect(r.cover).toBeUndefined();
  });
});

describe("add --dry-run end to end", () => {
  const input = () => path.join(work, "in");
  const out = () => path.join(work, "out");

  it("encrypts, stores, decrypts, dedupes, verifies and removes", async () => {
    await fs.writeFile(path.join(input(), "fake one.mp3"), crypto.randomBytes(150_000));
    await fs.writeFile(path.join(input(), "sub", "fake two.flac"), crypto.randomBytes(1000));
    if (hasFfmpeg) {
      execFileSync(
        "ffmpeg",
        [
          "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2",
          "-metadata", "title=Silence", "-metadata", "artist=The Quiet", "-metadata", "album=Nothing",
          "-metadata", "track=3", path.join(input(), "sub", "silent.mp3"),
        ],
      );
    }
    const expected = hasFfmpeg ? 3 : 2;

    const r1 = await runAdd([input()], { dryRun: out(), concurrency: 2 });
    expect(r1).toEqual({ added: expected, skipped: 0, failed: 0 });

    const store = new LocalStore(out());
    const session = await openSession(store, PASS);
    expect(session.library.tracks).toHaveLength(expected);
    for (const t of session.library.tracks) {
      const enc = await store.getBlob(t.driveFileId);
      expect(t.driveFileId).toBe(`tracks/${t.id}.bin`);
      const plain = await decryptFile(fromBase64(t.key), enc);
      expect(crypto.createHash("sha256").update(plain).digest("hex")).toBe(t.sha256);
      expect(plain.byteLength).toBe(t.plainSize);
    }
    const fake = session.library.tracks.find((t) => t.title === "fake one");
    expect(fake).toMatchObject({ artist: "Unknown Artist", album: "Unknown Album", mime: "audio/mpeg", plainSize: 150_000 });
    if (hasFfmpeg) {
      const s = session.library.tracks.find((t) => t.title === "Silence");
      expect(s).toMatchObject({ artist: "The Quiet", album: "Nothing", trackNo: 3 });
      expect(s!.durationSec).toBeGreaterThan(1.5);
    }
    // library file is not plaintext
    const rawLib = await fs.readFile(path.join(out(), "library.enc"));
    expect(rawLib.toString("latin1")).not.toContain("fake one");

    // wrong passphrase is rejected
    await expect(openSession(store, "nope")).rejects.toThrow();

    // dedupe on second run
    const r2 = await runAdd([input()], { dryRun: out() });
    expect(r2).toEqual({ added: 0, skipped: expected, failed: 0 });
    expect((await openSession(store, PASS)).library.tracks).toHaveLength(expected);

    // verify
    const v = await verifyTracks(session, undefined, () => {});
    expect(v).toEqual({ checked: expected, failures: [] });

    // list / match / remove
    expect(formatList(session.library.tracks)).toHaveLength(expected);
    const hits = matchTracks(session.library.tracks, "FAKE ONE");
    expect(hits).toHaveLength(1);
    await removeTracks(session, hits);
    await expect(fs.stat(path.join(out(), hits[0]!.driveFileId))).rejects.toThrow();
    expect((await openSession(store, PASS)).library.tracks).toHaveLength(expected - 1);
  });

  it("dedupes covers with identical image bytes", async () => {
    if (!hasFfmpeg) return;
    const d = path.join(work, "covers-in");
    await fs.mkdir(d, { recursive: true });
    const png = path.join(work, "cover.png");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", png]);
    for (const n of ["a", "b"]) {
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${n === "a" ? 440 : 880}:duration=1`,
        "-i", png, "-map", "0", "-map", "1", "-c:a", "libmp3lame", "-c:v", "copy", "-id3v2_version", "3",
        "-metadata", `title=${n}`, "-metadata", "album=Same", path.join(d, `${n}.mp3`),
      ]);
    }
    const out = path.join(work, "out-covers");
    const r = await runAdd([d], { dryRun: out });
    expect(r.added).toBe(2);
    const store = new LocalStore(out);
    const s = await openSession(store, PASS);
    const [a, b] = s.library.tracks;
    expect(a!.coverFileId).toBeTruthy();
    expect(a!.coverFileId).toBe(b!.coverFileId);
    expect(a!.coverKey).toBe(b!.coverKey);
    const img = await openBlob(await importContentKeyB64(a!.coverKey!), await store.getBlob(a!.coverFileId!));
    expect(img.byteLength).toBeGreaterThan(50);
    expect((await fs.readdir(path.join(out, "covers"))).length).toBe(1);
    // removing one track keeps the shared cover
    await removeTracks(s, [a!]);
    expect((await fs.readdir(path.join(out, "covers"))).length).toBe(1);
    await removeTracks(s, [b!]);
    expect((await fs.readdir(path.join(out, "covers"))).length).toBe(0);
  });
});
