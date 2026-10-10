import crypto from "node:crypto";
import {
  decryptFile,
  fromBase64,
  importContentKeyB64,
  openBlob,
  sealJson,
  createVault,
  LIBRARY_FILE,
  PLAYLISTS_FILE,
  type Track,
} from "@spodrive/core";
import { askConfirm, getNewPassphrase, kdfIterations } from "../prompt.js";
import { saveLibrary, savePlaylists, writeVault, type Session } from "../vault.js";
import { formatBytes, formatDuration, openDriveSession } from "./common.js";

export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort(
    (a, b) =>
      a.artist.localeCompare(b.artist) ||
      a.album.localeCompare(b.album) ||
      (a.discNo ?? 1) - (b.discNo ?? 1) ||
      (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

export function formatList(tracks: Track[]): string[] {
  return sortTracks(tracks).map((t) => {
    const no = t.trackNo ? `#${t.trackNo} ` : "";
    return `${t.artist} - ${t.album} - ${no}${t.title}  (${formatDuration(t.durationSec)})`;
  });
}

export function matchTracks(tracks: Track[], query: string): Track[] {
  const q = query.toLowerCase();
  return tracks.filter((t) => [t.title, t.artist, t.album].some((f) => f.toLowerCase().includes(q)));
}

export async function runList(): Promise<void> {
  const s = await openDriveSession();
  const lines = formatList(s.library.tracks);
  console.log(lines.join("\n") || "(library is empty)");
  console.log(`\n${s.library.tracks.length} track(s)`);
}

export async function runStatus(): Promise<void> {
  const s = await openDriveSession();
  const total = s.library.tracks.reduce((n, t) => n + t.plainSize, 0);
  console.log(`Location:   ${s.store.describe()}`);
  console.log(`Tracks:     ${s.library.tracks.length}`);
  console.log(`Total size: ${formatBytes(total)} (plaintext)`);
  console.log(`Playlists:  ${s.playlists.playlists.filter((p) => !p.deleted).length}`);
}

/** Remove tracks from store + manifest (cover only if unused by remaining tracks). */
export async function removeTracks(session: Session, victims: Track[]): Promise<void> {
  const ids = new Set(victims.map((t) => t.id));
  const remaining = session.library.tracks.filter((t) => !ids.has(t.id));
  const stillUsed = new Set(remaining.map((t) => t.coverFileId).filter((x): x is string => !!x));
  for (const t of victims) {
    await session.store.deleteBlob(t.driveFileId);
    if (t.coverFileId && !stillUsed.has(t.coverFileId)) {
      await session.store.deleteBlob(t.coverFileId);
      stillUsed.add(t.coverFileId); // already deleted
    }
  }
  session.library.tracks = remaining;
  await saveLibrary(session);
  const now = new Date().toISOString();
  let changed = false;
  for (const p of session.playlists.playlists) {
    const kept = p.trackIds.filter((id) => !ids.has(id));
    if (kept.length !== p.trackIds.length) {
      p.trackIds = kept;
      p.updatedAt = now;
      changed = true;
    }
  }
  if (changed) await savePlaylists(session);
}

export async function runRemove(query: string): Promise<void> {
  const s = await openDriveSession();
  const hits = matchTracks(s.library.tracks, query);
  if (hits.length === 0) {
    console.log("No tracks match.");
    return;
  }
  console.log(formatList(hits).join("\n"));
  if (!(await askConfirm(`Delete ${hits.length} track(s) from Drive?`))) {
    console.log("Aborted.");
    return;
  }
  await removeTracks(s, hits);
  console.log(`Removed ${hits.length} track(s).`);
}

export async function runPasswd(): Promise<void> {
  const s = await openDriveSession();
  const next = await getNewPassphrase();
  const { vault, kek } = await createVault(next, kdfIterations());
  // Re-seal manifests first, then publish the new vault.json last.
  s.kek = kek;
  s.vault = vault;
  await s.store.writeRoot(LIBRARY_FILE, await sealJson(kek, s.library), "application/octet-stream");
  await s.store.writeRoot(PLAYLISTS_FILE, await sealJson(kek, s.playlists), "application/octet-stream");
  await writeVault(s.store, vault);
  console.log("Passphrase changed. Audio files were not touched.");
  console.log("Other devices must unlock again with the new passphrase (use Lock in the web app first).");
}

export interface VerifyResult {
  checked: number;
  failures: string[];
}

export async function verifyTracks(session: Session, sample?: number, log: (m: string) => void = console.log): Promise<VerifyResult> {
  const pool = [...session.library.tracks];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picks = sample && sample > 0 ? pool.slice(0, sample) : pool;
  const failures: string[] = [];
  for (const t of picks) {
    const label = `${t.artist} - ${t.title}`;
    try {
      const enc = await session.store.getBlob(t.driveFileId);
      const plain = await decryptFile(fromBase64(t.key), enc);
      const hash = crypto.createHash("sha256").update(plain).digest("hex");
      if (hash !== t.sha256 || plain.byteLength !== t.plainSize) throw new Error("sha256/size mismatch");
      if (t.coverFileId && t.coverKey) {
        const cover = await session.store.getBlob(t.coverFileId);
        await openBlob(await importContentKeyB64(t.coverKey), cover);
      }
      log(`OK   ${label}`);
    } catch (e) {
      failures.push(label);
      log(`FAIL ${label}: ${(e as Error).message}`);
    }
  }
  return { checked: picks.length, failures };
}

export async function runVerify(opts: { sample?: string | number }): Promise<void> {
  const s = await openDriveSession();
  const n = opts.sample !== undefined ? Number(opts.sample) : undefined;
  const r = await verifyTracks(s, n);
  console.log(`${r.checked - r.failures.length}/${r.checked} verified.`);
  if (r.failures.length > 0) process.exitCode = 1;
}
