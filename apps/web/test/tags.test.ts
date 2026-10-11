import { describe, expect, it } from "vitest";
import { HEAD_MAX, HEAD_MIN, headBytesNeeded, id3v2TagSize } from "../src/lib/tags";

/** ID3v2 header with the given tag-body size (synchsafe), optional flags byte. */
function id3(size: number, flags = 0): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 4, 0, flags, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

describe("id3v2TagSize", () => {
  it("reads the synchsafe size and adds the header", () => {
    expect(id3v2TagSize(id3(0))).toBe(10);
    expect(id3v2TagSize(id3(257))).toBe(267);
    expect(id3v2TagSize(id3(0x0fffffff))).toBe(0x0fffffff + 10);
  });
  it("accounts for the footer flag", () => {
    expect(id3v2TagSize(id3(100, 0x10))).toBe(120);
  });
  it("returns 0 for no tag, short input or an invalid size", () => {
    expect(id3v2TagSize(new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0]))).toBe(0);
    expect(id3v2TagSize(new Uint8Array([0x49, 0x44, 0x33]))).toBe(0);
    const bad = id3(5);
    bad[8] = 0x80;
    expect(id3v2TagSize(bad)).toBe(0);
  });
});

describe("headBytesNeeded", () => {
  const MB = 1024 * 1024;
  it("fetches the minimum when there is no tag or a small one", () => {
    expect(headBytesNeeded(new Uint8Array(10), 50 * MB)).toBe(HEAD_MIN);
    expect(headBytesNeeded(id3(10_000), 50 * MB)).toBe(HEAD_MIN);
  });
  it("grows for a big embedded cover, with room for the first audio frames", () => {
    expect(headBytesNeeded(id3(1 * MB), 50 * MB)).toBe(1 * MB + 10 + 64 * 1024);
  });
  it("is capped at HEAD_MAX and at the file size", () => {
    expect(headBytesNeeded(id3(20 * MB), 50 * MB)).toBe(HEAD_MAX);
    expect(headBytesNeeded(id3(1 * MB), 100_000)).toBe(100_000);
  });
});
