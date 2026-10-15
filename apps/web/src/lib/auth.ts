/**
 * Google sign-in. Two modes (see server-auth.ts):
 * - "server": GIS code flow; the /api/auth function keeps the refresh token in an HttpOnly cookie, so
 *   access tokens renew without any UI, also in the background with the screen off.
 * - "browser": GIS token flow (no server). Tokens last ~1 h and renewing needs a popup, which browsers
 *   only allow after a tap, so the "Reconnect" banner shows up regularly. Used when the function is not
 *   configured (e.g. `vite dev`).
 * The current access token is mirrored into IndexedDB so the service worker can use it.
 */
import { create } from "zustand";
import { KV, getToken, kvDel, kvGet, kvSet, type StoredToken } from "./db";
import { authUrl, getAuthMode, serverRefresh, toStoredToken, type AuthMode, type TokenJson } from "./server-auth";

export const CLIENT_ID: string = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "").trim();
export const SCOPE = "https://www.googleapis.com/auth/drive.file";
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
  /** Tokens renew by themselves (server session, see server-auth.ts). */
  persistent: boolean;
  /** The /api/auth sign-in helper is deployed, so a persistent session is possible. */
  serverAvailable: boolean;
}

export const useAuth = create<AuthState>(() => ({
  token: null,
  needsReconnect: false,
  user: null,
  persistent: false,
  serverAvailable: false,
}));

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

const appScope = () => new URL(import.meta.env.BASE_URL, location.href).href;

let serverStatus: Promise<boolean> | null = null;
/** null = not known yet (or the check failed, e.g. offline) */
let serverEnabled: boolean | null = null;
/** Is the /api/auth function deployed and configured? (In `vite dev` the SPA fallback answers with HTML: false.) */
function checkServer(): Promise<boolean> {
  serverStatus ??= fetch(authUrl(appScope(), "status"), { cache: "no-store" })
    .then(async (r) => {
      const v = r.ok && ((await r.json().catch(() => ({}))) as { enabled?: boolean }).enabled === true;
      serverEnabled = v;
      useAuth.setState({ serverAvailable: v });
      return v;
    })
    .catch(() => {
      serverStatus = null; // network error: ask again next time
      return false;
    });
  return serverStatus;
}

let mode: AuthMode = "browser";
async function setMode(m: AuthMode): Promise<void> {
  mode = m;
  useAuth.setState({ persistent: m === "server" });
  await kvSet(KV.authMode, m);
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
  const tok: StoredToken = { accessToken: r.access_token, expiresAt: Date.now() + expiresIn * 1000 };
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

/** Code flow (GIS always asks for offline access + consent): popup -> code -> /api/auth/exchange. Must start from a tap. */
function requestCode(): Promise<StoredToken> {
  return new Promise<StoredToken>((resolve, reject) => {
    try {
      if (!CLIENT_ID) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");
      if (!window.google?.accounts?.oauth2) throw new Error("Could not load Google Identity Services (offline?)");
      const hint = useAuth.getState().user?.email;
      window.google.accounts.oauth2
        .initCodeClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          ux_mode: "popup",
          select_account: !hint,
          ...(hint ? { login_hint: hint } : {}),
          callback: (r) => {
            if (r.error || !r.code) reject(new Error(r.error_description || r.error || "Google sign-in failed"));
            else exchange(r.code).then(resolve, reject);
          },
          error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Sign-in window was closed" : e.message || e.type)),
        })
        .requestCode();
    } catch (e) {
      reject(e as Error);
    }
  });
}

async function exchange(code: string): Promise<StoredToken> {
  const res = await fetch(authUrl(appScope(), "exchange"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Spodrive": "1" },
    credentials: "same-origin",
    body: JSON.stringify({ code }),
  });
  const j = (await res.json().catch(() => ({}))) as TokenJson & { persistent?: boolean; error?: string };
  const tok = toStoredToken(j);
  if (!res.ok || !tok) throw new Error(`Google sign-in failed (${j.error ?? res.status})`);
  await setMode(j.persistent ? "server" : "browser");
  await setToken(tok);
  useAuth.setState({ needsReconnect: false });
  void fetchUser();
  return tok;
}

/** Interactive sign-in / reconnect: code flow when the server is available, else the token popup. */
async function interactive(prompt: string): Promise<StoredToken> {
  // the status check and GIS were preloaded at boot; only wait when still in flight
  const useServer = serverEnabled ?? (await checkServer());
  if (useServer) {
    await loadGis();
    return requestCode();
  }
  return requestToken(prompt);
}

function requestToken(prompt: string): Promise<StoredToken> {
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
      c.requestAccessToken({ prompt, ...(hint ? { hint } : {}) });
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
  return interactive(hasHint ? "" : "select_account");
}

async function silentServer(): Promise<StoredToken | null> {
  const r = await serverRefresh(appScope());
  if (r === "gone") {
    await setMode("browser");
    if (navigator.onLine) useAuth.setState({ needsReconnect: true });
    return null;
  }
  if (!r) return null; // offline / temporary: keep the session and try again later
  useAuth.setState({ token: r, needsReconnect: false });
  scheduleRefresh();
  return r;
}

let silent: Promise<StoredToken | null> | null = null;
/** Try to get a new token without UI. On failure shows the "Reconnect" banner (when online). */
export function refreshToken(): Promise<StoredToken | null> {
  silent ??= (
    mode === "server"
      ? silentServer()
      : requestToken("").catch(() => {
          if (navigator.onLine) useAuth.setState({ needsReconnect: true });
          return null;
        })
  ).finally(() => {
    silent = null;
  });
  return silent;
}

/** Click handler for the Reconnect banner. */
export async function reconnect(): Promise<boolean> {
  try {
    await interactive("");
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
  // browser mode: no point hammering, the popup can't open without a tap anyway
  const delay = Math.max(mode === "server" ? 1_000 : 10_000, t.expiresAt - Date.now() - REFRESH_BEFORE_MS);
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
  const [token, user, m] = await Promise.all([getToken(), kvGet<UserHint>(KV.userHint), getAuthMode()]);
  mode = m;
  useAuth.setState({ token: token ?? null, user: user ?? null, persistent: m === "server" });
  scheduleRefresh();
  void checkServer();

  const maybeRefresh = () => {
    const t = useAuth.getState().token;
    if (t && navigator.onLine && t.expiresAt - Date.now() < REFRESH_BEFORE_MS) void refreshToken();
  };
  const onVisible = async () => {
    if (document.visibilityState !== "visible") return;
    // the service worker may have refreshed the token meanwhile (it only writes IndexedDB)
    const stored = await getToken();
    if (stored && stored.expiresAt > (useAuth.getState().token?.expiresAt ?? 0)) {
      useAuth.setState({ token: stored, needsReconnect: false });
      scheduleRefresh();
    }
    maybeRefresh();
  };
  document.addEventListener("visibilitychange", () => void onVisible());
  window.addEventListener("online", maybeRefresh);
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.type === "need-token") void refreshToken();
  });
  void preloadGis();
}

export async function signOut(): Promise<void> {
  const t = useAuth.getState().token;
  clearTimeout(refreshTimer);
  if (mode === "server") {
    await fetch(authUrl(appScope(), "logout"), { method: "POST", headers: { "X-Spodrive": "1" }, credentials: "same-origin" }).catch(
      () => undefined,
    );
  }
  mode = "browser";
  await kvDel(KV.authMode);
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
  useAuth.setState({ token: null, needsReconnect: false, user: null, persistent: false });
  await kvDel(KV.token);
}
