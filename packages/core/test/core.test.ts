import { describe, expect, it } from "vitest";
import {
  HEADER_SIZE,
  TAG_SIZE,
  WrongPassphraseError,
  activeLineIndex,
  chunkCount,
  concat,
  createVault,
  decryptChunks,
  decryptFile,
  decryptRange,
  emptyPlaylists,
  encryptFile,
  encryptStream,
  encryptedSize,
  fromBase64,
  generateContentKey,
  importContentKey,
  mergePlaylists,
  openBlob,
  openJson,
  parseHeader,
  parseLrc,
  planRange,
  sealBlob,
  sealJson,
  toBase64,
  unlockVault,
  type Playlist,
} from "../src/index";

const CS = 1024;
const rnd = (n: number) => {
  const b = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) globalThis.crypto.getRandomValues(b.subarray(off, Math.min(n, off + 65536)));
  return b;
};
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("SPD1 round trip", () => {
  const key = generateContentKey();
  const sizes = [0, 1, CS - 1, CS, CS + 1, Math.floor(CS * 3.5)];
  for (const size of sizes) {
    it(`size ${size}`, async () => {
      const pt = rnd(size);
      const enc = await encryptFile(key, pt, CS);
      expect(enc.length).toBe(encryptedSize(size, CS));
      expect(eq(await decryptFile(key, enc), pt)).toBe(true);
    });
  }
  it("default chunk size", async () => {
    const pt = rnd(65536 * 2 + 123);
    const enc = await encryptFile(key, pt);
    expect(parseHeader(enc).chunkSize).toBe(65536);
    expect(eq(await decryptFile(key, enc), pt)).toBe(true);
  });
  it("streaming encrypt matches format", async () => {
    for (const size of [0, 5, CS, CS * 2, CS * 2 + 7]) {
      const pt = rnd(size);
      const pieces: Uint8Array[] = [];
      for (let o = 0; o < size; o += 300) pieces.push(pt.subarray(o, o + 300));
      const parts: Uint8Array[] = [];
      for await (const p of encryptStream(key, pieces, CS)) parts.push(p);
      const enc = concat(...parts);
      expect(enc.length).toBe(encryptedSize(size, CS));
      expect(eq(await decryptFile(key, enc), pt)).toBe(true);
    }
  });
  it("chunkCount", () => {
    expect(chunkCount(0, CS)).toBe(1);
    expect(chunkCount(CS, CS)).toBe(1);
    expect(chunkCount(CS + 1, CS)).toBe(2);
  });
});

describe("range decrypt", () => {
  it("random ranges match plaintext", async () => {
    const key = generateContentKey();
    const size = CS * 7 + 333;
    const pt = rnd(size);
    const enc = await encryptFile(key, pt, CS);
    const header = parseHeader(enc);
    const fetchEnc = async (s: number, e: number) => enc.slice(s, e + 1);
    const cases: [number, number][] = [
      [0, 0],
      [0, size - 1],
      [size - 1, size - 1],
      [CS - 1, CS],
      [CS, 2 * CS - 1],
      [CS * 7, size - 1],
    ];
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(Math.random() * size);
      const b = a + Math.floor(Math.random() * (size - a));
      cases.push([a, b]);
    }
    for (const [s, e] of cases) {
      const out = await decryptRange(key, header, size, s, e, fetchEnc);
      expect(eq(out, pt.subarray(s, e + 1))).toBe(true);
    }
  });
  it("planRange maps offsets", () => {
    const p = planRange(CS * 3, CS + 5, CS * 2 + 5, CS);
    expect(p.firstChunk).toBe(1);
    expect(p.lastChunk).toBe(2);
    expect(p.encStart).toBe(HEADER_SIZE + CS + TAG_SIZE);
    expect(p.encEndInclusive).toBe(encryptedSize(CS * 3, CS) - 1);
    expect(p.sliceStart).toBe(5);
    expect(p.sliceEnd).toBe(CS + 6);
    expect(() => planRange(10, 5, 10, CS)).toThrow();
  });
});

describe("tamper detection", () => {
  const key = generateContentKey();
  it("flipped byte throws", async () => {
    const enc = await encryptFile(key, rnd(CS * 3), CS);
    enc[HEADER_SIZE + CS + TAG_SIZE + 10]! ^= 1;
    await expect(decryptFile(key, enc)).rejects.toThrow();
  });
  it("truncation (drop last chunk) throws", async () => {
    const enc = await encryptFile(key, rnd(CS * 3), CS);
    const cut = enc.slice(0, enc.length - (CS + TAG_SIZE));
    await expect(decryptFile(key, cut)).rejects.toThrow();
  });
  it("truncation of a short last chunk throws", async () => {
    const enc = await encryptFile(key, rnd(CS * 2 + 10), CS);
    await expect(decryptFile(key, enc.slice(0, HEADER_SIZE + 2 * (CS + TAG_SIZE)))).rejects.toThrow();
  });
  it("chunk reorder throws", async () => {
    const enc = await encryptFile(key, rnd(CS * 4), CS);
    const s = CS + TAG_SIZE;
    const c1 = enc.slice(HEADER_SIZE + s, HEADER_SIZE + 2 * s);
    const c2 = enc.slice(HEADER_SIZE + 2 * s, HEADER_SIZE + 3 * s);
    const swapped = enc.slice();
    swapped.set(c2, HEADER_SIZE + s);
    swapped.set(c1, HEADER_SIZE + 2 * s);
    await expect(decryptFile(key, swapped)).rejects.toThrow();
  });
  it("wrong key throws", async () => {
    const enc = await encryptFile(key, rnd(100), CS);
    await expect(decryptFile(generateContentKey(), enc)).rejects.toThrow();
  });
  it("range decrypt with wrong chunk index throws", async () => {
    const enc = await encryptFile(key, rnd(CS * 3), CS);
    const header = parseHeader(enc);
    const s = CS + TAG_SIZE;
    await expect(decryptChunks(key, header, enc.slice(HEADER_SIZE + s, HEADER_SIZE + 2 * s), 0, 3)).rejects.toThrow();
  });
});

describe("vault and blobs", () => {
  it("wrong passphrase throws WrongPassphraseError", async () => {
    const { vault, kek } = await createVault("correct horse", 1000);
    expect(vault.kdf.iterations).toBe(1000);
    const k2 = await unlockVault(vault, "correct horse");
    const blob = await sealBlob(kek, new Uint8Array([1, 2, 3]));
    expect(Array.from(await openBlob(k2, blob))).toEqual([1, 2, 3]);
    await expect(unlockVault(vault, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it("json round trip and aad", async () => {
    const { kek } = await createVault("pw", 1000);
    const v = { a: 1, b: ["x", "é"] };
    const blob = await sealJson(kek, v);
    expect(await openJson(kek, blob)).toEqual(v);
    const withAad = await sealBlob(kek, new Uint8Array([9]), new Uint8Array([1]));
    await expect(openBlob(kek, withAad)).rejects.toThrow();
  });
  it("content key import and base64", async () => {
    const raw = generateContentKey();
    expect(raw.length).toBe(32);
    expect(eq(fromBase64(toBase64(raw)), raw)).toBe(true);
    const k = await importContentKey(raw);
    expect(Array.from(await openBlob(k, await sealBlob(k, new Uint8Array([7]))))).toEqual([7]);
  });
});

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
