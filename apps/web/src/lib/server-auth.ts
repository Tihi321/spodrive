/**
 * Client side of the /api/auth Netlify Function (see netlify/functions/auth.ts).
 * Shared by the page and the service worker, so it must stay free of `window`/`document`.
 */
import { KV, kvGet, kvSet, type StoredToken } from "./db";

/** "server": refresh token held in an HttpOnly cookie (no popups); "browser": GIS token flow (1 h, popup to renew). */
export type AuthMode = "server" | "browser";

export const authUrl = (scope: string, action: string) => new URL(`api/auth/${action}`, scope).href;

export const getAuthMode = async (): Promise<AuthMode> => ((await kvGet<AuthMode>(KV.authMode)) === "server" ? "server" : "browser");

export interface TokenJson {
  access_token?: string;
  expires_in?: number;
}

export const toStoredToken = (j: TokenJson): StoredToken | undefined =>
  j.access_token ? { accessToken: j.access_token, expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000 } : undefined;

/**
 * New access token from the server session, stored in IndexedDB.
 * "gone" = the session no longer exists (signed out elsewhere, access revoked): a new sign-in is needed.
 * undefined = temporary failure (offline, server error).
 */
export async function serverRefresh(scope: string, f: typeof fetch = fetch): Promise<StoredToken | "gone" | undefined> {
  let res: Response;
  try {
    res = await f(authUrl(scope, "refresh"), { method: "POST", headers: { "X-Spodrive": "1" }, credentials: "same-origin" });
  } catch {
    return undefined;
  }
  if (res.status === 401) return "gone";
  if (!res.ok) return undefined;
  const tok = toStoredToken((await res.json().catch(() => ({}))) as TokenJson);
  if (tok) await kvSet(KV.token, tok);
  return tok;
}
