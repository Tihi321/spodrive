import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { COVERS_FOLDER, ROOT_FOLDER, TRACKS_FOLDER } from "@spodrive/core";
import { CONFIG_DIR, CONFIG_PATH } from "./paths.js";
import type { BlobFolder, Store } from "./store.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_QUERY = "appProperties has { key='spodrive' and value='root' } and trashed=false";

interface Config {
  rootId?: string;
  tracksId?: string;
  coversId?: string;
  files?: Record<string, string>;
}

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as Config;
  } catch {
    return {};
  }
}

async function saveConfig(c: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(c, null, 2));
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function isNotFound(e: unknown): boolean {
  const code = (e as { code?: number | string; status?: number })?.code ?? (e as { status?: number })?.status;
  return code === 404 || code === "404";
}

export class DriveStore implements Store {
  private constructor(
    private readonly drive: drive_v3.Drive,
    private readonly cfg: Required<Pick<Config, "rootId" | "tracksId" | "coversId">> & { files: Record<string, string> },
  ) {}

  describe(): string {
    return `Google Drive folder ${this.cfg.rootId}`;
  }

  get rootId(): string {
    return this.cfg.rootId;
  }

  /** Find existing root folders (via appProperties) visible to this app. */
  static async findRoots(auth: drive_v3.Options["auth"]): Promise<drive_v3.Schema$File[]> {
    const drive = google.drive({ version: "v3", auth });
    const res = await drive.files.list({ q: ROOT_QUERY, fields: "files(id,name,createdTime)", spaces: "drive", pageSize: 20 });
    return res.data.files ?? [];
  }

  /** Create root folder tree (root, tracks, covers). Never deletes anything. */
  static async create(auth: drive_v3.Options["auth"]): Promise<DriveStore> {
    const drive = google.drive({ version: "v3", auth });
    const mk = async (name: string, parent?: string, appProperties?: Record<string, string>) => {
      const r = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined, appProperties },
        fields: "id",
      });
      if (!r.data.id) throw new Error(`Failed to create folder ${name}`);
      return r.data.id;
    };
    const rootId = await mk(ROOT_FOLDER, undefined, { spodrive: "root" });
    const tracksId = await mk(TRACKS_FOLDER, rootId);
    const coversId = await mk(COVERS_FOLDER, rootId);
    const cfg = { rootId, tracksId, coversId, files: {} as Record<string, string> };
    await saveConfig(cfg);
    return new DriveStore(drive, cfg);
  }

  /** Open an existing tree: validate the cached config, else rediscover via appProperties. */
  static async open(auth: drive_v3.Options["auth"]): Promise<DriveStore> {
    const drive = google.drive({ version: "v3", auth });
    const cached = await loadConfig();
    if (cached.rootId && cached.tracksId && cached.coversId) {
      try {
        const r = await drive.files.get({ fileId: cached.rootId, fields: "id,trashed,appProperties" });
        if (!r.data.trashed && r.data.appProperties?.spodrive === "root") {
          return new DriveStore(drive, {
            rootId: cached.rootId,
            tracksId: cached.tracksId,
            coversId: cached.coversId,
            files: cached.files ?? {},
          });
        }
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    const roots = await DriveStore.findRoots(auth);
    const root = roots[0];
    if (!root?.id) throw new Error('No Spodrive folder found on Drive. Run "spodrive init" first.');
    if (roots.length > 1) console.warn(`Warning: ${roots.length} Spodrive folders found, using ${root.id}.`);
    const child = async (name: string): Promise<string> => {
      const r = await drive.files.list({
        q: `'${root.id}' in parents and name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });
      const id = r.data.files?.[0]?.id;
      if (id) return id;
      const c = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [root.id!] },
        fields: "id",
      });
      return c.data.id!;
    };
    const cfg = { rootId: root.id, tracksId: await child(TRACKS_FOLDER), coversId: await child(COVERS_FOLDER), files: {} as Record<string, string> };
    await saveConfig(cfg);
    return new DriveStore(drive, cfg);
  }

  private async findRootFile(name: string): Promise<string | null> {
    const cached = this.cfg.files[name];
    if (cached) return cached;
    const r = await this.drive.files.list({
      q: `'${this.cfg.rootId}' in parents and name='${esc(name)}' and mimeType!='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id)",
      pageSize: 1,
    });
    const id = r.data.files?.[0]?.id ?? null;
    if (id) await this.remember(name, id);
    return id;
  }

  private async remember(name: string, id: string): Promise<void> {
    this.cfg.files[name] = id;
    await saveConfig(this.cfg);
  }

  private async download(fileId: string): Promise<Uint8Array> {
    const r = await this.drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return new Uint8Array(r.data as ArrayBuffer);
  }

  async readRoot(name: string): Promise<Uint8Array | null> {
    let id = await this.findRootFile(name);
    if (!id) return null;
    try {
      return await this.download(id);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      delete this.cfg.files[name];
      id = await this.findRootFile(name);
      return id ? this.download(id) : null;
    }
  }

  async writeRoot(name: string, data: Uint8Array, mimeType: string): Promise<void> {
    const body = () => Readable.from([Buffer.from(data)]);
    let id = await this.findRootFile(name);
    if (id) {
      try {
        await this.drive.files.update({ fileId: id, media: { mimeType, body: body() } });
        return;
      } catch (e) {
        if (!isNotFound(e)) throw e;
        delete this.cfg.files[name];
      }
    }
    const r = await this.drive.files.create({
      requestBody: { name, parents: [this.cfg.rootId], mimeType },
      media: { mimeType, body: body() },
      fields: "id",
    });
    id = r.data.id ?? null;
    if (!id) throw new Error(`Upload of ${name} returned no id`);
    await this.remember(name, id);
  }

  async putBlob(folder: BlobFolder, name: string, data: Uint8Array): Promise<string> {
    const parent = folder === "tracks" ? this.cfg.tracksId : this.cfg.coversId;
    const r = await this.drive.files.create({
      requestBody: { name, parents: [parent], mimeType: "application/octet-stream" },
      media: { mimeType: "application/octet-stream", body: Readable.from([Buffer.from(data)]) },
      fields: "id",
    });
    if (!r.data.id) throw new Error(`Upload of ${name} returned no id`);
    return r.data.id;
  }

  getBlob(fileId: string): Promise<Uint8Array> {
    return this.download(fileId);
  }

  async deleteBlob(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
}
