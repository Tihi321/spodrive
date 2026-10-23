import { useEffect, useState } from "react";
import type { Track } from "@spodrive/core";
import { dbGet, dbPut } from "./db";
import { fetchLyricsFor, type LyricsCacheEntry, type LyricsResult, type LyricsStore } from "./lyrics-fetch";
import { useSettings } from "../state/settings";
import { useLibrary } from "./library";
import { useLyricsVersion, userLyricsSource } from "./user-lyrics";

export const idbLyricsStore: LyricsStore = {
  get: (id) => dbGet<LyricsCacheEntry>("lyrics", id),
  put: (id, e) => dbPut("lyrics", id, e),
};

const memo = new Map<string, Promise<LyricsResult>>();
// user lyrics changed (import, remove, other device): forget what was resolved so far
useLyricsVersion.subscribe(() => memo.clear());

export function loadLyrics(track: Track, enabled: boolean, signal?: AbortSignal): Promise<LyricsResult> {
  if (!enabled) return Promise.resolve({ synced: null, plain: null });
  let p = memo.get(track.id);
  if (!p) {
    p = fetchLyricsFor(track, { store: idbLyricsStore, signal, user: userLyricsSource }).then((r) => {
      // don't pin transient failures (nothing cached) in memory
      if (!r.synced && !r.plain) memo.delete(track.id);
      return r;
    });
    memo.set(track.id, p);
    if (memo.size > 50) memo.delete(memo.keys().next().value as string);
  }
  return p;
}

export interface LyricsState {
  status: "disabled" | "loading" | "ready";
  result: LyricsResult;
}

export function useLyrics(trackId: string | undefined | null): LyricsState {
  const track = useLibrary((s) => (trackId ? s.index?.byId.get(trackId) : undefined));
  const enabled = useSettings((s) => s.lyricsEnabled);
  const version = useLyricsVersion((s) => s.version);
  const [state, setState] = useState<LyricsState>({ status: "loading", result: { synced: null, plain: null } });
  useEffect(() => {
    let cancelled = false;
    if (!track) return setState({ status: "ready", result: { synced: null, plain: null } });
    if (!enabled) return setState({ status: "disabled", result: { synced: null, plain: null } });
    setState({ status: "loading", result: { synced: null, plain: null } });
    void loadLyrics(track, true).then((result) => !cancelled && setState({ status: "ready", result }));
    return () => {
      cancelled = true;
    };
  }, [track?.id, enabled, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
