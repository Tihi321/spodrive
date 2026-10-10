import { create } from "zustand";
import { KV, kvGet, kvSet } from "../lib/db";

export interface Settings {
  lyricsEnabled: boolean;
  prefetchEnabled: boolean;
}

const DEFAULTS: Settings = { lyricsEnabled: true, prefetchEnabled: true };

interface SettingsState extends Settings {
  hydrated: boolean;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  set(key, value) {
    set({ [key]: value } as Partial<SettingsState>);
    const { lyricsEnabled, prefetchEnabled } = get();
    void kvSet(KV.settings, { lyricsEnabled, prefetchEnabled });
  },
}));

export async function hydrateSettings(): Promise<void> {
  const saved = await kvGet<Partial<Settings>>(KV.settings);
  useSettings.setState({ ...DEFAULTS, ...saved, hydrated: true });
}
