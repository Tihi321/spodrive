import { describe, expect, it } from "vitest";
import {
  append,
  currentId,
  cycleRepeat,
  emptyQueue,
  insertNext,
  jumpTo,
  moveItem,
  nextIndex,
  prevIndex,
  pruneQueue,
  removeAt,
  shuffled,
  startQueue,
  toggleShuffle,
} from "../src/player/queue";

const ids = ["a", "b", "c", "d", "e"];
// deterministic rng
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe("queue", () => {
  it("startQueue plays from index", () => {
    const q = startQueue(ids, 2);
    expect(q.items).toEqual(ids);
    expect(currentId(q)).toBe("c");
  });

  it("startQueue with shuffle puts chosen track first and keeps a permutation", () => {
    const q = startQueue(ids, 3, { shuffle: true, rng: seeded() });
    expect(q.items[0]).toBe("d");
    expect([...q.items].sort()).toEqual(ids);
    expect(q.original).toEqual(ids);
    expect(q.index).toBe(0);
  });

  it("shuffled returns a permutation without mutating input", () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = shuffled(src, seeded(7));
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
  });

  it("toggleShuffle on keeps current, off restores original order and position", () => {
    let q = startQueue(ids, 2);
    q = toggleShuffle(q, seeded(3));
    expect(q.shuffle).toBe(true);
    expect(currentId(q)).toBe("c");
    expect(q.index).toBe(0);
    q = jumpTo(q, 2);
    const cur = currentId(q)!;
    q = toggleShuffle(q);
    expect(q.shuffle).toBe(false);
    expect(q.items).toEqual(ids);
    expect(currentId(q)).toBe(cur);
    expect(q.original).toBeNull();
  });

  it("nextIndex honours repeat modes", () => {
    let q = startQueue(ids, 4);
    expect(nextIndex(q, true)).toBeNull();
    expect(nextIndex(q, false)).toBeNull();
    q = { ...q, repeat: "all" };
    expect(nextIndex(q, true)).toBe(0);
    q = { ...q, repeat: "one" };
    expect(nextIndex(q, true)).toBe(4); // auto: replay
    expect(nextIndex(q, false)).toBe(0); // manual next wraps
    q = startQueue(ids, 1, { repeat: "one" });
    expect(nextIndex(q, false)).toBe(2);
    expect(nextIndex(emptyQueue(), true)).toBeNull();
  });

  it("prevIndex", () => {
    expect(prevIndex(startQueue(ids, 3))).toBe(2);
    expect(prevIndex(startQueue(ids, 0))).toBe(0);
    expect(prevIndex(startQueue(ids, 0, { repeat: "all" }))).toBe(4);
  });

  it("cycleRepeat", () => {
    expect(cycleRepeat("off")).toBe("all");
    expect(cycleRepeat("all")).toBe("one");
    expect(cycleRepeat("one")).toBe("off");
  });

  it("insertNext / append", () => {
    let q = startQueue(ids, 1);
    q = insertNext(q, "x");
    expect(q.items).toEqual(["a", "b", "x", "c", "d", "e"]);
    q = append(q, "y");
    expect(q.items.at(-1)).toBe("y");
    expect(currentId(q)).toBe("b");
    expect(append(emptyQueue(), "z")).toMatchObject({ items: ["z"], index: 0 });
  });

  it("insert/append while shuffled also reach the original order", () => {
    let q = startQueue(ids, 0, { shuffle: true, rng: seeded(5) });
    q = insertNext(q, "x");
    q = append(q, "y");
    expect(q.items[1]).toBe("x");
    q = toggleShuffle(q);
    expect(q.items).toEqual(["a", "x", "b", "c", "d", "e", "y"]);
  });

  it("removeAt adjusts the index", () => {
    const q = startQueue(ids, 2);
    let r = removeAt(q, 0);
    expect(r.state.items).toEqual(["b", "c", "d", "e"]);
    expect(currentId(r.state)).toBe("c");
    r = removeAt(q, 2);
    expect(r.wasCurrent).toBe(true);
    expect(currentId(r.state)).toBe("d");
    r = removeAt(startQueue(ids, 4), 4);
    expect(currentId(r.state)).toBe("d");
    r = removeAt(startQueue(["a"], 0), 0);
    expect(r.state.index).toBe(-1);
    expect(removeAt(q, 9).state).toBe(q);
  });

  it("moveItem keeps pointing at the same track", () => {
    const q = startQueue(ids, 2);
    for (const [from, to] of [[0, 4], [4, 0], [2, 0], [0, 2], [1, 3], [3, 1]] as const) {
      const m = moveItem(q, from, to);
      expect(currentId(m)).toBe("c");
      expect([...m.items].sort()).toEqual(ids);
    }
    expect(moveItem(q, 0, 4).items).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("pruneQueue drops missing ids", () => {
    const q = startQueue(ids, 2);
    const p = pruneQueue(q, (id) => id !== "a" && id !== "d");
    expect(p.items).toEqual(["b", "c", "e"]);
    expect(currentId(p)).toBe("c");
    expect(pruneQueue(q, () => false).index).toBe(-1);
  });
});
