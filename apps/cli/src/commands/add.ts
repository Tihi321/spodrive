import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHUNK_SIZE,
  VAULT_FILE,
  encryptFile,
  generateContentKey,
  importContentKey,
  sealBlob,
  toBase64,
  type Track,
} from "@spodrive/core";
import { getPassphrase } from "../prompt.js";
import { findAudioFiles, readMetadata } from "../scan.js";
import { LocalStore } from "../store.js";
import { initVault, openSession, saveLibrary, type Session } from "../vault.js";
import { openDriveSession } from "./common.js";

export interface AddOptions {
  concurrency?: number | string;
  dryRun?: string;
}

export interface AddResult {
  added: number;
  skipped: number;
  failed: number;
}

const SAVE_EVERY = 10;
const sha256Hex = (data: Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

interface CoverRef {
  fileId: string;
  key: string;
  mime: string;
}

/** Core of `add`: shared by the Drive and the local (dry-run) stores. */
export async function addFiles(
  session: Session,
  files: string[],
  concurrency = 3,
  log: (msg: string) => void = console.log,
): Promise<AddResult> {
  const { store, library } = session;
  const known = new Set(library.tracks.map((t) => t.sha256));
  const covers = new Map<string, Promise<CoverRef>>();
  const result: AddResult = { added: 0, skipped: 0, failed: 0 };
  let done = 0;
  let sinceSave = 0;
  let saving: Promise<void> = Promise.resolve();
  const total = files.length;
  const queue = [...files];

  const save = () => {
    saving = saving.then(() => saveLibrary(session));
    return saving;
  };

  const uploadCover = (hash: string, data: Uint8Array, mime: string): Promise<CoverRef> => {
    let p = covers.get(hash);
    if (!p) {
      p = (async () => {
        const raw = generateContentKey();
        const enc = await sealBlob(await importContentKey(raw), data);
        const fileId = await store.putBlob("covers", `${crypto.randomUUID()}.bin`, enc);
        return { fileId, key: toBase64(raw), mime };
      })();
      covers.set(hash, p);
    }
    return p;
  };

  const processOne = async (file: string): Promise<void> => {
    const data = new Uint8Array(await fs.readFile(file));
    const sha256 = sha256Hex(data);
    if (known.has(sha256)) {
      result.skipped++;
      log(`[${++done}/${total}] skip (already in library): ${path.basename(file)}`);
      return;
    }
    known.add(sha256);
    try {
      const { meta, cover } = await readMetadata(file);
      const id = crypto.randomUUID();
      const key = generateContentKey();
      const enc = await encryptFile(key, data, DEFAULT_CHUNK_SIZE);
      const driveFileId = await store.putBlob("tracks", `${id}.bin`, enc);
      const track: Track = {
        id,
        driveFileId,
        ...meta,
        plainSize: data.byteLength,
        chunkSize: DEFAULT_CHUNK_SIZE,
        key: toBase64(key),
        sha256,
        addedAt: new Date().toISOString(),
      };
      if (cover) {
        const ref = await uploadCover(sha256Hex(cover.data), cover.data, cover.mime);
        track.coverFileId = ref.fileId;
        track.coverKey = ref.key;
        track.coverMime = ref.mime;
      }
      library.tracks.push(track);
      result.added++;
      log(`[${++done}/${total}] added: ${track.artist} - ${track.title}`);
      if (++sinceSave >= SAVE_EVERY) {
        sinceSave = 0;
        await save();
      }
    } catch (e) {
      known.delete(sha256);
      result.failed++;
      log(`[${++done}/${total}] FAILED ${path.basename(file)}: ${(e as Error).message}`);
    }
  };

  const worker = async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) await processOne(f);
  };
  const n = Math.max(1, Math.min(Number(concurrency) || 3, 16));
  await Promise.all(Array.from({ length: n }, worker));
  if (result.added > 0) await save();
  await saving;
  return result;
}

async function openLocalSession(store: LocalStore): Promise<Session> {
  const exists = await store.readRoot(VAULT_FILE);
  if (exists) return openSession(store, await getPassphrase());
  const pass = await getPassphrase("Choose a passphrase for the dry-run vault", { confirm: true });
  return initVault(store, pass);
}

export async function runAdd(folders: string[], opts: AddOptions): Promise<AddResult> {
  const files = await findAudioFiles(folders.map((f) => path.resolve(f)));
  if (files.length === 0) {
    console.log("No .mp3/.m4a/.flac files found.");
    return { added: 0, skipped: 0, failed: 0 };
  }
  let session: Session;
  if (opts.dryRun) {
    console.log(`Dry run: writing encrypted output to ${path.resolve(opts.dryRun)} (no Google calls).`);
    session = await openLocalSession(new LocalStore(opts.dryRun));
  } else {
    session = await openDriveSession();
  }
  console.log(`Found ${files.length} audio file(s); library has ${session.library.tracks.length} track(s).`);
  const res = await addFiles(session, files, Number(opts.concurrency ?? 3));
  console.log(`Done: ${res.added} added, ${res.skipped} skipped, ${res.failed} failed.`);
  if (res.failed > 0) process.exitCode = 1;
  return res;
}
