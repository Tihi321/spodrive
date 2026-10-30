import { describe, expect, it } from "vitest";
import { lrcTag, matchLrcFiles, normalizeName, summarizeImport, validateLyrics } from "../src/lib/lyrics-import";

const tracks = [
  { id: "1", title: "EnTenTinići", artist: "Mali Zbor" },
  { id: "2", title: "Bruno", artist: "Mali Zbor" },
  { id: "3", title: "Bruno", artist: "Veliki Zbor" },
  { id: "4", title: "Kišna pjesma", artist: "Đuro" },
];
const lrc = "[00:01.00] la la";
const tagged = (ti: string, ar = "") => `[ti:${ti}]\n${ar ? `[ar:${ar}]\n` : ""}[00:01.00] la la`;

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation", () => {
    expect(normalizeName("EnTenTinići")).toBe("ententinici");
    expect(normalizeName("Kišna  pjesma!")).toBe("kisnapjesma");
    expect(normalizeName("Đuro")).toBe("duro");
  });
});

describe("lrcTag / validateLyrics", () => {
  it("reads id tags", () => {
    expect(lrcTag("[ar: A B ]\n[ti:Song]\n[00:01.00] x", "ti")).toBe("Song");
    expect(lrcTag("[00:01.00] x", "ti")).toBe("");
  });
  it("accepts timed lines as is", () => {
    expect(validateLyrics("﻿[00:01.00] hi")).toEqual({ text: "[00:01.00] hi" });
  });
  it("accepts plain text without tag lines", () => {
    expect(validateLyrics("[ti:x]\nline one\nline two\n")).toEqual({ text: "line one\nline two" });
  });
  it("rejects empty, tag-only and oversized files", () => {
    expect("error" in validateLyrics("   \n")).toBe(true);
    expect("error" in validateLyrics("[ti:x]\n[ar:y]")).toBe(true);
    expect("error" in validateLyrics("a".repeat(200 * 1024 + 1))).toBe(true);
  });
});

describe("matchLrcFiles", () => {
  it("matches by [ti:] + [ar:] first", () => {
    const r = matchLrcFiles([{ name: "x.lrc", text: tagged("Bruno", "Veliki Zbor") }], tracks);
    expect(r.matches.map((m) => m.trackId)).toEqual(["3"]);
  });
  it("matches by [ti:] alone when it is unique, ignoring diacritics", () => {
    const r = matchLrcFiles([{ name: "x.lrc", text: tagged("ententinici") }], tracks);
    expect(r.matches.map((m) => m.trackId)).toEqual(["1"]);
  });
  it("matches by file name stems: title, artist - title, title - artist", () => {
    const r = matchLrcFiles(
      [
        { name: "Kisna pjesma.lrc", text: lrc },
        { name: "Veliki Zbor - Bruno.lrc", text: lrc },
        { name: "EnTenTinići - Mali Zbor.lrc", text: lrc },
      ],
      tracks,
    );
    expect(r.matches.map((m) => [m.name, m.trackId])).toEqual([
      ["Kisna pjesma.lrc", "4"],
      ["Veliki Zbor - Bruno.lrc", "3"],
      ["EnTenTinići - Mali Zbor.lrc", "1"],
    ]);
  });
  it("matches a stem that contains exactly one title", () => {
    const r = matchLrcFiles([{ name: "01 EnTenTinići (transcribed).lrc", text: lrc }], tracks);
    expect(r.matches.map((m) => m.trackId)).toEqual(["1"]);
  });
  it("reports ambiguous files instead of guessing", () => {
    const r = matchLrcFiles([{ name: "Bruno.lrc", text: lrc }], tracks);
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual(["Bruno.lrc"]);
  });
  it("reports a second file for the same track as ambiguous", () => {
    const r = matchLrcFiles(
      [
        { name: "a.lrc", text: tagged("EnTenTinići") },
        { name: "b.lrc", text: tagged("EnTenTinići") },
      ],
      tracks,
    );
    expect(r.matches.map((m) => m.name)).toEqual(["a.lrc"]);
    expect(r.ambiguous).toEqual(["b.lrc"]);
  });
  it("reports unmatched and invalid files", () => {
    const r = matchLrcFiles(
      [
        { name: "unknown.lrc", text: lrc },
        { name: "Bruno.lrc", text: "" },
      ],
      tracks,
    );
    expect(r.unmatched).toEqual(["unknown.lrc"]);
    expect(r.invalid).toEqual([{ name: "Bruno.lrc", reason: "no lyrics in it" }]);
    expect(summarizeImport(0, r)).toBe("0 lyrics imported, 1 not matched: unknown.lrc, 1 unusable: Bruno.lrc (no lyrics in it)");
  });
});
