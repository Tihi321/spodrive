/**
 * Google OAuth device flow for TVs and limited-input browsers (Echo Show / Silk): the screen shows a short code,
 * the user approves it on a phone at google.com/device, and we poll until we get tokens.
 * The token endpoint needs the TV client's secret, so every call goes through the Netlify function in
 * netlify/functions/device-auth.mts.
 */
const ENDPOINT = "/api/device-auth";
const SLOW_DOWN_MS = 5_000;
const DEFAULT_INTERVAL_S = 5;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** epoch ms */
  expiresAt: number;
  /** seconds between polls */
  interval: number;
}

export interface DeviceTokens {
  accessToken: string;
  /** seconds */
  expiresIn: number;
  refreshToken?: string;
  scope?: string;
}

/** `code` is Google's error (invalid_grant, access_denied, expired_token...) or ours (device_signin_not_configured, network). */
export class DeviceAuthError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? deviceErrorMessage(code));
    this.name = "DeviceAuthError";
  }
}

export function deviceErrorMessage(code: string): string {
  switch (code) {
    case "device_signin_not_configured":
      return "Sign in with a code is not set up on this site yet.";
    case "access_denied":
      return "Sign-in was denied on the other device.";
    case "expired_token":
      return "The code expired. Get a new one.";
    case "invalid_grant":
      return "Google session expired. Sign in again.";
    case "network":
      return "Could not reach the sign-in service. Check the connection and try again.";
    default:
      return "Sign-in with a code failed. Try again.";
  }
}

export type TokenPoll =
  | { kind: "tokens"; tokens: DeviceTokens }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "error"; code: string };

/** Interpret Google's token endpoint JSON (as passed through by the function). Pure. */
export function parseTokenResponse(body: unknown): TokenPoll {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.access_token === "string" && b.access_token) {
    const expiresIn = Number(b.expires_in);
    return {
      kind: "tokens",
      tokens: {
        accessToken: b.access_token,
        expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
        refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : undefined,
        scope: typeof b.scope === "string" ? b.scope : undefined,
      },
    };
  }
  if (b.error === "authorization_pending") return { kind: "pending" };
  if (b.error === "slow_down") return { kind: "slow_down" };
  return { kind: "error", code: typeof b.error === "string" && b.error ? b.error : "unknown" };
}

/** Parse the response of the "start" action. Pure. */
export function parseDeviceCode(body: unknown, now = Date.now()): DeviceCode | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const url = b.verification_url ?? b.verification_uri;
  if (typeof b.device_code !== "string" || typeof b.user_code !== "string" || typeof url !== "string") return null;
  const expiresIn = Number(b.expires_in);
  const interval = Number(b.interval);
  return {
    deviceCode: b.device_code,
    userCode: b.user_code,
    verificationUrl: url,
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800) * 1000,
    interval: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_S,
  };
}

/** Delay in ms before the next poll: the interval Google gave, plus 5 s each time it says slow_down. */
export function nextPollDelay(currentMs: number, result: TokenPoll["kind"]): number {
  return result === "slow_down" ? currentMs + SLOW_DOWN_MS : currentMs;
}

/** True on browsers where the Google popup sign-in does not work (Echo Show's Silk), or with `?device=1`. */
export function isLimitedBrowser(ua: string = navigator.userAgent, loc: Pick<Location, "search" | "hash"> = location): boolean {
  if (/\bSilk\//.test(ua)) return true;
  return /[?&]device=1(?:&|$)/.test(loc.search) || /[?&]device=1(?:&|$)/.test(loc.hash);
}

async function call(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    throw new DeviceAuthError("network");
  }
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Ask for a new code. */
export async function startDeviceSignIn(): Promise<DeviceCode> {
  const { status, body } = await call({ action: "start" });
  const info = status === 200 ? parseDeviceCode(body) : null;
  if (info) return info;
  const code = (body as { error?: unknown } | null)?.error;
  throw new DeviceAuthError(status === 501 ? "device_signin_not_configured" : typeof code === "string" ? code : "unknown");
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

/**
 * Poll until the user approves. Honours the interval, backs off on slow_down, and rejects with a DeviceAuthError
 * on access_denied / expired_token. Aborting rejects with an AbortError.
 */
export async function pollDeviceSignIn(info: DeviceCode, signal: AbortSignal): Promise<DeviceTokens> {
  let delay = info.interval * 1000;
  for (;;) {
    await sleep(delay, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() > info.expiresAt) throw new DeviceAuthError("expired_token");
    let result: TokenPoll;
    try {
      const { body } = await call({ action: "poll", device_code: info.deviceCode });
      result = parseTokenResponse(body);
    } catch {
      continue; // transient network error: try again until the code expires
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (result.kind === "tokens") return result.tokens;
    if (result.kind === "error") throw new DeviceAuthError(result.code);
    delay = nextPollDelay(delay, result.kind);
  }
}

/** Exchange a refresh token for a new access token. Rejects with code `invalid_grant` when it was revoked or expired. */
export async function refreshDeviceToken(refreshToken: string): Promise<DeviceTokens> {
  const { body } = await call({ action: "refresh", refresh_token: refreshToken });
  const r = parseTokenResponse(body);
  if (r.kind === "tokens") return { ...r.tokens, refreshToken: r.tokens.refreshToken ?? refreshToken };
  throw new DeviceAuthError(r.kind === "error" ? r.code : "unknown");
}

/** Best effort: revoke a refresh or access token. */
export async function revokeDeviceToken(token: string): Promise<void> {
  try {
    await call({ action: "revoke", token });
  } catch {
    /* best effort */
  }
}
