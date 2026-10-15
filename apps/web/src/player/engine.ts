/**
 * A single hidden <audio> element. Normal path: src = /stream/<id> (Range-proxied to Drive by the SW).
 * Fallback path (SW streaming broken, e.g. some iOS Safari versions): download the whole file
 * and play a Blob URL from the same position.
 */
import type { Track } from "@spodrive/core";
import { setTrackDuration } from "../lib/library";
import { getAudioBlob } from "../lib/offline";
import { swControlsPage, trackStreamUrl } from "../lib/sw-bridge";

const FALLBACK_KEY = "spodrive.fallback";
const STALL_MS = 8000;

export interface EngineEvents {
  onTime(position: number, duration: number): void;
  onPlaying(playing: boolean): void;
  onBuffering(buffering: boolean): void;
  onEnded(): void;
  onError(message: string): void;
  /** ~80% through the track (or 30 s before the end), once per load. */
  onNearEnd(): void;
  onFallback?(): void;
  /**
   * Can this track be played right now (downloaded, or online and signed in)? When it can't, a
   * load error means "unavailable" rather than "streaming is broken on this browser".
   */
  isAvailable?(track: Track): boolean;
  /** The current track can't be played right now (see isAvailable). */
  onUnavailable?(): void;
}

export class PlayerEngine {
  readonly audio: HTMLAudioElement;
  private loadId = 0;
  private track: Track | null = null;
  private blobUrl: string | null = null;
  private fallback = typeof sessionStorage !== "undefined" && sessionStorage.getItem(FALLBACK_KEY) === "1";
  private wantPlay = false;
  private pendingSeek = 0;
  private lastProgressAt = 0;
  private nearEndFired = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private fallingBack = false;
  /**
   * Between tracks: the old source is stopped but the new one isn't playing yet. The pause this causes
   * is not reported, so the lock screen / media notification stays in "playing" (with the screen off,
   * a paused media session lets the OS suspend the page before the next track starts).
   */
  private switching = false;

  constructor(private ev: EngineEvents) {
    const a = (this.audio = document.createElement("audio"));
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    a.style.display = "none";
    document.body.appendChild(a);

    a.addEventListener("timeupdate", () => {
      this.lastProgressAt = Date.now();
      const dur = this.duration();
      ev.onTime(a.currentTime, dur);
      if (!this.nearEndFired && dur > 0 && (a.currentTime / dur >= 0.8 || dur - a.currentTime <= 30)) {
        this.nearEndFired = true;
        ev.onNearEnd();
      }
    });
    a.addEventListener("loadedmetadata", () => {
      if (this.track && this.track.durationSec <= 0 && isFinite(a.duration)) setTrackDuration(this.track.id, a.duration);
      if (this.pendingSeek > 0) {
        try {
          a.currentTime = this.pendingSeek;
        } catch {
          /* ignore */
        }
        this.pendingSeek = 0;
      }
      ev.onTime(a.currentTime, this.duration());
    });
    a.addEventListener("playing", () => {
      this.switching = false;
      this.lastProgressAt = Date.now();
      ev.onBuffering(false);
      ev.onPlaying(true);
    });
    a.addEventListener("pause", () => {
      // at the end of a track the next one starts right away (ended handler); "ended" is not a user pause
      if (!this.switching && !a.ended) ev.onPlaying(false);
    });
    a.addEventListener("waiting", () => ev.onBuffering(true));
    a.addEventListener("canplay", () => ev.onBuffering(false));
    a.addEventListener("progress", () => (this.lastProgressAt = Date.now()));
    a.addEventListener("ended", () => ev.onEnded());
    a.addEventListener("error", () => {
      if (!this.track || !a.src) return;
      if (this.blobUrl && a.src === this.blobUrl) {
        this.failed("Playback error");
      } else if (!this.available(this.track)) {
        // offline / signed out: not a streaming problem, so don't switch to compatibility mode
        this.unavailable();
      } else {
        void this.enterFallback("audio error");
      }
    });
  }

  private available(track: Track): boolean {
    return this.ev.isAvailable?.(track) ?? true;
  }
  /** Loading failed: report the pause that was suppressed during the switch. */
  private failed(message: string) {
    this.switching = false;
    this.stopWatchdog();
    this.ev.onBuffering(false);
    if (this.audio.paused) this.ev.onPlaying(false);
    this.ev.onError(message);
  }
  private unavailable() {
    this.stopWatchdog();
    this.ev.onBuffering(false);
    if (this.ev.onUnavailable) this.ev.onUnavailable();
    else this.failed("This track is not available offline");
  }

  get currentTrackId(): string | null {
    return this.track?.id ?? null;
  }
  get isFallback(): boolean {
    return this.fallback;
  }

  private duration(): number {
    const d = this.audio.duration;
    if (this.track && this.track.durationSec > 0) return this.track.durationSec;
    return isFinite(d) ? d : 0;
  }

  private cleanupBlob() {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.lastProgressAt = Date.now();
    this.watchdog = setInterval(() => {
      const a = this.audio;
      if (!this.wantPlay || this.fallingBack || !this.track) return;
      if (this.blobUrl && a.src === this.blobUrl) return;
      if (!navigator.onLine || !this.available(this.track)) return;
      const stuck = a.readyState < 3 && Date.now() - this.lastProgressAt > STALL_MS;
      if (stuck) void this.enterFallback("stalled");
    }, 1000);
  }
  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  async load(track: Track, opts: { startAt?: number; autoplay: boolean }): Promise<void> {
    const id = ++this.loadId;
    this.track = track;
    this.nearEndFired = false;
    this.fallingBack = false;
    this.wantPlay = opts.autoplay;
    this.pendingSeek = opts.startAt ?? 0;
    this.cleanupBlob();
    const a = this.audio;
    this.switching = opts.autoplay;
    a.pause();
    this.ev.onTime(this.pendingSeek, this.duration());

    let useStream = !this.fallback;
    if (useStream) {
      this.ev.onBuffering(true);
      useStream = await swControlsPage();
      if (id !== this.loadId) return;
    }
    if (useStream) {
      a.src = trackStreamUrl(track.id);
      a.load();
      if (opts.autoplay) {
        this.startWatchdog();
        await this.tryPlay();
      } else this.ev.onBuffering(false);
    } else {
      await this.loadBlob(track, this.pendingSeek, opts.autoplay, id);
    }
  }

  private async tryPlay(): Promise<void> {
    try {
      await this.audio.play();
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError") {
        this.wantPlay = false;
        this.failed("Tap play to start playback");
      } else if (err.name !== "AbortError") {
        /* the 'error' event handler decides about fallback */
      }
    }
  }

  private async loadBlob(track: Track, startAt: number, autoplay: boolean, id: number): Promise<void> {
    this.ev.onBuffering(true);
    try {
      const file = await getAudioBlob(track);
      if (id !== this.loadId) return;
      this.cleanupBlob();
      this.blobUrl = URL.createObjectURL(file.type ? file : new Blob([file], { type: track.mime || "audio/mpeg" }));
      this.pendingSeek = startAt;
      this.audio.src = this.blobUrl;
      this.audio.load();
      if (autoplay) await this.tryPlay();
      else this.ev.onBuffering(false);
    } catch (e) {
      if (id !== this.loadId) return;
      if (!this.available(track)) this.unavailable();
      else this.failed(`Could not load track: ${(e as Error).message}`);
    }
  }

  private async enterFallback(reason: string): Promise<void> {
    if (this.fallingBack || !this.track) return;
    this.fallingBack = true;
    this.stopWatchdog();
    this.fallback = true;
    try {
      sessionStorage.setItem(FALLBACK_KEY, "1");
    } catch {
      /* ignore */
    }
    this.ev.onFallback?.();
    console.info(`[spodrive] switching to Blob playback (${reason})`);
    const pos = this.audio.currentTime || this.pendingSeek || 0;
    await this.loadBlob(this.track, pos, this.wantPlay, this.loadId);
  }

  async play(): Promise<void> {
    this.wantPlay = true;
    this.startWatchdog();
    await this.tryPlay();
  }
  pause(): void {
    this.wantPlay = false;
    this.switching = false;
    this.stopWatchdog();
    this.audio.pause();
  }
  /** End of the queue: report the stop that "ended" did not. */
  stopped(): void {
    this.wantPlay = false;
    this.switching = false;
    this.stopWatchdog();
    this.ev.onPlaying(false);
  }
  seek(t: number): void {
    const d = this.duration();
    const target = Math.max(0, d > 0 ? Math.min(t, d) : t);
    if (this.audio.readyState === 0 && this.audio.src) this.pendingSeek = target;
    try {
      this.audio.currentTime = target;
    } catch {
      this.pendingSeek = target;
    }
    this.ev.onTime(target, d);
  }
  get position(): number {
    return this.audio.currentTime;
  }
  get paused(): boolean {
    return this.audio.paused;
  }
  setVolume(v: number): void {
    this.audio.volume = Math.min(1, Math.max(0, v));
  }
  /** Release the current track (lock / sign-out). */
  unload(): void {
    this.loadId++;
    this.track = null;
    this.wantPlay = false;
    this.switching = false;
    this.stopWatchdog();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.cleanupBlob();
  }
}
