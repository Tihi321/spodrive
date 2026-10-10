import { describe, expect, it } from "vitest";
import { isAuthError } from "../src/lib/errors";
import { centeredScrollTop } from "../src/lib/scroll";
import { toast, useToasts } from "../src/state/toasts";

describe("isAuthError", () => {
  it("detects auth failures", () => {
    expect(isAuthError({ status: 401, message: "x" })).toBe(true);
    expect(isAuthError({ status: 403, message: "Insufficient Permission" })).toBe(true);
    expect(isAuthError(new Error("Not signed in to Google"))).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isAuthError({ status: 500, message: "boom" })).toBe(false);
    expect(isAuthError({ status: 403, message: "rate limit exceeded" })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("centeredScrollTop", () => {
  it("centres and clamps", () => {
    expect(centeredScrollTop(500, 40, 200, 1000)).toBe(420);
    expect(centeredScrollTop(10, 40, 200, 1000)).toBe(0);
    expect(centeredScrollTop(980, 40, 200, 1000)).toBe(800);
    expect(centeredScrollTop(50, 40, 200, 150)).toBe(0);
  });
});

describe("toast dedupe", () => {
  it("does not add the same visible message twice", () => {
    useToasts.setState({ items: [] });
    toast("hello");
    toast("hello");
    toast("other");
    expect(useToasts.getState().items.map((t) => t.message)).toEqual(["hello", "other"]);
  });
});
