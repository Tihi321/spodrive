import { ListMusic, Mic2, Volume2, VolumeX } from "lucide-react";
import { useLibrary } from "../lib/library";
import { useCover } from "../lib/covers";
import { rgb, shade, useCoverColor } from "../lib/color";
import { playerActions, usePlayer, useProgress } from "../player/store";
import { useUi } from "../state/ui";
import { Cover, IconButton } from "./bits";
import { NextButton, PlayPauseButton, PrevButton, RepeatButton, Scrubber, ShuffleButton } from "./Transport";

function ProgressLine() {
  const pct = useProgress((s) => (s.duration > 0 ? Math.min(100, (s.position / s.duration) * 100) : 0));
  return (
    <div className="absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded bg-white/20" aria-hidden>
      <div className="h-full bg-white" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Mobile mini-player above the bottom nav. */
export function MiniPlayer() {
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const track = useLibrary((s) => (trackId ? s.index?.byId.get(trackId) : undefined));
  const setNowPlaying = useUi((s) => s.setNowPlaying);
  const url = useCover(trackId);
  const color = useCoverColor(url);
  if (!track) return null;
  return (
    <div className="relative mx-2 mb-1 flex items-center gap-3 rounded-xl px-2 py-2 lg:hidden" style={{ background: rgb(shade(color, 0.6)) }}>
      <button
        type="button"
        onClick={() => setNowPlaying(true)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label="Open now playing"
      >
        <Cover trackId={track.id} className="h-10 w-10 shrink-0 rounded" iconSize={18} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{track.title}</span>
          <span className="block truncate text-xs text-white/70">{track.artist}</span>
        </span>
      </button>
      <PlayPauseButton size={38} className={playing ? "" : ""} />
      <NextButton size={22} />
      <ProgressLine />
    </div>
  );
}

/** Desktop bottom bar. */
export function DesktopPlayerBar() {
  const trackId = usePlayer((s) => s.trackId);
  const track = useLibrary((s) => (trackId ? s.index?.byId.get(trackId) : undefined));
  const volume = usePlayer((s) => s.volume);
  const setNowPlaying = useUi((s) => s.setNowPlaying);
  const setQueueOpen = useUi((s) => s.setQueueOpen);
  const setLyricsFull = useUi((s) => s.setLyricsFull);
  return (
    <div className="hidden h-24 shrink-0 grid-cols-[1fr_minmax(320px,2fr)_1fr] items-center gap-4 border-t border-line bg-black px-4 lg:grid">
      <div className="flex min-w-0 items-center gap-3">
        {track && (
          <>
            <button type="button" onClick={() => setNowPlaying(true)} aria-label="Open now playing" className="shrink-0">
              <Cover trackId={track.id} className="h-14 w-14 rounded" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{track.title}</div>
              <div className="truncate text-xs text-muted">{track.artist}</div>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-4">
          <ShuffleButton size={18} />
          <PrevButton size={22} />
          <PlayPauseButton size={40} />
          <NextButton size={22} />
          <RepeatButton size={18} />
        </div>
        <Scrubber className="w-full max-w-xl" />
      </div>
      <div className="flex items-center justify-end gap-1">
        <IconButton
          label="Lyrics"
          onClick={() => {
            setNowPlaying(true);
            setLyricsFull(true);
          }}
          disabled={!track}
        >
          <Mic2 size={18} />
        </IconButton>
        <IconButton
          label="Queue"
          onClick={() => {
            setNowPlaying(true);
            setQueueOpen(true);
          }}
          disabled={!track}
        >
          <ListMusic size={18} />
        </IconButton>
        <IconButton label={volume === 0 ? "Unmute" : "Mute"} onClick={() => playerActions.setVolume(volume === 0 ? 1 : 0)}>
          {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </IconButton>
        <input
          type="range"
          className="rng w-24"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Volume"
          style={{ ["--p" as string]: `${volume * 100}%` }}
          onChange={(e) => playerActions.setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
