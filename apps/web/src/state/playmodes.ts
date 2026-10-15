/**
 * Per playlist / folder play mode: shuffle on/off and repeat on/off. Kept on this device.
 * Keys: "playlist:<id>", "folder:<sourceId>".
 */
import { create } from "zustand";
import { KV, kvGet, kvSet } from "../lib/db";

export interface PlayMode {
  shuffle: boolean;
  repeat: boolean;
}

export const DEFAULT_MODE: PlayMode = { shuffle: false, repeat: false };

export const playlistKey = (id: string) => `playlist:${id}`;
export const folderKey = (id: string) => `folder:${id}`;

export const usePlayModes = create<{ modes: Record<string, PlayMode> }>(() => ({ modes: {} }));

export const getPlayMode = (key: string): PlayMode => usePlayModes.getState().modes[key] ?? DEFAULT_MODE;

export function setPlayMode(key: string, patch: Partial<PlayMode>): void {
  const cur = getPlayMode(key);
  const next = { ...cur, ...patch };
  if (next.shuffle === cur.shuffle && next.repeat === cur.repeat) return;
  usePlayModes.setState((s) => ({ modes: { ...s.modes, [key]: next } }));
  void kvSet(KV.playModes, usePlayModes.getState().modes).catch(() => undefined);
}

export async function hydratePlayModes(): Promise<void> {
  const saved = await kvGet<Record<string, PlayMode>>(KV.playModes);
  if (saved) usePlayModes.setState({ modes: saved });
}
