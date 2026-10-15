/**
 * Google Identity Services token client (implicit/token flow, no server, no refresh token).
 * Access tokens last ~1h: we refresh silently a few minutes before expiry and mirror the
 * current token into IndexedDB so the service worker can use it.
 */
import { create } from "zustand";
import { KV, getToken, kvDel, kvGet, kvSet, type StoredToken } from "./db";

export const CLIENT_ID: string = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "").trim();
export const SCOPE = "https://www.googleapis.com/auth/drive.file";
/**
 * Optional extra: read-only access to the whole Drive, so a picked folder can be listed all the way down
 * and rescans find files added later. Restricted scope: unverified apps show a warning for it.
 */
export const FULL_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const scopeFor = (fullRead: boolean) => (fullRead ? `${SCOPE} ${FULL_READ_SCOPE}` : SCOPE);
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const MIN_VALID_MS = 60 * 1000;

interface UserHint {
  email?: string;
  name?: string;
}

interface AuthState {
  token: StoredToken | null;
  /** Silent refresh failed: user must click "Reconnect Google". */
  needsReconnect: boolean;
  user: UserHint | null;
}

/** Whether a token can read whole folders (the user granted FULL_READ_SCOPE). */
export const hasFullRead = (t: StoredToken | null | undefined): boolean => !!t?.scope?.split(" ").includes(FULL_READ_SCOPE);

export const useAuth = create<AuthState>(() => ({ token: null, needsReconnect: false, user: null }));

let gisPromise: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google Identity Services (offline?)"));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

let client: GisTokenClient | null = null;
let pending: { promise: Promise<StoredToken>; resolve(t: StoredToken): void; reject(e: Error): void } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

async function setToken(t: StoredToken | null): Promise<void> {
  useAuth.setState({ token: t });
  if (t) await kvSet(KV.token, t);
  else await kvDel(KV.token);
  scheduleRefresh();
}

function onGisResponse(r: GisTokenResponse) {
  const p = pending;
  if (!p) return;
  if (r.error || !r.access_token) {
    pending = null;
    p.reject(new Error(r.error_description || r.error || "Google sign-in failed"));
    return;
  }
  const expiresIn = Number(r.expires_in ?? 3600);
  const tok: StoredToken = { accessToken: r.access_token, expiresAt: Date.now() + expiresIn * 1000, scope: r.scope };
  pending = null;
  void setToken(tok).then(() => {
    useAuth.setState({ needsReconnect: false });
    void fetchUser();
    p.resolve(tok);
  });
}

async function ensureClient(): Promise<GisTokenClient> {
  if (client) return client;
  if (!CLIENT_ID) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");
  await loadGis();
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: onGisResponse,
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(e.type === "popup_closed" ? "Sign-in window was closed" : e.message || e.type));
    },
  });
  return client;
}

/** Preload the GIS script and client so the first click can open the popup synchronously. */
export async function preloadGis(): Promise<void> {
  if (!CLIENT_ID) return;
  try {
    await ensureClient();
  } catch {
    /* offline: ignore */
  }
}

/** `fullRead` defaults to what the current token has, so refreshes keep the access the user granted. */
function requestToken(prompt: string, fullRead = hasFullRead(useAuth.getState().token)): Promise<StoredToken> {
  if (pending) return pending.promise;
  let resolve!: (t: StoredToken) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<StoredToken>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pending = { promise, resolve, reject };
  void (async () => {
    try {
      const c = await ensureClient();
      const hint = useAuth.getState().user?.email ?? (await kvGet<UserHint>(KV.userHint))?.email;
      c.requestAccessToken({ prompt, scope: scopeFor(fullRead), ...(hint ? { hint } : {}) });
    } catch (e) {
      const p = pending;
      pending = null;
      p?.reject(e as Error);
    }
  })();
  // GIS can hang forever if a popup is blocked silently; guard.
  const timeout = setTimeout(() => {
    if (pending?.promise === promise) {
      pending = null;
      reject(new Error("Google sign-in timed out"));
    }
  }, 60_000);
  promise.finally(() => clearTimeout(timeout)).catch(() => undefined);
  return promise;
}

/** Interactive sign-in. Call from a click handler. */
export async function signIn(): Promise<StoredToken> {
  const hasHint = !!useAuth.getState().user?.email;
  return requestToken(hasHint ? "" : "select_account");
}

/**
 * Ask for read access to whole folders (call from a click handler). Google lets the user untick the box,
 * so this resolves false when the access was not granted.
 */
export async function requestFullRead(): Promise<boolean> {
  const t = await requestToken("consent", true);
  return hasFullRead(t);
}

let silent: Promise<StoredToken | null> | null = null;
/** Try to get a new token without UI. On failure shows the "Reconnect" banner (when online). */
export function refreshToken(): Promise<StoredToken | null> {
  silent ??= requestToken("")
    .then((t) => t)
    .catch(() => {
      if (navigator.onLine) useAuth.setState({ needsReconnect: true });
      return null;
    })
    .finally(() => {
      silent = null;
    });
  return silent;
}

/** Click handler for the Reconnect banner. */
export async function reconnect(): Promise<boolean> {
  try {
    await requestToken("");
    useAuth.setState({ needsReconnect: false });
    return true;
  } catch {
    return false;
  }
}

export const tokenIsValid = (t: StoredToken | null | undefined, margin = MIN_VALID_MS): t is StoredToken =>
  !!t && t.expiresAt - Date.now() > margin;

/** A valid access token, refreshing silently when needed. */
export async function getAccessToken(): Promise<string> {
  let t = useAuth.getState().token ?? (await getToken()) ?? null;
  if (!tokenIsValid(t)) {
    // another tab/SW round trip may already have refreshed it
    const stored = (await getToken()) ?? null;
    if (tokenIsValid(stored)) t = stored;
    else t = await refreshToken();
  }
  if (!tokenIsValid(t, 5_000)) throw new Error("Not signed in to Google");
  if (useAuth.getState().token?.accessToken !== t.accessToken) useAuth.setState({ token: t });
  return t.accessToken;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const t = useAuth.getState().token;
  if (!t) return;
  const delay = Math.max(10_000, t.expiresAt - Date.now() - REFRESH_BEFORE_MS);
  refreshTimer = setTimeout(() => void refreshToken(), delay);
}

async function fetchUser(): Promise<void> {
  try {
    const t = useAuth.getState().token;
    if (!t) return;
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
      headers: { Authorization: `Bearer ${t.accessToken}` },
    });
    if (!res.ok) return;
    const j = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
    const user: UserHint = { email: j.user?.emailAddress, name: j.user?.displayName };
    useAuth.setState({ user });
    await kvSet(KV.userHint, user);
  } catch {
    /* best effort */
  }
}

let inited = false;
export async function initAuth(): Promise<void> {
  if (inited) return;
  inited = true;
  const [token, user] = await Promise.all([getToken(), kvGet<UserHint>(KV.userHint)]);
  useAuth.setState({ token: token ?? null, user: user ?? null });
  scheduleRefresh();

  const maybeRefresh = () => {
    const t = useAuth.getState().token;
    if (t && navigator.onLine && t.expiresAt - Date.now() < REFRESH_BEFORE_MS) void refreshToken();
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && maybeRefresh());
  window.addEventListener("online", maybeRefresh);
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.type === "need-token") void refreshToken();
  });
  void preloadGis();
}

export async function signOut(): Promise<void> {
  const t = useAuth.getState().token;
  clearTimeout(refreshTimer);
  if (t && window.google?.accounts?.oauth2) {
    await new Promise<void>((res) => {
      try {
        window.google!.accounts.oauth2.revoke(t.accessToken, () => res());
        setTimeout(res, 2000);
      } catch {
        res();
      }
    });
  }
  await kvDel(KV.userHint);
  useAuth.setState({ token: null, needsReconnect: false, user: null });
  await kvDel(KV.token);
}
