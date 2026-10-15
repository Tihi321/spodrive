import { describe, expect, it } from "vitest";
import { nextPlayableIndex, prevPlayableIndex, setShuffle, startQueue } from "../src/player/queue";

const ids = ["a", "b", "c", "d", "e"];
const only = (...ok: string[]) => (id: string) => ok.includes(id);

describe("nextPlayableIndex", () => {
  it("behaves like nextIndex when everything is playable", () => {
    expect(nextPlayableIndex(startQueue(ids, 1), false, () => true)).toBe(2);
    expect(nextPlayableIndex(startQueue(ids, 4), false, () => true)).toBeNull();
  });

  it("skips unplayable tracks", () => {
    expect(nextPlayableIndex(startQueue(ids, 0), false, only("a", "d"))).toBe(3);
  });

  it("returns null at the end when nothing later is playable (repeat off)", () => {
    expect(nextPlayableIndex(startQueue(ids, 1), false, only("a", "b"))).toBeNull();
  });

  it("wraps around with repeat all", () => {
    expect(nextPlayableIndex(startQueue(ids, 3, { repeat: "all" }), false, only("b", "d"))).toBe(1);
  });

  it("returns the current index with repeat all when it is the only playable one", () => {
    expect(nextPlayableIndex(startQueue(ids, 2, { repeat: "all" }), false, only("c"))).toBe(2);
  });

  it("does not loop forever when nothing is playable", () => {
    expect(nextPlayableIndex(startQueue(ids, 2, { repeat: "all" }), false, () => false)).toBeNull();
  });

  it("repeat one replays a playable track and moves on from an unplayable one", () => {
    expect(nextPlayableIndex(startQueue(ids, 2, { repeat: "one" }), true, () => true)).toBe(2);
    expect(nextPlayableIndex(startQueue(ids, 2, { repeat: "one" }), true, only("e"))).toBe(4);
  });
});

describe("prevPlayableIndex", () => {
  it("skips unplayable tracks backwards", () => {
    expect(prevPlayableIndex(startQueue(ids, 4), only("b", "e"))).toBe(1);
  });

  it("stays on the current track when nothing earlier is playable", () => {
    expect(prevPlayableIndex(startQueue(ids, 3), only("d"))).toBe(3);
  });

  it("wraps with repeat all", () => {
    expect(prevPlayableIndex(startQueue(ids, 1, { repeat: "all" }), only("b", "d"))).toBe(3);
  });
});

describe("setShuffle", () => {
  it("is a no-op when already in that state", () => {
    const q = startQueue(ids, 0);
    expect(setShuffle(q, false)).toBe(q);
  });

  it("turns shuffle on and off keeping the current track", () => {
    const q = startQueue(ids, 2);
    const on = setShuffle(q, true);
    expect(on.shuffle).toBe(true);
    expect(on.items[on.index]).toBe("c");
    const off = setShuffle(on, false);
    expect(off.items).toEqual(ids);
    expect(off.items[off.index]).toBe("c");
  });
});
