import { useState } from "react";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { formatDuration } from "../lib/library-index";
import { playerActions, usePlayer, useProgress } from "../player/store";
import { IconButton, Spinner, cx } from "./bits";

export function Scrubber({ showTimes = true, className }: { showTimes?: boolean; className?: string }) {
  const position = useProgress((s) => s.position);
  const duration = useProgress((s) => s.duration);
  const trackId = usePlayer((s) => s.trackId);
  const [drag, setDrag] = useState<number | null>(null);
  const value = Math.min(drag ?? position, duration || 0);
  const pct = duration > 0 ? (value / duration) * 100 : 0;
  const commit = () => {
    if (drag !== null) {
      playerActions.seek(drag);
      setDrag(null);
    }
  };
  return (
    <div className={className}>
      <input
        type="range"
        className="rng"
        min={0}
        max={duration || 0}
        step={0.1}
        value={value}
        disabled={!trackId}
        aria-label="Seek"
        aria-valuetext={`${formatDuration(value)} of ${formatDuration(duration)}`}
        style={{ ["--p" as string]: `${pct}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {showTimes && (
        <div className="mt-0.5 flex justify-between text-xs tabular-nums text-white/65">
          <span>{formatDuration(value)}</span>
          <span>-{formatDuration(Math.max(0, duration - value))}</span>
        </div>
      )}
    </div>
  );
}

export function PlayPauseButton({ size = 64, className }: { size?: number; className?: string }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const trackId = usePlayer((s) => s.trackId);
  return (
    <button
      type="button"
      aria-label={playing ? "Pause" : "Play"}
      title={playing ? "Pause" : "Play"}
      disabled={!trackId}
      onClick={() => void playerActions.toggle()}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:opacity-40",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {buffering && !playing ? <Spinner size={size * 0.4} /> : playing ? <Pause size={size * 0.45} fill="currentColor" /> : <Play size={size * 0.45} fill="currentColor" className="ml-0.5" />}
    </button>
  );
}

export function ShuffleButton({ size = 22 }: { size?: number }) {
  const shuffle = usePlayer((s) => s.queue.shuffle);
  return (
    <IconButton label={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle} onClick={() => playerActions.toggleShuffle()}>
      <Shuffle size={size} />
    </IconButton>
  );
}

export function RepeatButton({ size = 22 }: { size?: number }) {
  const repeat = usePlayer((s) => s.queue.repeat);
  return (
    <IconButton
      label={`Repeat ${repeat}`}
      active={repeat !== "off"}
      onClick={() => playerActions.cycleRepeat()}
    >
      {repeat === "one" ? <Repeat1 size={size} /> : <Repeat size={size} />}
    </IconButton>
  );
}

export function PrevButton({ size = 28 }: { size?: number }) {
  return (
    <IconButton label="Previous" onClick={() => void playerActions.prev()}>
      <SkipBack size={size} fill="currentColor" />
    </IconButton>
  );
}
export function NextButton({ size = 28 }: { size?: number }) {
  return (
    <IconButton label="Next" onClick={() => void playerActions.next(false)}>
      <SkipForward size={size} fill="currentColor" />
    </IconButton>
  );
}
