import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, CircleArrowDown, Play, Shuffle, Trash2 } from "lucide-react";
import type { Track } from "@spodrive/core";
import { useCover } from "../lib/covers";
import { rgb, shade, useCoverColor } from "../lib/color";
import { downloadTracks, removeDownloads, useOffline } from "../lib/offline";
import { playerActions } from "../player/store";
import { toastError } from "../state/toasts";
import { Cover, IconButton, cx } from "./bits";

interface Props {
  kind: string;
  title: string;
  subtitle?: ReactNode;
  coverTrackId?: string;
  tracks: Track[];
  source: string;
  round?: boolean;
  actions?: ReactNode;
}

/** Big cover header with colour gradient + Play / Shuffle / Download. */
export function DetailHeader({ kind, title, subtitle, coverTrackId, tracks, source, round, actions }: Props) {
  const navigate = useNavigate();
  const url = useCover(coverTrackId);
  const color = useCoverColor(url);
  const allDownloaded = useOffline((s) => tracks.length > 0 && tracks.every((t) => s.downloaded.has(t.id)));
  const ids = tracks.map((t) => t.id);
  const empty = ids.length === 0;

  return (
    <header className="relative" style={{ background: `linear-gradient(180deg, ${rgb(shade(color, 0.85))} 0%, transparent 100%)` }}>
      <div className="px-4 pb-4 pt-3 lg:px-8 lg:pt-8">
        <IconButton label="Back" onClick={() => navigate(-1)} className="-ml-2 lg:hidden">
          <ChevronLeft size={26} />
        </IconButton>
        <div className="mt-2 flex flex-col items-center gap-5 lg:flex-row lg:items-end lg:gap-6">
          <Cover
            trackId={coverTrackId}
            className={cx("w-[min(60vw,15rem)] shadow-2xl shadow-black/50 lg:w-56", round ? "rounded-full" : "rounded-md")}
            iconSize={56}
          />
          <div className="w-full min-w-0 text-left">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/70">{kind}</div>
            <h1 className="mt-1 break-words text-3xl font-extrabold leading-tight lg:text-5xl">{title}</h1>
            {subtitle && <div className="mt-2 text-sm text-white/70">{subtitle}</div>}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            aria-label={`Play ${title}`}
            title="Play"
            disabled={empty}
            onClick={() => void playerActions.playTracks(ids, 0, { source })}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black transition hover:scale-105 active:scale-95 disabled:opacity-40"
          >
            <Play size={26} fill="currentColor" className="ml-0.5" />
          </button>
          <IconButton
            label="Shuffle play"
            disabled={empty}
            onClick={() => void playerActions.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true, source })}
            className="border border-white/20"
          >
            <Shuffle size={22} />
          </IconButton>
          {allDownloaded ? (
            <IconButton
              label="Remove downloads"
              active
              disabled={empty}
              onClick={() => void removeDownloads(ids).catch((e) => toastError(e))}
              className="border border-accent/40"
            >
              <Trash2 size={22} />
            </IconButton>
          ) : (
            <IconButton
              label="Download for offline"
              disabled={empty}
              onClick={() => void downloadTracks(tracks, title)}
              className="border border-white/20"
            >
              <CircleArrowDown size={22} />
            </IconButton>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
