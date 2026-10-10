/** Media Session API: lock-screen / notification metadata and controls. */
export interface MediaActions {
  play(): void;
  pause(): void;
  previous(): void;
  next(): void;
  seekTo(seconds: number): void;
  seekBy(deltaSeconds: number): void;
}

const ms = (): MediaSession | null => (typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null);

export function setMetadata(info: { title: string; artist: string; album: string; artworkUrl?: string | null; mime?: string }) {
  const s = ms();
  if (!s) return;
  s.metadata = new MediaMetadata({
    title: info.title,
    artist: info.artist,
    album: info.album,
    artwork: info.artworkUrl ? [{ src: info.artworkUrl, sizes: "512x512", type: info.mime || "image/jpeg" }] : [],
  });
}

export function clearMetadata() {
  const s = ms();
  if (s) {
    s.metadata = null;
    s.playbackState = "none";
  }
}

export function setPlaybackState(playing: boolean) {
  const s = ms();
  if (s) s.playbackState = playing ? "playing" : "paused";
}

let lastPosUpdate = 0;
export function setPosition(position: number, duration: number, rate = 1, force = false) {
  const s = ms();
  if (!s?.setPositionState || !isFinite(duration) || duration <= 0) return;
  const now = Date.now();
  if (!force && now - lastPosUpdate < 1000) return;
  lastPosUpdate = now;
  try {
    s.setPositionState({ duration, position: Math.min(Math.max(position, 0), duration), playbackRate: rate });
  } catch {
    /* ignore invalid state */
  }
}

export function installHandlers(a: MediaActions) {
  const s = ms();
  if (!s) return;
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      s.setActionHandler(action, fn);
    } catch {
      /* unsupported action */
    }
  };
  set("play", () => a.play());
  set("pause", () => a.pause());
  set("previoustrack", () => a.previous());
  set("nexttrack", () => a.next());
  set("seekto", (d) => d.seekTime !== undefined && d.seekTime !== null && a.seekTo(d.seekTime));
  set("seekbackward", (d) => a.seekBy(-(d.seekOffset ?? 10)));
  set("seekforward", (d) => a.seekBy(d.seekOffset ?? 10));
}
