import fs from "node:fs/promises";
import path from "node:path";
import { parseFile, selectCover } from "music-metadata";
import type { Track } from "@spodrive/core";

export const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

export async function findAudioFiles(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string): Promise<void> {
    const st = await fs.stat(p);
    if (st.isDirectory()) {
      const entries = await fs.readdir(p);
      entries.sort();
      for (const e of entries) await walk(path.join(p, e));
    } else if (AUDIO_MIME[path.extname(p).toLowerCase()]) {
      out.push(p);
    }
  }
  for (const r of roots) await walk(r);
  return out;
}

export type TrackMeta = Pick<
  Track,
  "title" | "artist" | "album" | "albumArtist" | "trackNo" | "discNo" | "year" | "durationSec" | "mime"
>;

/** Minimal shape of the music-metadata results that we use (keeps the mapping testable). */
export interface RawTags {
  title?: string;
  artist?: string;
  album?: string;
  albumartist?: string;
  track?: { no: number | null };
  disk?: { no: number | null };
  year?: number;
  duration?: number;
}

const clean = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};
const posInt = (n: number | null | undefined): number | undefined => (n && n > 0 ? n : undefined);

export function mapTags(file: string, tags: RawTags): TrackMeta {
  const ext = path.extname(file).toLowerCase();
  const artist = clean(tags.artist) ?? "Unknown Artist";
  const meta: TrackMeta = {
    title: clean(tags.title) ?? path.basename(file, path.extname(file)),
    artist,
    album: clean(tags.album) ?? "Unknown Album",
    albumArtist: clean(tags.albumartist) ?? artist,
    durationSec: tags.duration && Number.isFinite(tags.duration) ? Math.round(tags.duration * 1000) / 1000 : 0,
    mime: AUDIO_MIME[ext] ?? "audio/mpeg",
  };
  const trackNo = posInt(tags.track?.no);
  const discNo = posInt(tags.disk?.no);
  const year = posInt(tags.year);
  if (trackNo) meta.trackNo = trackNo;
  if (discNo) meta.discNo = discNo;
  if (year) meta.year = year;
  return meta;
}

export interface ScannedFile {
  meta: TrackMeta;
  cover?: { data: Uint8Array; mime: string };
}

/** Read tags + embedded cover; unreadable metadata falls back to defaults. */
export async function readMetadata(file: string): Promise<ScannedFile> {
  try {
    const md = await parseFile(file);
    const meta = mapTags(file, { ...md.common, duration: md.format.duration });
    const pic = selectCover(md.common.picture);
    return { meta, cover: pic ? { data: pic.data, mime: pic.format || "image/jpeg" } : undefined };
  } catch {
    return { meta: mapTags(file, {}) };
  }
}
