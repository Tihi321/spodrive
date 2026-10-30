/** Player state (zustand) + glue between queue logic, the audio engine, media session and persistence. */
import { create } from "zustand";
import type { Track } from "@spodrive/core";
import { useAuth } from "../lib/auth";
import { KV, kvGet, kvSet } from "../lib/db";
import { initPlaybackLog } from "../lib/playback-log";
import { useLibrary } from "../lib/library";
import { getCoverUrl } from "../lib/covers";
import { isDownloaded, prefetchTrack } from "../lib/offline";
import { getPlayMode, setPlayMode } from "../state/playmodes";
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
  nextPlayableIndex,
  prevPlayableIndex,
  pruneQueue,
  removeAt,
  setShuffle,
  startQueue,
  toggleShuffle,
  type QueueState,
} from "./queue";

/** Can this track play right now? Downloaded ones always can; others need the network and a Google session. */
export const isPlayable = (id: string): boolean =>
  isDownloaded(id) || (navigator.onLine && !useAuth.getState().needsReconnect);

let lastSkipToast = 0;
/** "skip": moving past unavailable songs (throttled); "none": nothing playable left; "tapped": the chosen song is unavailable. */
function toastUnavailable(what: "skip" | "none" | "tapped") {
  const now = Date.now();
  if (what === "skip" && now - lastSkipToast < 30_000) return;
  lastSkipToast = now;
  const why = navigator.onLine ? "Reconnect Google to stream songs that aren't downloaded" : "Offline: only downloaded songs can play";
  const msg = what === "skip" ? `${why}. Skipping the others.` : what === "none" ? `${why}. Nothing else to play.` : `${why}.`;
  toast(msg, { kind: what === "skip" ? "info" : "error" });
}

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
  /** Play-mode key of the playlist/folder the queue was started from (see state/playmodes.ts). */
  sourceKey: string | null;
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
  sourceKey: null,
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
      const ni = nextPlayableIndex(queue, true, isPlayable);
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
    isAvailable: (t) => isPlayable(t.id),
    onUnavailable: () => void skipUnavailable(),
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
  const ni = nextPlayableIndex(queue, true, isPlayable);
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
  sourceKey?: string | null;
  context?: string[];
}

async function persist(): Promise<void> {
  const { queue, source, volume, sourceKey, context } = usePlayer.getState();
  if (queue.items.length === 0) return;
  const data: Persisted = {
    queue,
    position: engine && engine.currentTrackId ? engine.position : resumeAt,
    source,
    volume,
    sourceKey,
    context,
  };
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

/** The current track can't play (offline / signed out and not downloaded): move on to the next one that can. */
async function skipUnavailable(): Promise<void> {
  const { queue } = usePlayer.getState();
  const ni = nextPlayableIndex(queue, false, isPlayable);
  if (ni === null || ni === queue.index) {
    engine?.stopped();
    toastUnavailable("none");
    return;
  }
  toastUnavailable("skip");
  usePlayer.setState({ queue: jumpTo(queue, ni) });
  await loadCurrent(true);
}

export interface PlayOptions {
  shuffle?: boolean;
  /** "Playing from ..." label */
  source?: string;
  /** Play-mode key (playlist/folder): its shuffle and repeat settings apply, and changes in the player are saved back. */
  modeKey?: string;
  /**
   * When the chosen track can't play right now, start from the next one that can (Play / Shuffle buttons).
   * Without it, tapping an unavailable song only explains why it doesn't play.
   */
  skipUnavailable?: boolean;
}

export const playerActions = {
  /** Play `ids` starting at `index`. */
  async playTracks(ids: string[], index: number, opts: PlayOptions = {}) {
    engine?.clearPreload();
    const mode = opts.modeKey ? getPlayMode(opts.modeKey) : null;
    const shuffle = opts.shuffle ?? mode?.shuffle;
    const repeat = mode ? (mode.repeat ? "all" : "off") : usePlayer.getState().queue.repeat;
    let q = startQueue(ids, index, { shuffle, repeat });
    const cur = currentId(q);
    if (cur && !isPlayable(cur)) {
      if (!opts.skipUnavailable) {
        toastUnavailable("tapped");
        return;
      }
      const ni = nextPlayableIndex(q, false, isPlayable);
      if (ni === null) {
        toastUnavailable("none");
        return;
      }
      q = jumpTo(q, ni);
    }
    usePlayer.setState({ queue: q, source: opts.source ?? "", sourceKey: opts.modeKey ?? null, context: ids });
    await loadCurrent(true);
  },

  /** Apply a playlist/folder play mode to the queue when that playlist/folder is what's playing. */
  applyPlayMode(modeKey: string) {
    const s = usePlayer.getState();
    if (s.sourceKey !== modeKey) return;
    const mode = getPlayMode(modeKey);
    const repeat = mode.repeat ? (s.queue.repeat === "off" ? "all" : s.queue.repeat) : "off";
    usePlayer.setState({ queue: { ...setShuffle(s.queue, mode.shuffle), repeat } });
    refreshPreload();
    void persist();
  },

  async play() {
    const s = usePlayer.getState();
    if (!s.trackId) return;
    if (!isPlayable(s.trackId)) {
      await skipUnavailable();
      return;
    }
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
    const ni = nextPlayableIndex(queue, auto, isPlayable);
    if (ni === null) {
      // end of queue: stop and rewind
      engine?.pause();
      engine?.stopped();
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
    const pi = prevPlayableIndex(queue, isPlayable);
    if (pi === queue.index) {
      engine?.seek(0);
      return;
    }
    usePlayer.setState({ queue: jumpTo(queue, pi) });
    await loadCurrent(true);
  },

  async jump(index: number) {
    const id = usePlayer.getState().queue.items[index];
    if (id && !isPlayable(id)) {
      toastUnavailable("tapped");
      return;
    }
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
    saveModeBack();
    refreshPreload();
    void persist();
  },
  cycleRepeat() {
    usePlayer.setState((s) => ({ queue: { ...s.queue, repeat: cycleRepeat(s.queue.repeat) } }));
    saveModeBack();
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
    usePlayer.setState({ queue: emptyQueue(), trackId: null, playing: false, buffering: false, loaded: false, source: "", sourceKey: null, context: [] });
    useProgress.setState({ position: 0, duration: 0 });
    useRecent.setState({ ids: [] });
  },
};

/** Shuffle/repeat changed in the player while a playlist/folder plays: remember it for that playlist/folder. */
function saveModeBack() {
  const { sourceKey, queue } = usePlayer.getState();
  if (sourceKey) setPlayMode(sourceKey, { shuffle: queue.shuffle, repeat: queue.repeat !== "off" });
}

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
  usePlayer.setState({
    queue,
    trackId: id,
    source: saved.source ?? "",
    sourceKey: saved.sourceKey ?? null,
    context: (saved.context ?? []).filter((x) => index.byId.has(x)),
    loaded: false,
    volume: saved.volume ?? 1,
  });
  useProgress.setState({ position: resumeAt, duration: t.durationSec });
  void applyMediaSession(t);
}

/** Ensure the audio element exists early (so media-session handlers are registered). */
export function initPlayer(): void {
  void initPlaybackLog();
  eng();
}
