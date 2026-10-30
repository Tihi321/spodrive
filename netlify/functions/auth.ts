/**
 * Keeps the Google session alive without popups.
 *
 * The page signs in with the GIS *code* flow (always access_type=offline + prompt=consent), posts the
 * code here, and we exchange it with the client secret. The refresh token never reaches JavaScript:
 * it lives in an HttpOnly cookie scoped to /api/auth, and both the page and the service worker call
 * /api/auth/refresh for fresh access tokens (also with the screen off, where a popup can't open).
 *
 * Routes (all POST with header `X-Spodrive: 1`, except status):
 *   GET  /api/auth/status    -> { enabled }
 *   POST /api/auth/exchange  { code } -> { access_token, expires_in, scope }   (sets the cookie)
 *   POST /api/auth/refresh   -> { access_token, expires_in, scope } | 401
 *   POST /api/auth/logout    revokes the refresh token, clears the cookie
 *
 * Env (Netlify site settings): GOOGLE_CLIENT_ID (or VITE_GOOGLE_CLIENT_ID), GOOGLE_CLIENT_SECRET.
 */

export const COOKIE = "spodrive_rt";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Chrome caps cookie lifetime at 400 days. */
const MAX_AGE = 400 * 24 * 60 * 60;

export interface AuthEnv {
  clientId?: string;
  clientSecret?: string;
}

type Fetch = typeof fetch;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const sessionCookie = (value: string, maxAge = MAX_AGE) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const clearCookie = () => sessionCookie("", 0);

async function tokenRequest(f: Fetch, params: Record<string, string>) {
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    refresh_token?: string;
    error?: string;
  };
  return { ok: res.ok, status: res.status, body };
}

export async function handleAuth(req: Request, env: AuthEnv, f: Fetch = fetch): Promise<Response> {
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const { clientId, clientSecret } = env;
  const enabled = !!(clientId && clientSecret);

  if (action === "status") return json({ enabled });
  if (!enabled) return json({ error: "not_configured" }, 501);
  // custom header: a cross-site form or <img> can't set it, so this doubles as CSRF protection
  if (req.method !== "POST" || req.headers.get("x-spodrive") !== "1") return json({ error: "bad_request" }, 400);

  if (action === "exchange") {
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    if (!code) return json({ error: "missing_code" }, 400);
    const r = await tokenRequest(f, {
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: "postmessage", // GIS popup code flow
      grant_type: "authorization_code",
    });
    if (!r.ok || !r.body.access_token) return json({ error: r.body.error ?? "exchange_failed" }, 400);
    const headers: Record<string, string> = r.body.refresh_token ? { "Set-Cookie": sessionCookie(r.body.refresh_token) } : {};
    return json(
      { access_token: r.body.access_token, expires_in: r.body.expires_in ?? 3600, scope: r.body.scope, persistent: !!r.body.refresh_token },
      200,
      headers,
    );
  }

  const rt = readCookie(req.headers.get("cookie"), COOKIE);

  if (action === "refresh") {
    if (!rt) return json({ error: "no_session" }, 401);
    const r = await tokenRequest(f, {
      refresh_token: rt,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "refresh_token",
    });
    if (r.ok && r.body.access_token) return json({ access_token: r.body.access_token, expires_in: r.body.expires_in ?? 3600, scope: r.body.scope });
    // revoked / expired grant: the session is gone for good
    if (r.body.error === "invalid_grant") return json({ error: "invalid_grant" }, 401, { "Set-Cookie": clearCookie() });
    return json({ error: r.body.error ?? "refresh_failed" }, 502);
  }

  if (action === "logout") {
    if (rt) {
      await f(`${REVOKE_URL}?token=${encodeURIComponent(rt)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }).catch(() => undefined);
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  return json({ error: "not_found" }, 404);
}

export default (req: Request) =>
  handleAuth(req, {
    clientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "").trim() || undefined,
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim() || undefined,
  });

export const config = { path: "/api/auth/*" };
