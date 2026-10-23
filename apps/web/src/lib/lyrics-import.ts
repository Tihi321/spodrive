/** Importing .lrc files: validation and matching files to library tracks (pure, unit tested). */
import { parseLrc } from "@spodrive/core";

export const MAX_LYRICS_BYTES = 200 * 1024;

export interface LrcFileInput {
  name: string;
  text: string;
}

export interface MatchableTrack {
  id: string;
  title: string;
  artist: string;
}

export interface LrcMatch {
  name: string;
  trackId: string;
  /** what to save: the original LRC, or the plain text without tag lines */
  text: string;
}

export interface MatchResult {
  matches: LrcMatch[];
  /** more than one candidate track (or a second file for an already matched track) */
  ambiguous: string[];
  unmatched: string[];
  invalid: Array<{ name: string; reason: string }>;
}

/** Lowercase, strip diacritics, keep only letters and digits. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, "d") // does not decompose
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Value of an LRC id tag such as [ti:Title], or "" */
export function lrcTag(text: string, tag: string): string {
  const m = new RegExp(`^\\s*\\[${tag}:([^\\]]*)\\]`, "im").exec(text);
  return m ? m[1]!.trim() : "";
}

const TAG_LINE = /^\s*\[[a-z]+:[^\]]*\]\s*$/i;

/** The text to store for a lyrics file, or the reason it can't be used. */
export function validateLyrics(raw: string): { text: string } | { error: string } {
  const text = raw.replace(/^﻿/, "");
  if (new TextEncoder().encode(text).length > MAX_LYRICS_BYTES) return { error: "larger than 200 KB" };
  if (parseLrc(text).length > 0) return { text };
  const plain = text
    .split(/\r?\n/)
    .filter((l) => !TAG_LINE.test(l))
    .join("\n")
    .trim();
  return plain ? { text: plain } : { error: "no lyrics in it" };
}

const stemOf = (name: string) => name.replace(/\.[^.]*$/, "");

/** Match files to tracks. Ambiguous and unmatched files are reported, never guessed. */
export function matchLrcFiles(files: LrcFileInput[], tracks: MatchableTrack[]): MatchResult {
  const res: MatchResult = { matches: [], ambiguous: [], unmatched: [], invalid: [] };
  const norm = tracks.map((t) => ({ id: t.id, title: normalizeName(t.title), artist: normalizeName(t.artist) }));
  const taken = new Set<string>();

  for (const f of files) {
    const v = validateLyrics(f.text);
    if ("error" in v) {
      res.invalid.push({ name: f.name, reason: v.error });
      continue;
    }
    const ti = normalizeName(lrcTag(f.text, "ti"));
    const ar = normalizeName(lrcTag(f.text, "ar"));
    const stem = normalizeName(stemOf(f.name));
    const steps: Array<() => typeof norm> = [
      () => (ti && ar ? norm.filter((t) => t.title === ti && t.artist === ar) : []),
      () => (ti ? norm.filter((t) => t.title === ti) : []),
      () => (stem ? norm.filter((t) => [t.title, t.artist + t.title, t.title + t.artist].includes(stem)) : []),
      () => norm.filter((t) => t.title.length >= 2 && stem.includes(t.title)),
    ];
    let found: typeof norm = [];
    for (const step of steps) {
      found = step();
      if (found.length) break;
    }
    if (found.length === 0) res.unmatched.push(f.name);
    else if (found.length > 1 || taken.has(found[0]!.id)) res.ambiguous.push(f.name);
    else {
      taken.add(found[0]!.id);
      res.matches.push({ name: f.name, trackId: found[0]!.id, text: v.text });
    }
  }
  return res;
}

const SHOWN_NAMES = 5;
const listNames = (names: string[]) =>
  names.slice(0, SHOWN_NAMES).join(", ") + (names.length > SHOWN_NAMES ? ` and ${names.length - SHOWN_NAMES} more` : "");

/** One line for the toast, e.g. "12 lyrics imported, 2 not matched: a.lrc, b.lrc". */
export function summarizeImport(saved: number, r: MatchResult, failed: string[] = []): string {
  const parts = [`${saved} lyrics imported`];
  if (r.unmatched.length) parts.push(`${r.unmatched.length} not matched: ${listNames(r.unmatched)}`);
  if (r.ambiguous.length) parts.push(`${r.ambiguous.length} ambiguous: ${listNames(r.ambiguous)}`);
  if (r.invalid.length) parts.push(`${r.invalid.length} unusable: ${listNames(r.invalid.map((i) => `${i.name} (${i.reason})`))}`);
  if (failed.length) parts.push(`${failed.length} failed to save: ${listNames(failed)}`);
  return parts.join(", ");
}

/** Read a picked file as text: UTF-8, or Windows-1250 (Croatian) when it is not valid UTF-8. */
export async function readLyricsFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1250").decode(buf);
  }
}

/**
 * Open the file dialog and resolve with the picked files (empty when cancelled). The input is created on the fly so
 * it still works from a menu that closes (and unmounts) on click.
 */
export function pickLyricsFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lrc,.txt";
    input.multiple = multiple;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}
