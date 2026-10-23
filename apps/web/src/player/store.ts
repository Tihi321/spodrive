/** Player state (zustand) + glue between queue logic, the audio engine, media session and persistence. */
import { create } from "zustand";
import type { Track } from "@spodrive/core";
import { KV, kvGet, kvSet } from "../lib/db";
import { initPlaybackLog } from "../lib/playback-log";
import { useLibrary } from "../lib/library";
import { getCoverUrl } from "../lib/covers";
import { prefetchTrack } from "../lib/offline";
import { useSettings } from "../state/settings";
import { toast } from "../state/toasts";
import { PlayerEngine } from "./engine";
import * as ms from "./mediasession";
import {
  append,
  currentId,
  cycleRepeat,
  emptyQueue,
  insertNext,
  jumpTo,
  moveItem,
  nextIndex,
  prevIndex,
  pruneQueue,
  removeAt,
  startQueue,
  toggleShuffle,
  type QueueState,
} from "./queue";

interface PlayerState {
  queue: QueueState;
  trackId: string | null;
  playing: boolean;
  buffering: boolean;
  volume: number;
  /** "Playing from ..." label */
  source: string;
  /** Ids of the whole list that was started (playlist, album, ...) in its original order; empty for older saved state. */
  context: string[];
  /** True when the audio element has a track loaded (false after restore until first play). */
  loaded: boolean;
}

/** Fast-changing time values live in their own store so only scrubbers/lyrics re-render. */
interface ProgressState {
  position: number;
  duration: number;
}
export const useProgress = create<ProgressState>(() => ({ position: 0, duration: 0 }));

export const usePlayer = create<PlayerState>(() => ({
  queue: emptyQueue(),
  trackId: null,
  playing: false,
  buffering: false,
  volume: 1,
  source: "",
  context: [],
  loaded: false,
}));

const getTrack = (id: string | null | undefined): Track | undefined =>
  id ? useLibrary.getState().index?.byId.get(id) : undefined;

// ---- engine (lazy, needs document) ----
let engine: PlayerEngine | null = null;
let lastSave = 0;
let resumeAt = 0; // position to start from on the first play after restore

function eng(): PlayerEngine {
  if (engine) return engine;
  engine = new PlayerEngine({
    onTime(position, duration) {
      useProgress.setState({ position, duration });
      ms.setPosition(position, duration, 1);
      const now = Date.now();
      if (now - lastSave > 5000 && usePlayer.getState().playing) {
        lastSave = now;
        void persist();
      }
    },
    onPlaying(playing) {
      usePlayer.setState({ playing });
      ms.setPlaybackState(playing);
      if (!playing) void persist();
    },
    onBuffering: (buffering) => usePlayer.setState({ buffering }),
    onEnded: () => void playerActions.next(true),
    onAdvanced(id) {
      const { queue } = usePlayer.getState();
      const ni = nextIndex(queue, true);
      const t = getTrack(id);
      if (ni === null || ni === queue.index || queue.items[ni] !== id || !t) {
        // the standby held something else than the queue expects: take the normal path
        void playerActions.next(true);
        return;
      }
      usePlayer.setState({ queue: jumpTo(queue, ni), trackId: id, loaded: true });
      resumeAt = 0;
      useProgress.setState({ position: 0, duration: t.durationSec });
      void applyMediaSession(t);
      void pushRecent(id);
      void persist();
    },
    onError: (m) => toast(m, { kind: "error" }),
    onNearEnd: preloadNextTrack,
    onFallback: () => toast("Using compatibility playback mode", { kind: "info" }),
  });
  ms.installHandlers({
    play: () => void playerActions.play(),
    pause: () => playerActions.pause(),
    previous: () => void playerActions.prev(),
    next: () => void playerActions.next(false),
    seekTo: (s) => playerActions.seek(s),
    seekBy: (d) => playerActions.seek(engine!.position + d),
  });
  engine.setVolume(usePlayer.getState().volume);
  return engine;
}

/** Prefetch the queue's next track and buffer it on the engine's standby element. */
function nextTrack(): Track | undefined {
  const { queue } = usePlayer.getState();
  const ni = nextIndex(queue, true);
  if (ni === null || ni === queue.index) return undefined;
  return getTrack(queue.items[ni]);
}

function preloadNextTrack() {
  const t = nextTrack();
  if (!t) return;
  if (useSettings.getState().prefetchEnabled) void prefetchTrack(t);
  engine?.preloadNext(t);
}

/** After a queue edit that doesn't reload the current track: drop the standby and, if near the end, rebuild it. */
function refreshPreload() {
  if (!engine) return;
  if (engine.preloadedId && engine.preloadedId === nextTrack()?.id) return;
  engine.clearPreload();
  if (engine.nearEnd) preloadNextTrack();
}

// ---- persistence ----
interface Persisted {
  queue: QueueState;
  position: number;
  source: string;
  volume?: number;
  context?: string[];
}

async function persist(): Promise<void> {
  const { queue, source, volume, context } = usePlayer.getState();
  if (queue.items.length === 0) return;
  const data: Persisted = { queue, position: engine && engine.currentTrackId ? engine.position : resumeAt, source, volume, context };
  await kvSet(KV.player, data).catch(() => undefined);
}

async function pushRecent(id: string): Promise<void> {
  const cur = (await kvGet<string[]>(KV.recent)) ?? [];
  const next = [id, ...cur.filter((x) => x !== id)].slice(0, 20);
  await kvSet(KV.recent, next);
  useRecent.setState({ ids: next });
}

export const useRecent = create<{ ids: string[] }>(() => ({ ids: [] }));

async function applyMediaSession(t: Track): Promise<void> {
  ms.setMetadata({ title: t.title, artist: t.artist, album: t.album, mime: "image/jpeg" });
  const url = await getCoverUrl(t);
  if (url && usePlayer.getState().trackId === t.id) {
    ms.setMetadata({ title: t.title, artist: t.artist, album: t.album, artworkUrl: url, mime: "image/jpeg" });
  }
}

async function loadCurrent(autoplay: boolean, startAt = 0): Promise<void> {
  const { queue } = usePlayer.getState();
  const id = currentId(queue);
  const track = getTrack(id);
  if (!id || !track) {
    usePlayer.setState({ trackId: null, loaded: false });
    return;
  }
  usePlayer.setState({ trackId: id, loaded: true });
  resumeAt = 0;
  void applyMediaSession(track);
  if (autoplay) void pushRecent(id);
  await eng().load(track, { startAt, autoplay });
  void persist();
}

export const playerActions = {
  /** Play `ids` starting at `index`. */
  async playTracks(ids: string[], index: number, opts: { shuffle?: boolean; source?: string } = {}) {
    engine?.clearPreload();
    const q = startQueue(ids, index, { shuffle: opts.shuffle, repeat: usePlayer.getState().queue.repeat });
    usePlayer.setState({ queue: q, source: opts.source ?? "", context: ids });
    await loadCurrent(true);
  },

  async play() {
    const s = usePlayer.getState();
    if (!s.trackId) return;
    if (!s.loaded || !engine || engine.currentTrackId !== s.trackId) {
      await loadCurrent(true, resumeAt);
      return;
    }
    await eng().play();
  },
  pause() {
    engine?.pause();
  },
  async toggle() {
    if (usePlayer.getState().playing) playerActions.pause();
    else await playerActions.play();
  },

  async next(auto = false) {
    engine?.clearPreload();
    const { queue } = usePlayer.getState();
    const ni = nextIndex(queue, auto);
    if (ni === null) {
      // end of queue: stop and rewind
      engine?.pause();
      engine?.seek(0);
      usePlayer.setState({ playing: false });
      return;
    }
    if (ni === queue.index && auto) {
      // repeat one: replay without reloading
      engine?.seek(0);
      await engine?.play();
      return;
    }
    usePlayer.setState({ queue: jumpTo(queue, ni) });
    await loadCurrent(true);
  },

  async prev() {
    engine?.clearPreload();
    const { queue } = usePlayer.getState();
    if (queue.items.length === 0) return;
    if ((engine?.position ?? 0) > 3) {
      engine?.seek(0);
      return;
    }
    const pi = prevIndex(queue);
    if (pi === queue.index) {
      engine?.seek(0);
      return;
    }
    usePlayer.setState({ queue: jumpTo(queue, pi) });
    await loadCurrent(true);
  },

  async jump(index: number) {
    engine?.clearPreload();
    usePlayer.setState((s) => ({ queue: jumpTo(s.queue, index) }));
    await loadCurrent(true);
  },

  seek(seconds: number) {
    if (!engine || !engine.currentTrackId) {
      resumeAt = Math.max(0, seconds);
      useProgress.setState({ position: resumeAt });
      return;
    }
    engine.seek(seconds);
  },

  setVolume(v: number) {
    usePlayer.setState({ volume: v });
    engine?.setVolume(v);
    void persist();
  },

  toggleShuffle() {
    usePlayer.setState((s) => ({ queue: toggleShuffle(s.queue) }));
    refreshPreload();
    void persist();
  },
  cycleRepeat() {
    usePlayer.setState((s) => ({ queue: { ...s.queue, repeat: cycleRepeat(s.queue.repeat) } }));
    refreshPreload();
    void persist();
  },

  playNext(id: string) {
    usePlayer.setState((s) => ({ queue: insertNext(s.queue, id) }));
    refreshPreload();
    ensureTrackSelected();
    toast("Will play next");
    void persist();
  },
  addToQueue(id: string) {
    usePlayer.setState((s) => ({ queue: append(s.queue, id) }));
    refreshPreload();
    ensureTrackSelected();
    toast("Added to queue");
    void persist();
  },
  addManyToQueue(ids: string[]) {
    usePlayer.setState((s) => ({ queue: ids.reduce((q, id) => append(q, id), s.queue) }));
    refreshPreload();
    ensureTrackSelected();
    toast(`Added ${ids.length} tracks to queue`);
    void persist();
  },
  async removeFromQueue(index: number) {
    const { state, wasCurrent } = removeAt(usePlayer.getState().queue, index);
    usePlayer.setState({ queue: state });
    if (wasCurrent) engine?.clearPreload();
    else refreshPreload();
    if (wasCurrent) {
      if (state.items.length === 0) {
        engine?.unload();
        usePlayer.setState({ trackId: null, playing: false, loaded: false, context: [] });
        ms.clearMetadata();
      } else await loadCurrent(usePlayer.getState().playing);
    }
    void persist();
  },
  moveInQueue(from: number, to: number) {
    usePlayer.setState((s) => ({ queue: moveItem(s.queue, from, to) }));
    refreshPreload();
    void persist();
  },

  /** Stop and release the current track (sign out). */
  reset() {
    engine?.clearPreload();
    engine?.unload();
    ms.clearMetadata();
    usePlayer.setState({ queue: emptyQueue(), trackId: null, playing: false, buffering: false, loaded: false, source: "", context: [] });
    useProgress.setState({ position: 0, duration: 0 });
    useRecent.setState({ ids: [] });
  },
};

function ensureTrackSelected() {
  const s = usePlayer.getState();
  if (!s.trackId && s.queue.index >= 0) {
    usePlayer.setState({ trackId: currentId(s.queue) ?? null });
    const t = getTrack(currentId(s.queue));
    if (t) useProgress.setState({ position: 0, duration: t.durationSec });
  }
}

/** Restore queue + position (paused) after the library is available. */
export async function restorePlayer(): Promise<void> {
  const [saved, recent] = await Promise.all([kvGet<Persisted>(KV.player), kvGet<string[]>(KV.recent)]);
  useRecent.setState({ ids: recent ?? [] });
  const index = useLibrary.getState().index;
  if (!saved || !index || usePlayer.getState().trackId) return;
  const queue = pruneQueue(saved.queue, (id) => index.byId.has(id));
  if (queue.items.length === 0 || queue.index < 0) return;
  const id = currentId(queue)!;
  const t = index.byId.get(id)!;
  resumeAt = saved.position || 0;
  usePlayer.setState({ queue, trackId: id, source: saved.source ?? "", context: (saved.context ?? []).filter((x) => index.byId.has(x)), loaded: false, volume: saved.volume ?? 1 });
  useProgress.setState({ position: resumeAt, duration: t.durationSec });
  void applyMediaSession(t);
}

/** Ensure the audio element exists early (so media-session handlers are registered). */
export function initPlayer(): void {
  void initPlaybackLog();
  eng();
}
