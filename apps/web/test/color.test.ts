import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR, pickDominant, shade } from "../src/lib/color";

function px(r: number, g: number, b: number, n: number, a = 255): number[] {
  return Array.from({ length: n }, () => [r, g, b, a]).flat();
}

describe("color", () => {
  it("picks the dominant vivid colour over a larger grey area", () => {
    const data = [...px(120, 120, 120, 60), ...px(220, 30, 40, 40)];
    const [r, g, b] = pickDominant(data);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });
  it("ignores transparent and near-black pixels", () => {
    expect(pickDominant([...px(255, 0, 0, 20, 0), ...px(5, 5, 5, 20)])).toEqual(DEFAULT_COLOR);
  });
  it("shade darkens", () => {
    expect(shade([100, 50, 200], 0.5)).toEqual([50, 25, 100]);
  });
});
