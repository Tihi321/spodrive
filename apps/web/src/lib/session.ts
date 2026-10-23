/**
 * App session: boot flow, sign in, sign out.
 *
 * phases: booting -> signedOut -> (sign in) -> ready
 * With a stored token or a cached library we go straight to ready (works offline).
 */
import { create } from "zustand";
import { CLIENT_ID, getAccessToken, initAuth, reconnect, setDeviceToken, signIn, signOut as authSignOut, useAuth } from "./auth";
import { DeviceAuthError, pollDeviceSignIn, startDeviceSignIn, type DeviceCode } from "./device-auth";
import { KV, dbClear, kvDel, kvGet } from "./db";
import { DriveError } from "./drive";
import { loadCachedLibrary, resetLibrary, syncLibrary, useLibrary } from "./library";
import { installPlaylistSyncTriggers, loadLocalPlaylists, resetPlaylists, syncPlaylists } from "./playlists";
import { installUserLyricsTriggers, loadUserLyricsIndex, resetUserLyrics } from "./user-lyrics";
import { refreshDownloaded, removeAllDownloads } from "./offline";
import { revokeCovers } from "./covers";
import { refreshSw } from "./sw-bridge";
import { initPlayer, playerActions, restorePlayer } from "../player/store";
import { hydrateSettings } from "../state/settings";
import { toastError } from "../state/toasts";
import { isAuthError } from "./errors";

export type Phase = "booting" | "signedOut" | "ready";

interface SessionState {
  phase: Phase;
  error?: string;
  busy: boolean;
}
export const useSession = create<SessionState>(() => ({ phase: "booting", busy: false }));
const setPhase = (phase: Phase, error?: string) => useSession.setState({ phase, error });

export const clientIdConfigured = () => CLIENT_ID.length > 0;

let uninstallTriggers: (() => void) | null = null;
let uninstallLyricsTriggers: (() => void) | null = null;
let unsubReconnect: (() => void) | null = null;

async function afterReady(): Promise<void> {
  initPlayer();
  // retry the refresh automatically once a reconnect succeeds
  unsubReconnect ??= useAuth.subscribe((s, prev) => {
    if (prev.needsReconnect && !s.needsReconnect && useSession.getState().phase === "ready") {
      void syncLibrary().catch(() => undefined);
      void syncPlaylists();
      void loadUserLyricsIndex(true);
    }
  });
  void refreshDownloaded();
  uninstallTriggers ??= installPlaylistSyncTriggers();
  uninstallLyricsTriggers ??= installUserLyricsTriggers();
  void loadUserLyricsIndex();
  const haveCache = await loadCachedLibrary().catch(() => false);
  void loadLocalPlaylists().then(() => {
    void syncPlaylists();
  });
  if (!haveCache) useLibrary.setState({ status: "loading" });
  try {
    await syncLibrary();
  } catch (e) {
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
  const cached = await kvGet(KV.library);
  if (!useAuth.getState().token && !cached) return setPhase("signedOut");
  setPhase("ready");
  void afterReady();
}

/** Click handler of "Sign in with Google". */
export async function connect(): Promise<void> {
  useSession.setState({ busy: true, error: undefined });
  try {
    await signIn();
    setPhase("ready");
    void afterReady();
  } catch (e) {
    setPhase("signedOut", (e as Error).message);
  } finally {
    useSession.setState({ busy: false });
  }
}

/** State of the "Sign in with a code" screen (Echo Show / TV). */
interface CodeSignInState {
  status: "idle" | "starting" | "waiting" | "error";
  info?: DeviceCode;
  /** DeviceAuthError code of the failure, to pick the message and whether "Get a new code" makes sense */
  errorCode?: string;
  error?: string;
}
export const useCodeSignIn = create<CodeSignInState>(() => ({ status: "idle" }));
let codeAbort: AbortController | null = null;

/** Click handler of "Sign in with a code": show a code, wait for the approval, then continue like connect(). */
export async function startCodeSignIn(): Promise<void> {
  codeAbort?.abort();
  const ctl = (codeAbort = new AbortController());
  useCodeSignIn.setState({ status: "starting", info: undefined, error: undefined, errorCode: undefined });
  try {
    const info = await startDeviceSignIn();
    if (ctl.signal.aborted) return;
    useCodeSignIn.setState({ status: "waiting", info });
    const tokens = await pollDeviceSignIn(info, ctl.signal);
    await setDeviceToken(tokens);
    useCodeSignIn.setState({ status: "idle", info: undefined });
    setPhase("ready");
    void afterReady();
  } catch (e) {
    if (ctl.signal.aborted) return;
    const code = e instanceof DeviceAuthError ? e.code : "unknown";
    useCodeSignIn.setState({ status: "error", errorCode: code, error: (e as Error).message });
  }
}

export function cancelCodeSignIn(): void {
  codeAbort?.abort();
  codeAbort = null;
  useCodeSignIn.setState({ status: "idle", info: undefined, error: undefined, errorCode: undefined });
}

/**
 * Click handler of the Reconnect banner. A device (code) session refreshes silently; when Google no longer accepts
 * its refresh token we go back to the sign-in screen, and the cached library is kept.
 */
export async function reconnectSession(): Promise<void> {
  const device = useAuth.getState().token?.via === "device";
  const ok = await reconnect();
  if (!ok && device) setPhase("signedOut", "Google session expired. Sign in with a code again.");
}

/** Revoke Google access and clear everything stored on this device. */
export async function signOutEverywhere(): Promise<void> {
  playerActions.reset();
  revokeCovers();
  resetLibrary();
  resetPlaylists();
  uninstallTriggers?.();
  uninstallTriggers = null;
  uninstallLyricsTriggers?.();
  uninstallLyricsTriggers = null;
  resetUserLyrics();
  await authSignOut();
  await Promise.all([dbClear("lyrics"), dbClear("covers")]);
  for (const k of Object.values(KV)) if (k !== KV.settings) await kvDel(k);
  await removeAllDownloads().catch(() => undefined);
  refreshSw();
  setPhase("signedOut");
}

export { getAccessToken, DriveError };
