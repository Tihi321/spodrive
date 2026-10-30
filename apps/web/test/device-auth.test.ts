import { describe, expect, it } from "vitest";
import { isLimitedBrowser, nextPollDelay, parseDeviceCode, parseTokenResponse } from "../src/lib/device-auth";

describe("parseTokenResponse", () => {
  it("reads tokens", () => {
    const r = parseTokenResponse({ access_token: "a", expires_in: 3599, refresh_token: "r", scope: "s" });
    expect(r).toEqual({ kind: "tokens", tokens: { accessToken: "a", expiresIn: 3599, refreshToken: "r", scope: "s" } });
  });
  it("defaults the lifetime and leaves a missing refresh token undefined", () => {
    const r = parseTokenResponse({ access_token: "a" });
    expect(r).toMatchObject({ kind: "tokens", tokens: { expiresIn: 3600, refreshToken: undefined } });
  });
  it("maps the polling errors", () => {
    expect(parseTokenResponse({ error: "authorization_pending" })).toEqual({ kind: "pending" });
    expect(parseTokenResponse({ error: "slow_down" })).toEqual({ kind: "slow_down" });
    expect(parseTokenResponse({ error: "access_denied" })).toEqual({ kind: "error", code: "access_denied" });
    expect(parseTokenResponse({ error: "expired_token" })).toEqual({ kind: "error", code: "expired_token" });
    expect(parseTokenResponse({ error: "invalid_grant" })).toEqual({ kind: "error", code: "invalid_grant" });
  });
  it("treats junk as an error", () => {
    expect(parseTokenResponse(null)).toEqual({ kind: "error", code: "unknown" });
    expect(parseTokenResponse("x")).toEqual({ kind: "error", code: "unknown" });
  });
});

describe("parseDeviceCode", () => {
  it("reads the code info", () => {
    const r = parseDeviceCode({ device_code: "d", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 5 }, 1000);
    expect(r).toEqual({ deviceCode: "d", userCode: "ABCD-EFGH", verificationUrl: "https://www.google.com/device", expiresAt: 1000 + 1_800_000, interval: 5 });
  });
  it("rejects incomplete responses", () => {
    expect(parseDeviceCode({ user_code: "x" })).toBeNull();
  });
});

describe("nextPollDelay", () => {
  it("keeps the interval while pending", () => {
    expect(nextPollDelay(5000, "pending")).toBe(5000);
  });
  it("adds 5 s on every slow_down", () => {
    const once = nextPollDelay(5000, "slow_down");
    expect(once).toBe(10_000);
    expect(nextPollDelay(once, "slow_down")).toBe(15_000);
  });
});

describe("isLimitedBrowser", () => {
  const loc = (search = "", hash = "") => ({ search, hash });
  it("detects Silk", () => {
    const silk = "Mozilla/5.0 (Linux; Android 11; AEOKN) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.0.0 Safari/537.36";
    expect(isLimitedBrowser(silk, loc())).toBe(true);
  });
  it("is false for desktop browsers", () => {
    expect(isLimitedBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36", loc())).toBe(false);
  });
  it("honours device=1 in the query or the hash", () => {
    const ua = "Mozilla/5.0 Chrome/120.0";
    expect(isLimitedBrowser(ua, loc("?device=1"))).toBe(true);
    expect(isLimitedBrowser(ua, loc("", "#/?device=1"))).toBe(true);
    expect(isLimitedBrowser(ua, loc("?device=10"))).toBe(false);
  });
});
