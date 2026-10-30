import { create } from "zustand";
import { isLimitedBrowser } from "../lib/device-auth";
import { KV, kvGet, kvSet } from "../lib/db";

export interface Settings {
  lyricsEnabled: boolean;
  prefetchEnabled: boolean;
  /** Now Playing right panels (desktop / TV layout) */
  npLyrics: boolean;
  npPlaylist: boolean;
  /** "auto" turns large text on for Silk / TV browsers */
  largeText: "auto" | "on" | "off";
  /** Keep the page in full screen (re-entered on the next tap when the browser drops it) */
  fullscreen: boolean;
}

const DEFAULTS: Settings = {
  lyricsEnabled: true,
  prefetchEnabled: true,
  npLyrics: true,
  npPlaylist: true,
  largeText: "auto",
  fullscreen: false,
};

interface SettingsState extends Settings {
  hydrated: boolean;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  set(key, value) {
    set({ [key]: value } as Partial<SettingsState>);
    const state = get();
    const saved = {} as Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS) as Array<keyof Settings>) saved[k] = state[k];
    void kvSet(KV.settings, saved);
  },
}));

export async function hydrateSettings(): Promise<void> {
  const saved = await kvGet<Partial<Settings>>(KV.settings);
  useSettings.setState({ ...DEFAULTS, ...saved, hydrated: true });
}

/** Whether the large text mode is on: the setting, with "auto" meaning Silk / TV browsers. */
export function useLargeText(): boolean {
  const mode = useSettings((s) => s.largeText);
  return mode === "auto" ? isLimitedBrowser() : mode === "on";
}
