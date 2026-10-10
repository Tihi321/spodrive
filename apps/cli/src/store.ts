import fs from "node:fs/promises";
import path from "node:path";

export type BlobFolder = "tracks" | "covers";

/**
 * Storage backend shared by all commands. Implemented by Google Drive (DriveStore)
 * and a local directory (LocalStore, used by `add --dry-run` and tests).
 */
export interface Store {
  /** Human readable location (folder id / directory). */
  describe(): string;
  /** Read a file in the root folder (vault.json, library.enc, playlists.enc); null if absent. */
  readRoot(name: string): Promise<Uint8Array | null>;
  /** Create or overwrite a file in the root folder. */
  writeRoot(name: string, data: Uint8Array, mimeType: string): Promise<void>;
  /** Upload a new blob into tracks/ or covers/; returns the file id. */
  putBlob(folder: BlobFolder, name: string, data: Uint8Array): Promise<string>;
  getBlob(fileId: string): Promise<Uint8Array>;
  deleteBlob(fileId: string): Promise<void>;
}

export class LocalStore implements Store {
  constructor(readonly dir: string) {}

  describe(): string {
    return path.resolve(this.dir);
  }

  private resolve(rel: string): string {
    const base = path.resolve(this.dir);
    const full = path.resolve(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) throw new Error("Path escapes store directory");
    return full;
  }

  async readRoot(name: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.resolve(name)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeRoot(name: string, data: Uint8Array): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.resolve(name), data);
  }

  async putBlob(folder: BlobFolder, name: string, data: Uint8Array): Promise<string> {
    const rel = `${folder}/${name}`;
    await fs.mkdir(this.resolve(folder), { recursive: true });
    await fs.writeFile(this.resolve(rel), data);
    return rel;
  }

  async getBlob(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(this.resolve(fileId)));
  }

  async deleteBlob(fileId: string): Promise<void> {
    await fs.rm(this.resolve(fileId), { force: true });
  }
}
