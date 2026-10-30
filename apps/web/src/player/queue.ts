/** Pure queue / shuffle / repeat logic. No DOM, no audio. */

export type Repeat = "off" | "all" | "one";

export interface QueueState {
  /** Track ids in play order (shuffled order when shuffle is on). */
  items: string[];
  /** Index of the current item, -1 when empty. */
  index: number;
  /** Original (unshuffled) order, kept while shuffle is on so it can be restored. */
  original: string[] | null;
  shuffle: boolean;
  repeat: Repeat;
}

export type Rng = () => number;

export const emptyQueue = (): QueueState => ({ items: [], index: -1, original: null, shuffle: false, repeat: "off" });

/** Fisher-Yates, returns a new array. */
export function shuffled<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export const currentId = (q: QueueState): string | undefined => (q.index >= 0 ? q.items[q.index] : undefined);

/** Start playing `ids` at `index`. With shuffle the chosen track goes first and the rest are shuffled. */
export function startQueue(
  ids: readonly string[],
  index: number,
  opts: { shuffle?: boolean; repeat?: Repeat; rng?: Rng } = {},
): QueueState {
  const repeat = opts.repeat ?? "off";
  if (ids.length === 0) return { ...emptyQueue(), repeat };
  const i = Math.min(Math.max(index, 0), ids.length - 1);
  if (opts.shuffle) {
    const cur = ids[i]!;
    const rest = ids.filter((_, k) => k !== i);
    return { items: [cur, ...shuffled(rest, opts.rng)], index: 0, original: ids.slice(), shuffle: true, repeat };
  }
  return { items: ids.slice(), index: i, original: null, shuffle: false, repeat };
}

export function toggleShuffle(q: QueueState, rng: Rng = Math.random): QueueState {
  if (!q.shuffle) {
    if (q.items.length === 0) return { ...q, shuffle: true, original: [] };
    const cur = q.items[q.index]!;
    const rest = q.items.filter((_, k) => k !== q.index);
    return { ...q, items: [cur, ...shuffled(rest, rng)], index: 0, original: q.items.slice(), shuffle: true };
  }
  const original = q.original ?? q.items;
  const cur = currentId(q);
  let idx = cur === undefined ? -1 : original.indexOf(cur);
  if (idx < 0 && original.length > 0) idx = 0;
  return { ...q, items: original.slice(), index: original.length ? idx : -1, original: null, shuffle: false };
}

export function cycleRepeat(r: Repeat): Repeat {
  return r === "off" ? "all" : r === "all" ? "one" : "off";
}

/**
 * Index to play after the current one. `auto` = the track ended by itself
 * (repeat-one replays it); a manual "next" always advances.
 * Returns null at the end of the queue (repeat off).
 */
export function nextIndex(q: QueueState, auto: boolean): number | null {
  if (q.items.length === 0) return null;
  if (auto && q.repeat === "one") return q.index;
  if (q.index + 1 < q.items.length) return q.index + 1;
  return q.repeat === "off" ? null : 0;
}

/** Index for the "previous" action (the >3 s restart rule is applied by the caller). */
export function prevIndex(q: QueueState): number {
  if (q.items.length === 0) return -1;
  if (q.index > 0) return q.index - 1;
  return q.repeat === "all" ? q.items.length - 1 : 0;
}

export function jumpTo(q: QueueState, index: number): QueueState {
  if (index < 0 || index >= q.items.length) return q;
  return { ...q, index };
}

/** Insert right after the current track. */
export function insertNext(q: QueueState, id: string): QueueState {
  if (q.items.length === 0) return { ...q, items: [id], index: 0, original: q.shuffle ? [id] : null };
  const items = q.items.slice();
  items.splice(q.index + 1, 0, id);
  let original = q.original;
  if (original) {
    original = original.slice();
    const cur = currentId(q);
    const at = cur === undefined ? -1 : original.indexOf(cur);
    original.splice(at + 1, 0, id);
  }
  return { ...q, items, original };
}

export function append(q: QueueState, id: string): QueueState {
  if (q.items.length === 0) return { ...q, items: [id], index: 0, original: q.shuffle ? [id] : null };
  return { ...q, items: [...q.items, id], original: q.original ? [...q.original, id] : null };
}

export function removeAt(q: QueueState, i: number): { state: QueueState; wasCurrent: boolean } {
  if (i < 0 || i >= q.items.length) return { state: q, wasCurrent: false };
  const id = q.items[i]!;
  const items = q.items.filter((_, k) => k !== i);
  let original = q.original;
  if (original) {
    const at = original.indexOf(id);
    if (at >= 0) original = original.filter((_, k) => k !== at);
  }
  const wasCurrent = i === q.index;
  let index = q.index;
  if (items.length === 0) index = -1;
  else if (i < q.index) index = q.index - 1;
  else if (wasCurrent) index = Math.min(i, items.length - 1);
  return { state: { ...q, items, index, original }, wasCurrent };
}

export function moveItem(q: QueueState, from: number, to: number): QueueState {
  const n = q.items.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return q;
  const items = q.items.slice();
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it!);
  let index = q.index;
  if (from === q.index) index = to;
  else if (from < q.index && to >= q.index) index--;
  else if (from > q.index && to <= q.index) index++;
  return { ...q, items, index };
}

/** Drop ids that no longer exist (e.g. removed from the library). Keeps the current track if possible. */
export function pruneQueue(q: QueueState, exists: (id: string) => boolean): QueueState {
  const cur = currentId(q);
  const items = q.items.filter(exists);
  const original = q.original ? q.original.filter(exists) : null;
  let index = cur !== undefined && exists(cur) ? items.indexOf(cur) : Math.min(q.index, items.length - 1);
  if (items.length === 0) index = -1;
  return { ...q, items, original, index };
}

/**
 * Like nextIndex, but skips tracks for which `ok` is false (e.g. not downloaded while offline).
 * An unplayable repeat-one track advances like a manual "next". Null when nothing playable is left.
 */
export function nextPlayableIndex(q: QueueState, auto: boolean, ok: (id: string) => boolean): number | null {
  let i = nextIndex(q, auto);
  const seen = new Set<number>();
  while (i !== null && !ok(q.items[i]!)) {
    if (seen.has(i)) return null;
    seen.add(i);
    i = nextIndex({ ...q, index: i }, false);
  }
  return i;
}

/** Like prevIndex, but skips unplayable tracks. Falls back to the current index when nothing earlier is playable. */
export function prevPlayableIndex(q: QueueState, ok: (id: string) => boolean): number {
  let i = prevIndex(q);
  const seen = new Set<number>();
  while (i >= 0 && i !== q.index && !ok(q.items[i]!)) {
    if (seen.has(i)) return q.index;
    seen.add(i);
    const p = prevIndex({ ...q, index: i });
    if (p === i) return q.index; // reached the start
    i = p;
  }
  return i;
}

/** Set shuffle to a given state (no-op when it already is). */
export const setShuffle = (q: QueueState, on: boolean, rng?: Rng): QueueState => (q.shuffle === on ? q : toggleShuffle(q, rng));
