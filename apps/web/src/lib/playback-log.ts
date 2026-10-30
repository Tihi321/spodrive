/** Playback event log: ring buffer kept in memory, persisted (throttled) to IndexedDB so it survives a reload. */
import { create } from "zustand";
import { KV, kvGet, kvSet } from "./db";

export interface LogEntry {
  /** epoch ms */
  t: number;
  ev: string;
  detail?: string;
  hidden: boolean;
}

export const LOG_CAPACITY = 300;
const SAVE_EVERY_MS = 5000;

/** Pure ring-buffer logic (no I/O). */
export class RingLog {
  private items: LogEntry[] = [];
  constructor(private capacity = LOG_CAPACITY) {}

  push(e: LogEntry): void {
    this.items.push(e);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  /** Replace the contents with `older` followed by what is already here (used when loading the persisted log). */
  prepend(older: LogEntry[]): void {
    this.items = [...older, ...this.items].slice(-this.capacity);
  }
  clear(): void {
    this.items = [];
  }
  get entries(): readonly LogEntry[] {
    return this.items;
  }
  get size(): number {
    return this.items.length;
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return `${time} ${e.hidden ? "H" : "V"} ${e.ev}${e.detail ? ` ${e.detail}` : ""}`;
}
export function formatLog(entries: readonly LogEntry[]): string {
  return entries.map(formatEntry).join("\n");
}

const ring = new RingLog();
/** Entry count, for the settings UI. */
export const useLogCount = create<{ n: number }>(() => ({ n: 0 }));

let dirty = false;
let lastSave = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let inited = false;

async function save(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  lastSave = Date.now();
  try {
    await kvSet(KV.playbackLog, ring.entries.slice());
  } catch {
    /* best effort */
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  const wait = Math.max(0, SAVE_EVERY_MS - (Date.now() - lastSave));
  saveTimer = setTimeout(() => void save(), wait);
}

export function log(ev: string, detail?: string): void {
  const hidden = typeof document !== "undefined" && document.hidden;
  ring.push({ t: Date.now(), ev, detail, hidden });
  useLogCount.setState({ n: ring.size });
  scheduleSave();
}

export const getLogEntries = (): readonly LogEntry[] => ring.entries;
export const getLogText = (): string => formatLog(ring.entries);

export function clearLog(): void {
  ring.clear();
  useLogCount.setState({ n: 0 });
  dirty = true;
  void save();
}

/** Load the log persisted before this page load and start flushing on hide. */
export async function initPlaybackLog(): Promise<void> {
  if (inited) return;
  inited = true;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      log(document.hidden ? "visibility hidden" : "visibility visible");
      if (document.hidden) void save();
    });
  }
  try {
    const old = await kvGet<LogEntry[]>(KV.playbackLog);
    if (Array.isArray(old) && old.length) {
      ring.prepend(old);
      useLogCount.setState({ n: ring.size });
    }
  } catch {
    /* ignore */
  }
  log("log init");
}
