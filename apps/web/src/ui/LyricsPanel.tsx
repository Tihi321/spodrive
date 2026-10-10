import { useEffect, useMemo, useRef } from "react";
import { activeLineIndex } from "@spodrive/core";
import { useLyrics } from "../lib/lyrics";
import { centeredScrollTop } from "../lib/scroll";
import { playerActions, usePlayer, useProgress } from "../player/store";
import { Skeleton, cx } from "./bits";

interface Props {
  mode: "card" | "full";
  className?: string;
  style?: React.CSSProperties;
  onOpen?: () => void;
}

export function LyricsPanel({ mode, className, style, onOpen }: Props) {
  const trackId = usePlayer((s) => s.trackId);
  const { status, result } = useLyrics(trackId);
  const lines = result.synced;
  const active = useProgress((s) => (lines ? activeLineIndex(lines, s.position * 1000) : -1));
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const userScrollUntil = useRef(0);
  const firstScroll = useRef(true);

  useEffect(() => {
    userScrollUntil.current = 0;
    box.current?.scrollTo({ top: 0 });
  }, [trackId]);

  useEffect(() => {
    const c = box.current;
    const el = active >= 0 ? refs.current[active] : null;
    if (!c || !el || Date.now() < userScrollUntil.current) return;
    const top = centeredScrollTop(el.offsetTop, el.clientHeight, c.clientHeight, c.scrollHeight);
    c.scrollTo({ top, behavior: firstScroll.current ? "auto" : "smooth" });
    firstScroll.current = false;
  }, [active, mode, lines]);

  const body = useMemo(() => {
    if (status === "disabled") return <Message>Lyrics are turned off. Enable them in Settings.</Message>;
    if (status === "loading")
      return (
        <div className="space-y-4 p-1" aria-label="Loading lyrics">
          {[80, 60, 90, 50, 70].map((w, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      );
    if (lines) {
      return (
        <div className={mode === "full" ? "space-y-5 py-[40%]" : "space-y-3 py-24"}>
          {lines.map((l, i) => (
            <p
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              onClick={
                mode === "full"
                  ? (e) => {
                      e.stopPropagation();
                      playerActions.seek(l.timeMs / 1000);
                    }
                  : undefined
              }
              className={cx(
                "font-bold leading-tight transition-all duration-300",
                mode === "full" ? "cursor-pointer text-3xl hover:text-white/80" : "text-2xl",
                i === active ? "scale-100 text-white" : i < active ? "text-white/35" : "text-white/50",
              )}
            >
              {l.text || "♪"}
            </p>
          ))}
        </div>
      );
    }
    if (result.plain) {
      return (
        <div>
          <p className="whitespace-pre-wrap text-lg font-semibold leading-relaxed text-white/85">{result.plain}</p>
          <p className="mt-4 text-xs text-white/45">Unsynced lyrics</p>
        </div>
      );
    }
    return <Message>No lyrics found for this track.</Message>;
  }, [status, lines, result.plain, active, mode]);

  return (
    <div
      ref={box}
      className={cx("relative overflow-y-auto", mode === "card" && "cursor-pointer", className)}
      style={style}
      onClick={mode === "card" ? onOpen : undefined}
      onWheel={() => (userScrollUntil.current = Date.now() + 3000)}
      onTouchMove={() => (userScrollUntil.current = Date.now() + 3000)}
      role={mode === "card" ? "button" : undefined}
      aria-label={mode === "card" ? "Open lyrics" : "Lyrics"}
    >
      {body}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-sm text-white/60">{children}</div>;
}
