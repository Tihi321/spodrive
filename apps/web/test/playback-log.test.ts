import { describe, expect, it } from "vitest";
import { formatLog, RingLog, type LogEntry } from "../src/lib/playback-log";

const e = (n: number, hidden = false): LogEntry => ({ t: n, ev: `ev${n}`, hidden });

describe("RingLog", () => {
  it("keeps only the newest entries up to capacity", () => {
    const r = new RingLog(3);
    for (let i = 1; i <= 5; i++) r.push(e(i));
    expect(r.entries.map((x) => x.t)).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
  });
  it("prepends older entries and trims the oldest", () => {
    const r = new RingLog(4);
    r.push(e(5));
    r.push(e(6));
    r.prepend([e(1), e(2), e(3)]);
    expect(r.entries.map((x) => x.t)).toEqual([2, 3, 5, 6]);
  });
  it("clears", () => {
    const r = new RingLog(3);
    r.push(e(1));
    r.clear();
    expect(r.size).toBe(0);
  });
  it("formats entries", () => {
    const text = formatLog([{ t: 0, ev: "ended", detail: "id=1", hidden: true }, e(1)]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} H ended id=1$/);
    expect(lines[1]).toMatch(/ V ev1$/);
  });
});
