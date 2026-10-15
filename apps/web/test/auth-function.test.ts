import { describe, expect, it, vi } from "vitest";
import { COOKIE, handleAuth, readCookie } from "../../../netlify/functions/auth";
import { createTokenRequester } from "../src/stream/sources";

const env = { clientId: "cid", clientSecret: "secret" };
const BASE = "https://spodrive.example/api/auth/";

function req(action: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.method === "POST" && !headers.has("x-spodrive")) headers.set("x-spodrive", "1");
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(BASE + action, { ...init, headers });
}

/** Fake Google token endpoint. */
function google(body: Record<string, unknown>, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe("auth function", () => {
  it("reports whether it is configured", async () => {
    expect(await (await handleAuth(req("status"), env)).json()).toEqual({ enabled: true });
    expect(await (await handleAuth(req("status"), {})).json()).toEqual({ enabled: false });
    expect((await handleAuth(req("refresh", { method: "POST" }), {})).status).toBe(501);
  });

  it("rejects requests without the custom header (CSRF) or with GET", async () => {
    const f = google({});
    expect((await handleAuth(req("refresh", { method: "POST", headers: { "x-spodrive": "0" } }), env, f)).status).toBe(400);
    expect((await handleAuth(req("refresh"), env, f)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("exchanges a code and keeps the refresh token in an HttpOnly cookie only", async () => {
    const f = google({ access_token: "at", expires_in: 3599, refresh_token: "rt/1" });
    const res = await handleAuth(req("exchange", { method: "POST", body: JSON.stringify({ code: "c0de" }) }), env, f);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ access_token: "at", expires_in: 3599, persistent: true });
    expect(JSON.stringify(body)).not.toContain("rt/1");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${COOKIE}=rt%2F1`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    const sent = new URLSearchParams(String(f.mock.calls[0]![1]!.body));
    expect(sent.get("redirect_uri")).toBe("postmessage");
    expect(sent.get("client_secret")).toBe("secret");
    expect(sent.get("code")).toBe("c0de");
  });

  it("marks the session as not persistent when Google sends no refresh token", async () => {
    const res = await handleAuth(
      req("exchange", { method: "POST", body: JSON.stringify({ code: "x" }) }),
      env,
      google({ access_token: "at", expires_in: 3600 }),
    );
    expect((await res.json()).persistent).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refreshes with the cookie", async () => {
    const f = google({ access_token: "fresh", expires_in: 3600 });
    const res = await handleAuth(req("refresh", { method: "POST", cookie: `a=b; ${COOKIE}=rt%2F1` }), env, f);
    expect(await res.json()).toEqual({ access_token: "fresh", expires_in: 3600 });
    expect(new URLSearchParams(String(f.mock.calls[0]![1]!.body)).get("refresh_token")).toBe("rt/1");
  });

  it("401 without a session, and clears the cookie when Google revoked the grant", async () => {
    expect((await handleAuth(req("refresh", { method: "POST" }), env, google({}))).status).toBe(401);
    const res = await handleAuth(req("refresh", { method: "POST", cookie: `${COOKIE}=rt` }), env, google({ error: "invalid_grant" }, 400));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("does not drop the session on a temporary Google error", async () => {
    const res = await handleAuth(req("refresh", { method: "POST", cookie: `${COOKIE}=rt` }), env, google({ error: "backend" }, 503));
    expect(res.status).toBe(502);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("logout revokes the refresh token and clears the cookie", async () => {
    const f = google({});
    const res = await handleAuth(req("logout", { method: "POST", cookie: `${COOKIE}=rt` }), env, f);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(String(f.mock.calls[0]![0])).toContain("revoke?token=rt");
  });

  it("readCookie", () => {
    expect(readCookie("a=1; b = 2 ;c=%20x", "b")).toBe("2");
    expect(readCookie("a=1; c=%20x", "c")).toBe(" x");
    expect(readCookie(null, "a")).toBeUndefined();
  });
});

describe("createTokenRequester with a server session", () => {
  const valid = (t: string) => ({ accessToken: t, expiresAt: Date.now() + 3600_000 });

  it("renews through refresh() without asking the page", async () => {
    const notify = vi.fn(async () => undefined);
    const request = createTokenRequester({
      getToken: async () => ({ accessToken: "old", expiresAt: Date.now() - 1 }),
      refresh: async () => valid("new"),
      notify,
    });
    expect((await request("old"))?.accessToken).toBe("new");
    expect(notify).not.toHaveBeenCalled();
  });

  it("falls back to asking the page when refresh fails", async () => {
    let stored = { accessToken: "old", expiresAt: Date.now() - 1 };
    const request = createTokenRequester({
      getToken: async () => stored,
      refresh: async () => {
        throw new Error("offline");
      },
      notify: async () => {
        stored = valid("from-page");
      },
      pollMs: 1,
      timeoutMs: 100,
    });
    expect((await request("old"))?.accessToken).toBe("from-page");
  });
});
