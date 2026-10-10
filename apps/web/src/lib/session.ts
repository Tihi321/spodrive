/**
 * App session: boot flow, vault unlock, lock, sign out.
 *
 * phases: booting -> signedOut -> (sign in) -> checking -> needsUnlock | noRoot -> (unlock) -> ready
 * With a stored KEK we go straight to ready (works offline).
 */
import { create } from "zustand";
import { unlockVault, WrongPassphraseError, type VaultFile } from "@spodrive/core";
import { CLIENT_ID, getAccessToken, initAuth, signIn, signOut as authSignOut, tokenIsValid, useAuth, refreshToken } from "./auth";
import { KV, dbClear, kvDel, kvGet, kvSet } from "./db";
import { DriveError, downloadBytes, getChildId, getRootId } from "./drive";
import { getKek, loadStoredKek, storeKek, wipeKek } from "./keyring";
import { KeyMismatchError, loadCachedLibrary, resetLibrary, syncLibrary, useLibrary } from "./library";
import { installPlaylistSyncTriggers, loadLocalPlaylists, resetPlaylists, syncPlaylists } from "./playlists";
import { refreshDownloaded, removeAllDownloads } from "./offline";
import { revokeCovers } from "./covers";
import { refreshSw } from "./sw-bridge";
import { initPlayer, playerActions, restorePlayer } from "../player/store";
import { hydrateSettings } from "../state/settings";
import { toast, toastError } from "../state/toasts";
import { isAuthError } from "./errors";

export type Phase = "booting" | "signedOut" | "checking" | "needsUnlock" | "noRoot" | "ready";

interface SessionState {
  phase: Phase;
  error?: string;
  busy: boolean;
}
export const useSession = create<SessionState>(() => ({ phase: "booting", busy: false }));
const setPhase = (phase: Phase, error?: string) => useSession.setState({ phase, error });

export const clientIdConfigured = () => CLIENT_ID.length > 0;

let uninstallTriggers: (() => void) | null = null;

async function fetchVault(rootId: string): Promise<VaultFile> {
  try {
    const id = await getChildId("vault.json", rootId);
    if (!id) throw new Error("vault.json not found in the Spodrive folder");
    const bytes = await downloadBytes(id);
    const vault = JSON.parse(new TextDecoder().decode(bytes)) as VaultFile;
    await kvSet(KV.vault, vault);
    return vault;
  } catch (e) {
    const cached = await kvGet<VaultFile>(KV.vault);
    if (cached && !navigator.onLine) return cached;
    throw e;
  }
}

/** After a token is available but no KEK: look for the Spodrive folder. */
async function checkRoot(): Promise<void> {
  setPhase("checking");
  try {
    const rootId = await getRootId();
    setPhase(rootId ? "needsUnlock" : "noRoot");
  } catch (e) {
    if (!navigator.onLine) {
      // offline with a cached vault: allow unlock
      const cached = await kvGet<VaultFile>(KV.vault);
      if (cached) return setPhase("needsUnlock");
    }
    setPhase("signedOut", (e as Error).message);
  }
}

let unsubReconnect: (() => void) | null = null;

async function afterReady(): Promise<void> {
  initPlayer();
  // retry the refresh automatically once a reconnect succeeds
  unsubReconnect ??= useAuth.subscribe((s, prev) => {
    if (prev.needsReconnect && !s.needsReconnect && useSession.getState().phase === "ready") {
      void syncLibrary().catch(() => undefined);
      void syncPlaylists();
    }
  });
  void refreshDownloaded();
  uninstallTriggers ??= installPlaylistSyncTriggers();
  let haveCache = false;
  try {
    haveCache = await loadCachedLibrary();
  } catch {
    // cached library is not decryptable with this key
    await lock("The stored key no longer matches. Please unlock again.");
    return;
  }
  void loadLocalPlaylists().then(() => {
    void syncPlaylists();
  });
  if (!haveCache) useLibrary.setState({ status: "loading" });
  try {
    await syncLibrary();
  } catch (e) {
    if (e instanceof KeyMismatchError) {
      await lock(e.message);
      return;
    }
    if (isAuthError(e)) {
      // the "Reconnect Google" banner handles this; keep showing the cached library
      useAuth.setState({ needsReconnect: true });
      if (!haveCache) useLibrary.setState({ status: "error", error: "Reconnect Google to load your library." });
    } else if (!haveCache) {
      useLibrary.setState({ status: "error", error: (e as Error).message });
    } else if (navigator.onLine) toastError(e, "Could not refresh library");
  }
  await restorePlayer();
}

export async function boot(): Promise<void> {
  await Promise.all([initAuth(), hydrateSettings()]);
  const kek = await loadStoredKek();
  if (kek) {
    setPhase("ready");
    void afterReady();
    return;
  }
  const token = useAuth.getState().token;
  if (!token) return setPhase("signedOut");
  if (!tokenIsValid(token)) {
    if (!navigator.onLine) return setPhase("signedOut");
    const t = await refreshToken();
    if (!t) return setPhase("signedOut");
  }
  await checkRoot();
}

/** Click handler of "Sign in with Google". */
export async function connect(): Promise<void> {
  useSession.setState({ busy: true, error: undefined });
  try {
    await signIn();
    await checkRoot();
  } catch (e) {
    setPhase("signedOut", (e as Error).message);
  } finally {
    useSession.setState({ busy: false });
  }
}

export async function unlock(passphrase: string): Promise<"ok" | "wrong" | "error"> {
  useSession.setState({ busy: true, error: undefined });
  try {
    const rootId = await getRootId();
    if (!rootId) {
      setPhase("noRoot");
      return "error";
    }
    const vault = await fetchVault(rootId);
    const kek = await unlockVault(vault, passphrase);
    await storeKek(kek);
    setPhase("ready");
    void afterReady();
    return "ok";
  } catch (e) {
    if (e instanceof WrongPassphraseError) {
      useSession.setState({ error: "Wrong passphrase" });
      return "wrong";
    }
    useSession.setState({ error: (e as Error).message });
    return "error";
  } finally {
    useSession.setState({ busy: false });
  }
}

/** Wipe the key and every decrypted in-memory thing. Keeps encrypted caches and downloads. */
export async function lock(message?: string): Promise<void> {
  playerActions.reset();
  revokeCovers();
  resetLibrary();
  resetPlaylists();
  await wipeKek();
  refreshSw();
  const token = useAuth.getState().token;
  if (message) toast(message, { kind: "info" });
  if (token) await checkRoot().catch(() => setPhase("needsUnlock"));
  else setPhase("signedOut");
}

/** Revoke Google access and clear everything stored on this device. */
export async function signOutEverywhere(): Promise<void> {
  playerActions.reset();
  revokeCovers();
  resetLibrary();
  resetPlaylists();
  uninstallTriggers?.();
  uninstallTriggers = null;
  await wipeKek();
  await authSignOut();
  await Promise.all([dbClear("lyrics"), dbClear("covers"), dbClear("headers")]);
  for (const k of Object.values(KV)) if (k !== KV.settings) await kvDel(k);
  await removeAllDownloads().catch(() => undefined);
  refreshSw();
  setPhase("signedOut");
}

export function isUnlocked(): boolean {
  return getKek() !== null;
}

export { getAccessToken, DriveError };
