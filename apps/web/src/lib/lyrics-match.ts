/** Pure helpers for picking the best lrclib search result. */

export interface LrclibItem {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** Max accepted difference (seconds) between our track and a search hit. */
export const MAX_DURATION_DELTA = 8;

/**
 * Choose the best candidate: must have lyrics, duration within tolerance (when known),
 * then prefer synced lyrics, then the closest duration.
 */
export function pickBestMatch(items: readonly LrclibItem[], durationSec: number): LrclibItem | null {
  const known = durationSec > 0;
  const scored = items
    .filter((i) => !i.instrumental && (i.syncedLyrics?.trim() || i.plainLyrics?.trim()))
    .map((i) => ({ i, delta: known && typeof i.duration === "number" ? Math.abs(i.duration - durationSec) : known ? 4 : 0 }))
    .filter((s) => !known || s.delta <= MAX_DURATION_DELTA);
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    const as = a.i.syncedLyrics?.trim() ? 1 : 0;
    const bs = b.i.syncedLyrics?.trim() ? 1 : 0;
    // a clearly closer duration (>2 s) beats synced-ness; otherwise synced first
    if (Math.abs(a.delta - b.delta) > 2) return a.delta - b.delta;
    return bs - as || a.delta - b.delta;
  });
  return scored[0]!.i;
}
