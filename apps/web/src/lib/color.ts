/** Dominant colour of a cover (small canvas sampling), used for background gradients. */
import { useEffect, useState } from "react";

export type RGB = [number, number, number];
export const DEFAULT_COLOR: RGB = [48, 52, 64];

/** Pick a dominant, reasonably vivid colour from RGBA pixel data (pure, testable). */
export function pickDominant(data: ArrayLike<number>): RGB {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 24) continue; // near black
    const sat = max === 0 ? 0 : (max - min) / max;
    const light = (max + min) / 510;
    // favour saturated, mid-brightness pixels; keep a small floor so greyscale covers still work
    const w = 0.15 + sat * 1.5 * (1 - Math.abs(light - 0.5));
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    cur.w += w;
    cur.r += r * w;
    cur.g += g * w;
    cur.b += b * w;
    buckets.set(key, cur);
  }
  let best: { w: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
  if (!best) return DEFAULT_COLOR;
  return [Math.round(best.r / best.w), Math.round(best.g / best.w), Math.round(best.b / best.w)];
}

/** Darken (factor < 1) a colour. */
export function shade([r, g, b]: RGB, factor: number): RGB {
  return [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];
}
export const rgb = ([r, g, b]: RGB, alpha?: number) =>
  alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;

const cache = new Map<string, Promise<RGB>>();

export function dominantColor(url: string): Promise<RGB> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<RGB>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const size = 32;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(DEFAULT_COLOR);
          ctx.drawImage(img, 0, 0, size, size);
          resolve(pickDominant(ctx.getImageData(0, 0, size, size).data));
        } catch {
          resolve(DEFAULT_COLOR);
        }
      };
      img.onerror = () => resolve(DEFAULT_COLOR);
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

export function useCoverColor(url: string | null): RGB {
  const [c, setC] = useState<RGB>(DEFAULT_COLOR);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setC(DEFAULT_COLOR);
      return;
    }
    void dominantColor(url).then((x) => !cancelled && setC(x));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return c;
}
