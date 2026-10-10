import {
  LIBRARY_FILE,
  PLAYLISTS_FILE,
  VAULT_FILE,
  createVault,
  emptyLibrary,
  emptyPlaylists,
  openJson,
  sealJson,
  unlockVault,
  utf8Decode,
  utf8Encode,
  type Library,
  type PlaylistsFile,
  type VaultFile,
} from "@spodrive/core";
import { kdfIterations } from "./prompt.js";
import type { Store } from "./store.js";

export interface Session {
  store: Store;
  kek: CryptoKey;
  vault: VaultFile;
  library: Library;
  playlists: PlaylistsFile;
}

const OCTET = "application/octet-stream";

export async function saveLibrary(s: Pick<Session, "store" | "kek" | "library">): Promise<void> {
  s.library.updatedAt = new Date().toISOString();
  await s.store.writeRoot(LIBRARY_FILE, await sealJson(s.kek, s.library), OCTET);
}

export async function savePlaylists(s: Pick<Session, "store" | "kek" | "playlists">): Promise<void> {
  s.playlists.updatedAt = new Date().toISOString();
  await s.store.writeRoot(PLAYLISTS_FILE, await sealJson(s.kek, s.playlists), OCTET);
}

export async function writeVault(store: Store, vault: VaultFile): Promise<void> {
  await store.writeRoot(VAULT_FILE, utf8Encode(JSON.stringify(vault, null, 2)), "application/json");
}

/** Create vault + empty library + empty playlists in a store. */
export async function initVault(store: Store, passphrase: string): Promise<Session> {
  const { vault, kek } = await createVault(passphrase, kdfIterations());
  const session: Session = { store, kek, vault, library: emptyLibrary(), playlists: emptyPlaylists() };
  await writeVault(store, vault);
  await saveLibrary(session);
  await savePlaylists(session);
  return session;
}

/** Load vault.json, unlock with the passphrase, decrypt library and playlists. */
export async function openSession(store: Store, passphrase: string): Promise<Session> {
  const raw = await store.readRoot(VAULT_FILE);
  if (!raw) throw new Error(`No vault found in ${store.describe()}. Run "spodrive init" first.`);
  const vault = JSON.parse(utf8Decode(raw)) as VaultFile;
  const kek = await unlockVault(vault, passphrase);
  const libBytes = await store.readRoot(LIBRARY_FILE);
  const library = libBytes ? await openJson<Library>(kek, libBytes) : emptyLibrary();
  const plBytes = await store.readRoot(PLAYLISTS_FILE);
  const playlists = plBytes ? await openJson<PlaylistsFile>(kek, plBytes) : emptyPlaylists();
  return { store, kek, vault, library, playlists };
}
