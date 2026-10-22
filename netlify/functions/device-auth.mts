/**
 * Proxy for Google's OAuth device flow (TVs and limited-input devices, e.g. Echo Show).
 * It exists only because the token endpoint needs the TV client's secret and Google's device
 * endpoints don't allow browser CORS. It forwards the exchange and stores nothing.
 *
 * POST /api/device-auth  { action: "start" | "poll" | "refresh" | "revoke", ... }
 * Env: GOOGLE_TV_CLIENT_ID, GOOGLE_TV_CLIENT_SECRET (Netlify site environment variables).
 */
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const MAX_BODY = 8 * 1024;
const MAX_FIELD = 2048;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

function originAllowed(origin: string): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol === "http:" && (o.hostname === "localhost" || o.hostname === "127.0.0.1")) return true;
  for (const own of [process.env.URL, process.env.DEPLOY_PRIME_URL]) {
    if (!own) continue;
    try {
      if (new URL(own).origin === o.origin) return true;
    } catch {
      /* ignore a malformed env value */
    }
  }
  return false;
}

/** A non-empty string field within a sane length, or null. */
function field(body: Record<string, unknown>, name: string): string | null {
  const v = body[name];
  return typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD ? v : null;
}

/** Forward a form POST to Google and pass its JSON and status through. */
async function forward(url: string, params: Record<string, string>): Promise<Response> {
  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch {
    return json({ error: "upstream_unreachable" }, 502);
  }
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "upstream_invalid_response" };
    }
  }
  return json(data, res.status);
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });

  const origin = req.headers.get("origin");
  if (!origin || !originAllowed(origin)) return json({ error: "forbidden_origin" }, 403);

  const clientId = process.env.GOOGLE_TV_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_TV_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json({ error: "device_signin_not_configured" }, 501);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "invalid_request" }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  switch (body.action) {
    case "start":
      return forward(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
    case "poll": {
      const deviceCode = field(body, "device_code");
      if (!deviceCode) return json({ error: "invalid_request" }, 400);
      return forward(TOKEN_URL, { client_id: clientId, client_secret: clientSecret, device_code: deviceCode, grant_type: DEVICE_GRANT });
    }
    case "refresh": {
      const refreshToken = field(body, "refresh_token");
      if (!refreshToken) return json({ error: "invalid_request" }, 400);
      return forward(TOKEN_URL, { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
    }
    case "revoke": {
      const token = field(body, "token");
      if (!token) return json({ error: "invalid_request" }, 400);
      return forward(REVOKE_URL, { token });
    }
    default:
      return json({ error: "invalid_request" }, 400);
  }
};

export const config = { path: "/api/device-auth" };
