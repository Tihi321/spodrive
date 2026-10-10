export interface LrcLine {
  timeMs: number;
  text: string;
}

const TIME_TAG = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

export function parseLrc(text: string): LrcLine[] {
  const out: LrcLine[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    const off = OFFSET_TAG.exec(line);
    if (off) {
      offset = parseInt(off[1]!, 10);
      continue;
    }
    const times: number[] = [];
    for (;;) {
      const m = TIME_TAG.exec(line);
      if (!m) break;
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      times.push((parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)) * 1000 + frac);
      line = line.slice(m[0].length);
    }
    if (times.length === 0) continue; // metadata or junk
    const t = line.trim();
    for (const ms of times) out.push({ timeMs: ms, text: t });
  }
  // Positive offset => lyrics appear earlier (LRC spec).
  const lines = out.map((l) => ({ timeMs: Math.max(0, l.timeMs - offset), text: l.text }));
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the last line with timeMs <= t, or -1 if before the first line. */
export function activeLineIndex(lines: LrcLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeMs <= timeMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
