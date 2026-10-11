/** Pure helpers for turning Drive files + parsed tags into Track fields. No I/O, no music-metadata import. */
import type { Track } from "@spodrive/core";

/** Extension -> mime for audio files Drive may label as application/octet-stream. */
export const AUDIO_EXT_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
};

/** Mime filter handed to the Google Picker. */
export const PICKER_MIME_TYPES = "audio/mpeg,audio/mp4,audio/x-m4a,audio/flac,audio/aac,audio/ogg";

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
};
const stem = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

/** The audio mime type to use for a Drive file, or null when it does not look like audio. */
export function audioMimeOf(name: string, driveMime: string | undefined): string | null {
  const byExt = AUDIO_EXT_MIME[extOf(name)];
  if (driveMime && driveMime.startsWith("audio/")) return driveMime === "audio/x-m4a" ? "audio/mp4" : driveMime;
  return byExt ?? null;
}

export type TrackMeta = Pick<
  Track,
  "title" | "artist" | "album" | "albumArtist" | "trackNo" | "discNo" | "year" | "durationSec"
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

/** Empty tags fall back to the file name (title) and the parent folder name (album). */
export function mapTags(fileName: string, parentName: string | undefined, tags: RawTags): TrackMeta {
  const artist = clean(tags.artist) ?? "Unknown Artist";
  const meta: TrackMeta = {
    title: clean(tags.title) ?? stem(fileName),
    artist,
    album: clean(tags.album) ?? clean(parentName) ?? "Unknown Album",
    albumArtist: clean(tags.albumartist) ?? artist,
    durationSec: tags.duration && Number.isFinite(tags.duration) ? Math.round(tags.duration * 1000) / 1000 : 0,
  };
  const trackNo = posInt(tags.track?.no);
  const discNo = posInt(tags.disk?.no);
  const year = posInt(tags.year);
  if (trackNo) meta.trackNo = trackNo;
  if (discNo) meta.discNo = discNo;
  if (year) meta.year = year;
  return meta;
}

export const HEAD_MIN = 256 * 1024;
export const HEAD_MAX = 4 * 1024 * 1024;
/** Extra bytes after an ID3v2 tag so the first audio frames (Xing/VBRI header) are included. */
const AUDIO_SLACK = 64 * 1024;

/** Size of the ID3v2 tag (header included) from the first 10 bytes of a file, or 0 when there is none. */
export function id3v2TagSize(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0; // "ID3"
  const b = [head[6]!, head[7]!, head[8]!, head[9]!];
  if (b.some((x) => x & 0x80)) return 0; // not a synchsafe integer
  const footer = (head[5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + ((b[0]! << 21) | (b[1]! << 14) | (b[2]! << 7) | b[3]!) + footer;
}

/** How many bytes from the start of the file to fetch for tag parsing (never more than the file). */
export function headBytesNeeded(firstBytes: Uint8Array, fileSize: number): number {
  const tag = id3v2TagSize(firstBytes);
  const want = tag > 0 ? Math.max(HEAD_MIN, tag + AUDIO_SLACK) : HEAD_MIN;
  return Math.min(fileSize, HEAD_MAX, want);
}
