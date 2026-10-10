import { useEffect, useRef, useState } from "react";
import { ChevronDown, Ellipsis, ListMusic, Mic2, X } from "lucide-react";
import { useLibrary } from "../lib/library";
import { useCover } from "../lib/covers";
import { rgb, shade, useCoverColor } from "../lib/color";
import { usePlayer } from "../player/store";
import { useUi } from "../state/ui";
import { Cover, IconButton } from "./bits";
import { LyricsPanel } from "./LyricsPanel";
import { QueueView } from "./QueueView";
import { NextButton, PlayPauseButton, PrevButton, RepeatButton, Scrubber, ShuffleButton } from "./Transport";

export function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const trackId = usePlayer((s) => s.trackId);
  if (!open || !trackId) return null;
  return <NowPlayingInner trackId={trackId} />;
}

function NowPlayingInner({ trackId }: { trackId: string }) {
  const track = useLibrary((s) => s.index?.byId.get(trackId));
  const source = usePlayer((s) => s.source);
  const setNowPlaying = useUi((s) => s.setNowPlaying);
  const lyricsFull = useUi((s) => s.lyricsFull);
  const queueOpen = useUi((s) => s.queueOpen);
  const setLyricsFull = useUi((s) => s.setLyricsFull);
  const setQueueOpen = useUi((s) => s.setQueueOpen);
  const openMenu = useUi((s) => s.openMenu);
  const url = useCover(trackId);
  const color = useCoverColor(url);

  // swipe down to close
  const [dy, setDy] = useState(0);
  const startY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (startY.current = e.touches[0]!.clientY);
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    setDy(Math.max(0, e.touches[0]!.clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (dy > 110) setNowPlaying(false);
    setDy(0);
    startY.current = null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const ui = useUi.getState();
        if (ui.menu || ui.picker) return;
        if (ui.queueOpen) ui.setQueueOpen(false);
        else if (ui.lyricsFull) ui.setLyricsFull(false);
        else ui.setNowPlaying(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!track) return null;
  const tint = rgb(shade(color, 0.55));

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      style={{
        background: `linear-gradient(180deg, ${rgb(shade(color, 0.9))} 0%, ${rgb(shade(color, 0.45))} 45%, #0b0b0c 100%)`,
        transform: dy ? `translateY(${dy}px)` : undefined,
        transition: dy ? "none" : "transform 0.2s",
      }}
    >
      <div className="fade-in pb-safe pt-safe mx-auto flex min-h-full w-full max-w-md flex-col px-6 pb-8 lg:max-w-6xl lg:flex-row lg:gap-12 lg:px-12">
        <div className="flex flex-col lg:flex-1 lg:justify-center">
          <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <header className="flex items-center justify-between py-3">
              <IconButton label="Collapse player" onClick={() => setNowPlaying(false)}>
                <ChevronDown size={28} />
              </IconButton>
              <div className="min-w-0 px-2 text-center">
                <div className="text-[11px] uppercase tracking-wider text-white/70">Playing from</div>
                <div className="truncate text-sm font-semibold">{source || track.album || "Your library"}</div>
              </div>
              <IconButton label="More options" onClick={() => openMenu(trackId)}>
                <Ellipsis size={24} />
              </IconButton>
            </header>
            <div className="mx-auto mt-2 w-full max-w-[min(100%,46dvh)] lg:max-w-[min(100%,52dvh)]">
              <Cover trackId={trackId} className="w-full rounded-lg shadow-2xl shadow-black/50" iconSize={64} />
            </div>
          </div>

          <div className="mt-6 min-w-0">
            <h1 className="truncate text-2xl font-bold">{track.title}</h1>
            <p className="truncate text-base text-white/70">{track.artist}</p>
          </div>

          <Scrubber className="mt-4" />

          <div className="mt-2 flex items-center justify-between">
            <ShuffleButton />
            <PrevButton size={30} />
            <PlayPauseButton size={68} />
            <NextButton size={30} />
            <RepeatButton />
          </div>

          <div className="mt-4 flex justify-between text-white/80">
            <IconButton label="Show lyrics" onClick={() => setLyricsFull(true)}>
              <Mic2 size={20} />
            </IconButton>
            <IconButton label="Open queue" onClick={() => setQueueOpen(true)}>
              <ListMusic size={22} />
            </IconButton>
          </div>
        </div>

        <section className="mt-6 lg:mt-14 lg:flex-1" aria-label="Lyrics">
          <div className="rounded-2xl p-5 lg:h-[70dvh]" style={{ background: tint }}>
            <div className="mb-3 text-sm font-bold text-white/90">Lyrics</div>
            <LyricsPanel
              mode="card"
              className="h-72 [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)] lg:h-[calc(70dvh-4.5rem)]"
              onOpen={() => setLyricsFull(true)}
            />
          </div>
        </section>
      </div>

      {lyricsFull && (
        <div className="fade-in fixed inset-0 z-[56] flex flex-col" style={{ background: rgb(shade(color, 0.7)) }}>
          <header className="pt-safe flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-bold">{track.title}</div>
              <div className="truncate text-sm text-white/70">{track.artist}</div>
            </div>
            <IconButton label="Close lyrics" onClick={() => setLyricsFull(false)}>
              <X size={26} />
            </IconButton>
          </header>
          <LyricsPanel mode="full" className="mx-auto w-full max-w-2xl flex-1 px-6" />
          <div className="pb-safe mx-auto w-full max-w-2xl px-6 pb-4 pt-2">
            <Scrubber />
            <div className="flex items-center justify-center gap-6 pt-1">
              <PrevButton />
              <PlayPauseButton size={56} />
              <NextButton />
            </div>
          </div>
        </div>
      )}
      {queueOpen && <QueueView onClose={() => setQueueOpen(false)} tint={rgb(shade(color, 0.5))} />}
    </div>
  );
}
