import { useEffect, useMemo, useRef } from "react";
import { useLibrary } from "../lib/library";
import { formatDuration } from "../lib/library-index";
import { centeredScrollTop } from "../lib/scroll";
import { playerActions, usePlayer } from "../player/store";
import { Cover, Equalizer, cx } from "./bits";

/** The whole list being played from (playlist, album, ...), in its original order. Large rows for TV / desktop. */
export function SourceList({ className }: { className?: string }) {
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const source = usePlayer((s) => s.source);
  const context = usePlayer((s) => s.context);
  const queue = usePlayer((s) => s.queue);
  const byId = useLibrary((s) => s.index?.byId);
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Map<string, HTMLElement>>(new Map());
  const userScrollUntil = useRef(0);
  const firstScroll = useRef(true);

  const ids = useMemo(() => (context.length > 0 ? context : (queue.original ?? queue.items)), [context, queue.original, queue.items]);
  const rows = useMemo(() => ids.flatMap((id) => (byId?.get(id) ? [byId.get(id)!] : [])), [ids, byId]);

  useEffect(() => {
    const c = box.current;
    const el = trackId ? refs.current.get(trackId) : null;
    if (!c || !el || Date.now() < userScrollUntil.current) return;
    const top = centeredScrollTop(el.offsetTop, el.clientHeight, c.clientHeight, c.scrollHeight);
    c.scrollTo({ top, behavior: firstScroll.current ? "auto" : "smooth" });
    firstScroll.current = false;
  }, [trackId, rows]);

  const play = (id: string, i: number) => {
    const q = usePlayer.getState().queue;
    const at = q.items.indexOf(id);
    if (at >= 0) void playerActions.jump(at);
    else void playerActions.playTracks(ids, i, { shuffle: q.shuffle, source });
  };

  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="truncate text-sm font-bold text-white/90">{source || "Now playing"}</div>
        <div className="shrink-0 text-xs text-white/60">
          {rows.length} {rows.length === 1 ? "track" : "tracks"}
        </div>
      </div>
      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onWheel={() => (userScrollUntil.current = Date.now() + 3000)}
        onTouchMove={() => (userScrollUntil.current = Date.now() + 3000)}
      >
        {rows.map((t, i) => {
          const active = t.id === trackId;
          return (
            <button
              key={`${t.id}-${i}`}
              ref={(el) => {
                if (el) refs.current.set(t.id, el);
                else refs.current.delete(t.id);
              }}
              type="button"
              onClick={() => play(t.id, i)}
              aria-label={`Play ${t.title}`}
              aria-current={active || undefined}
              className={cx("flex w-full items-center gap-4 rounded-lg px-2 py-2.5 text-left hover:bg-white/10", active && "bg-white/10")}
            >
              <div className="relative shrink-0">
                <Cover trackId={t.id} className="h-14 w-14 rounded" iconSize={22} />
                {active && (
                  <span className="absolute inset-0 flex items-center justify-center rounded bg-black/55">
                    <Equalizer playing={playing} />
                  </span>
                )}
              </div>
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate text-lg font-medium", active && "text-accent")}>{t.title}</span>
                <span className="block truncate text-sm text-white/60">{t.artist}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-white/60">{formatDuration(t.durationSec)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
