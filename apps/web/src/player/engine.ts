/**
 * Two hidden <audio> elements (active + standby). Normal path: src = /stream/<id> (Range-proxied to Drive by the SW).
 * The standby pre-buffers the next track so an auto-advance can start it synchronously inside the `ended`
 * event (no silent gap, which Android uses to pause a backgrounded page and drop the media notification).
 * Fallback path (SW streaming broken, e.g. some iOS Safari versions): download the whole file
 * and play a Blob URL from the same position (single element, no preload).
 */
import type { Track } from "@spodrive/core";
import { setTrackDuration } from "../lib/library";
import { getAudioBlob } from "../lib/offline";
import { log } from "../lib/playback-log";
import { swControlsPage, trackStreamUrl } from "../lib/sw-bridge";

const FALLBACK_KEY = "spodrive.fallback";
const STALL_MS = 8000;
const STALL_HIDDEN_MS = 30000;
const RECOVER_DELAY_MS = 400;
const RECOVER_MIN_GAP_MS = 5000;
/** Only pauses this soon after a track change are retried; later ones are system pauses (call, focus loss, headphones). */
const RECOVER_WINDOW_MS = 10000;

/** ~12 ms of silent 8-bit mono WAV, used to unlock the standby element during a user gesture. */
function silentWavUri(): string {
  const samples = 100;
  const b = new Uint8Array(44 + samples);
  const dv = new DataView(b.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + samples, true);
  str(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, "data");
  dv.setUint32(40, samples, true);
  b.fill(0x80, 44);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export interface EngineEvents {
  onTime(position: number, duration: number): void;
  onPlaying(playing: boolean): void;
  onBuffering(buffering: boolean): void;
  onEnded(): void;
  /** The standby element took over at the end of the previous track (already playing). */
  onAdvanced(trackId: string): void;
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
  private els: HTMLAudioElement[] = [];
  private activeIdx = 0;
  private loadId = 0;
  private track: Track | null = null;
  private blobUrl: string | null = null;
  private fallback = typeof sessionStorage !== "undefined" && sessionStorage.getItem(FALLBACK_KEY) === "1";
  /** Track that fell back to Blob playback only because of a background stall (not sticky). */
  private fallbackFor: string | null = null;
  private wantPlay = false;
  private pendingSeek = 0;
  private lastProgressAt = 0;
  private nearEndFired = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private fallingBack = false;
  /** The next pause event on the active element was requested by us. */
  private pauseRequested = false;
  /** Track change in progress: don't report "paused" to the store / media session. */
  private suppressPaused = false;
  private retryOnVisible = false;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRecoverAt = 0;
  private trackStartedAt = 0;
  private standbyTrack: Track | null = null;
  private unlocked = false;
  private unlocking = false;

  constructor(private ev: EngineEvents) {
    for (let i = 0; i < 2; i++) {
      const a = document.createElement("audio");
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      a.style.display = "none";
      document.body.appendChild(a);
      this.els.push(a);
      this.attach(a);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !this.retryOnVisible) return;
      this.retryOnVisible = false;
      if (this.wantPlay && this.track && this.audio.paused) {
        log("retry play on visible");
        void this.tryPlay();
      }
    });
  }

  /** The element currently playing / loaded with the current track. */
  get audio(): HTMLAudioElement {
    return this.els[this.activeIdx]!;
  }
  private get standby(): HTMLAudioElement {
    return this.els[1 - this.activeIdx]!;
  }

  private attach(a: HTMLAudioElement) {
    const ev = this.ev;
    const active = () => a === this.audio;
    a.addEventListener("timeupdate", () => {
      if (!active()) return;
      this.lastProgressAt = Date.now();
      const dur = this.duration();
      ev.onTime(a.currentTime, dur);
      if (!this.nearEndFired && dur > 0 && (a.currentTime / dur >= 0.8 || dur - a.currentTime <= 30)) {
        this.nearEndFired = true;
        ev.onNearEnd();
      }
    });
    a.addEventListener("loadedmetadata", () => {
      if (!active()) return;
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
      if (!active()) return;
      this.lastProgressAt = Date.now();
      this.suppressPaused = false;
      ev.onBuffering(false);
      ev.onPlaying(true);
    });
    a.addEventListener("pause", () => {
      if (!active()) return;
      const requested = this.pauseRequested;
      this.pauseRequested = false;
      log("pause", `requested=${requested} ended=${a.ended} want=${this.wantPlay}`);
      if (a.ended || this.suppressPaused) return;
      if (!requested && this.wantPlay && this.track && !a.seeking) {
        const sinceStart = Date.now() - this.trackStartedAt;
        if (sinceStart < RECOVER_WINDOW_MS && Date.now() - this.lastRecoverAt > RECOVER_MIN_GAP_MS) {
          log("unexpected pause: recover branch", `sinceStart=${sinceStart}`);
          this.scheduleRecover();
          return;
        }
        log("unexpected pause: reported paused (outside recover window or throttled)", `sinceStart=${sinceStart}`);
      }
      ev.onPlaying(false);
    });
    a.addEventListener("waiting", () => {
      if (!active()) return;
      log("waiting");
      ev.onBuffering(true);
    });
    a.addEventListener("stalled", () => active() && log("stalled"));
    a.addEventListener("canplay", () => active() && ev.onBuffering(false));
    a.addEventListener("progress", () => active() && (this.lastProgressAt = Date.now()));
    a.addEventListener("ended", () => {
      if (!active()) return;
      log("ended", this.track?.id);
      if (this.advanceToStandby()) return;
      ev.onEnded();
    });
    a.addEventListener("error", () => {
      if (!active()) {
        // a failed preload is simply dropped; the normal load path runs at the end of the track
        if (this.standbyTrack) {
          log("standby error", `code=${a.error?.code}`);
          this.standbyTrack = null;
        }
        return;
      }
      log("error", `code=${a.error?.code} src=${this.blobUrl && a.src === this.blobUrl ? "blob" : "stream"}`);
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
    this.suppressPaused = false;
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
  /** True once the near-end hook fired for the current track. */
  /** Id of the track buffered on the standby element, if any. */
  get preloadedId(): string | null {
    return this.standbyTrack?.id ?? null;
  }
  get nearEnd(): boolean {
    return this.nearEndFired;
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

  private requestPause(a: HTMLAudioElement) {
    if (!a.paused) {
      this.pauseRequested = true;
      a.pause();
    }
  }

  private scheduleRecover() {
    if (this.recoverTimer) return;
    this.lastRecoverAt = Date.now();
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (!this.wantPlay || !this.track) return;
      if (!this.audio.paused) return;
      void this.tryPlay().then(() => {
        if (this.audio.paused && !this.suppressPaused) this.ev.onPlaying(false);
      });
    }, RECOVER_DELAY_MS);
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.lastProgressAt = Date.now();
    this.watchdog = setInterval(() => {
      const a = this.audio;
      if (!this.wantPlay || this.fallingBack || !this.track) return;
      if (this.blobUrl && a.src === this.blobUrl) return;
      if (!navigator.onLine || !this.available(this.track)) return;
      const limit = document.hidden ? STALL_HIDDEN_MS : STALL_MS;
      const stuck = a.readyState < 3 && Date.now() - this.lastProgressAt > limit;
      if (stuck) {
        log("watchdog stall", `readyState=${a.readyState}`);
        void this.enterFallback("stalled");
      }
    }, 1000);
  }
  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** Best effort: play a silent clip on the standby element during a user gesture so it may start later without one. */
  private unlockStandby() {
    if (this.unlocked || this.unlocking || this.standbyTrack) return;
    this.unlocking = true;
    try {
      const s = this.standby;
      s.src = silentWavUri();
      s.play().then(
        () => {
          s.pause();
          if (!this.standbyTrack && s === this.standby) {
            s.removeAttribute("src");
            s.load();
          }
          this.unlocked = true;
          this.unlocking = false;
          log("standby unlocked");
        },
        () => {
          this.unlocking = false;
        },
      );
    } catch {
      this.unlocking = false;
    }
  }

  /** Start buffering `track` on the standby element (stream mode only). */
  preloadNext(track: Track): void {
    if (this.standbyTrack?.id === track.id) return;
    if (this.fallback || this.fallbackFor || this.blobUrl) return;
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
    const s = this.standby;
    s.src = trackStreamUrl(track.id);
    s.preload = "auto";
    s.load();
    this.standbyTrack = track;
    log("preload", track.id);
  }

  clearPreload(): void {
    if (!this.standbyTrack) return;
    log("preload cleared", this.standbyTrack.id);
    this.resetStandby();
  }

  private resetStandby() {
    this.standbyTrack = null;
    const s = this.standby;
    s.removeAttribute("src");
    s.load();
  }

  /** On `ended`: start the pre-buffered standby synchronously and swap. Returns false if it can't be used. */
  private advanceToStandby(): boolean {
    const next = this.standbyTrack;
    if (!next || this.blobUrl || this.fallback) return false;
    let p: Promise<void>;
    try {
      p = this.standby.play();
    } catch (e) {
      p = Promise.reject(e);
    }
    const old = this.audio;
    this.activeIdx = 1 - this.activeIdx;
    this.standbyTrack = null;
    this.loadId++;
    this.track = next;
    this.nearEndFired = false;
    this.fallingBack = false;
    this.fallbackFor = null;
    this.wantPlay = true;
    this.pendingSeek = 0;
    this.trackStartedAt = Date.now();
    this.suppressPaused = true;
    this.pauseRequested = false;
    this.cleanupBlob();
    old.removeAttribute("src");
    old.load();
    this.startWatchdog();
    const a = this.audio;
    if (next.durationSec <= 0 && a.readyState >= 1 && isFinite(a.duration)) setTrackDuration(next.id, a.duration);
    this.ev.onTime(0, this.duration());
    this.ev.onAdvanced(next.id);
    const lid = this.loadId;
    p.then(
      () => log("standby play resolved", next.id),
      (e: DOMException) => {
        log("standby play rejected", `${e?.name} ${next.id}`);
        if (lid !== this.loadId || !this.track) return;
        void this.load(next, { autoplay: true });
      },
    );
    return true;
  }

  async load(track: Track, opts: { startAt?: number; autoplay: boolean }): Promise<void> {
    this.unlockStandby();
    const id = ++this.loadId;
    this.track = track;
    this.nearEndFired = false;
    this.fallingBack = false;
    this.wantPlay = opts.autoplay;
    this.pendingSeek = opts.startAt ?? 0;
    this.retryOnVisible = false;
    this.trackStartedAt = Date.now();
    this.cleanupBlob();
    const a = this.audio;
    log("load", `${track.id} autoplay=${opts.autoplay} mode=${this.fallback || this.fallbackFor === track.id ? "blob" : "stream"}`);
    // after `ended` the element is already paused (requestPause skips it), so there is no "paused" blip
    this.suppressPaused = opts.autoplay;
    this.requestPause(a);
    this.ev.onTime(this.pendingSeek, this.duration());

    let useStream = !this.fallback && this.fallbackFor !== track.id;
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
      log("play resolved");
    } catch (e) {
      const err = e as DOMException;
      log("play rejected", err.name);
      if (err.name === "NotAllowedError") {
        this.suppressPaused = false;
        this.stopWatchdog();
        this.ev.onBuffering(false);
        if (document.hidden) {
          // keep the intent and the media session so the lock-screen play button / returning to the app can resume
          this.retryOnVisible = true;
          this.ev.onPlaying(false);
        } else {
          this.wantPlay = false;
          this.ev.onPlaying(false);
          this.ev.onError("Tap play to start playback");
        }
      } else if (err.name !== "AbortError") {
        this.suppressPaused = false;
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
    if (this.standbyTrack) this.resetStandby();
    const bg = document.hidden;
    log("fallback", `${reason} hidden=${bg}`);
    if (bg) {
      this.fallbackFor = this.track.id; // a background stall must not make Blob mode stick for the session
    } else {
      this.fallback = true;
      try {
        sessionStorage.setItem(FALLBACK_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    this.ev.onFallback?.();
    console.info(`[spodrive] switching to Blob playback (${reason})`);
    const pos = this.audio.currentTime || this.pendingSeek || 0;
    await this.loadBlob(this.track, pos, this.wantPlay, this.loadId);
  }

  async play(): Promise<void> {
    this.unlockStandby();
    this.wantPlay = true;
    this.retryOnVisible = false;
    this.startWatchdog();
    await this.tryPlay();
  }
  pause(): void {
    this.wantPlay = false;
    this.suppressPaused = false;
    this.retryOnVisible = false;
    this.stopWatchdog();
    this.requestPause(this.audio);
  }
  /** End of the queue: report the stop that "ended" did not. */
  stopped(): void {
    this.wantPlay = false;
    this.suppressPaused = false;
    this.retryOnVisible = false;
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
    const vol = Math.min(1, Math.max(0, v));
    for (const a of this.els) a.volume = vol;
  }
  /** Release the current track (lock / sign-out). */
  unload(): void {
    this.loadId++;
    this.track = null;
    this.wantPlay = false;
    this.suppressPaused = false;
    this.retryOnVisible = false;
    this.standbyTrack = null;
    this.stopWatchdog();
    for (const a of this.els) {
      if (a === this.audio) this.requestPause(a);
      else a.pause();
      a.removeAttribute("src");
      a.load();
    }
    this.cleanupBlob();
  }
}
