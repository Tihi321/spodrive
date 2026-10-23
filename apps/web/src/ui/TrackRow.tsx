import type { ReactNode } from "react";
import { CircleArrowDown, Ellipsis } from "lucide-react";
import type { Track } from "@spodrive/core";
import { formatDuration } from "../lib/library-index";
import { useOffline } from "../lib/offline";
import { usePlayer } from "../player/store";
import { useUi } from "../state/ui";
import { Cover, Equalizer, IconButton, cx } from "./bits";

interface Props {
  track: Track;
  onPlay: () => void;
  /** Show a track number instead of the cover thumbnail (album view). */
  number?: number;
  showAlbum?: boolean;
  menuCtx?: { playlistId?: string; index?: number };
  leading?: ReactNode;
  className?: string;
}

export function TrackRow({ track, onPlay, number, showAlbum, menuCtx, leading, className }: Props) {
  const active = usePlayer((s) => s.trackId === track.id);
  const playing = usePlayer((s) => s.trackId === track.id && s.playing);
  const downloaded = useOffline((s) => s.downloaded.has(track.id));
  const progress = useOffline((s) => s.progress[track.id]);
  const openMenu = useUi((s) => s.openMenu);

  return (
    <div className={cx("row-cv group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5", className)}>
      {leading}
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Play ${track.title}`}>
        {number !== undefined ? (
          <span className="flex w-10 shrink-0 items-center justify-center text-sm text-muted">
            {active ? <Equalizer playing={playing} /> : number}
          </span>
        ) : (
          <div className="relative shrink-0">
            <Cover trackId={track.id} className="h-11 w-11 rounded" iconSize={18} />
            {active && (
              <span className="absolute inset-0 flex items-center justify-center rounded bg-black/55">
                <Equalizer playing={playing} />
              </span>
            )}
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[0.9375rem] font-medium", active && "text-accent")}>{track.title}</span>
          <span className="block truncate text-xs text-muted">
            {track.artist}
            {showAlbum && track.album ? ` · ${track.album}` : ""}
          </span>
        </span>
      </button>
      {progress !== undefined && (
        <span className="text-[0.6875rem] tabular-nums text-muted" aria-label="Downloading">
          {Math.round(progress * 100)}%
        </span>
      )}
      {downloaded && progress === undefined && <CircleArrowDown size={16} className="shrink-0 text-accent" aria-label="Downloaded" />}
      <span className="hidden w-12 shrink-0 text-right text-xs tabular-nums text-muted sm:block">{formatDuration(track.durationSec)}</span>
      <IconButton label={`More options for ${track.title}`} onClick={() => openMenu(track.id, menuCtx)} className="shrink-0 text-muted">
        <Ellipsis size={20} />
      </IconButton>
    </div>
  );
}
