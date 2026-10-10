import { ChevronDown, X } from "lucide-react";
import { useLibrary } from "../lib/library";
import { playerActions, usePlayer } from "../player/store";
import { Cover, IconButton, Equalizer } from "./bits";
import { SortableItem, SortableList } from "./Sortable";

export function QueueView({ onClose, tint }: { onClose: () => void; tint?: string }) {
  const queue = usePlayer((s) => s.queue);
  const playing = usePlayer((s) => s.playing);
  const byId = useLibrary((s) => s.index?.byId);
  const current = queue.index >= 0 ? byId?.get(queue.items[queue.index]!) : undefined;
  const nextIdx = queue.items.map((_, i) => i).filter((i) => i > queue.index);
  const ids = nextIdx.map((i) => String(i));

  return (
    <div className="fade-in fixed inset-0 z-[57] flex flex-col" style={{ background: tint ?? "#0b0b0c" }} role="dialog" aria-label="Queue">
      <header className="pt-safe flex items-center justify-between px-3 py-3">
        <IconButton label="Close queue" onClick={onClose}>
          <ChevronDown size={28} />
        </IconButton>
        <h2 className="text-base font-bold">Queue</h2>
        <span className="w-10" />
      </header>
      <div className="pb-safe mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-3 pb-6">
        <h3 className="px-2 pb-2 pt-3 text-sm font-semibold text-white/70">Now playing</h3>
        {current ? (
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <Cover trackId={current.id} className="h-11 w-11 rounded" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-accent">{current.title}</div>
              <div className="truncate text-xs text-white/65">{current.artist}</div>
            </div>
            <Equalizer playing={playing} />
          </div>
        ) : (
          <p className="px-2 text-sm text-white/60">Nothing playing.</p>
        )}

        <h3 className="px-2 pb-2 pt-5 text-sm font-semibold text-white/70">Next up</h3>
        {nextIdx.length === 0 && <p className="px-2 text-sm text-white/60">The queue is empty. Add tracks from any menu.</p>}
        <SortableList ids={ids} onMove={(from, to) => playerActions.moveInQueue(nextIdx[from]!, nextIdx[to]!)}>
          {nextIdx.map((qi) => {
            const t = byId?.get(queue.items[qi]!);
            return (
              <SortableItem key={qi} id={String(qi)}>
                {(handle) => (
                  <div className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-white/5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => void playerActions.jump(qi)}
                      aria-label={`Play ${t?.title ?? "track"}`}
                    >
                      <Cover trackId={t?.id} className="h-11 w-11 shrink-0 rounded" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t?.title ?? "Unavailable track"}</span>
                        <span className="block truncate text-xs text-white/65">{t?.artist}</span>
                      </span>
                    </button>
                    <IconButton label="Remove from queue" onClick={() => void playerActions.removeFromQueue(qi)} className="text-white/60">
                      <X size={18} />
                    </IconButton>
                    {handle}
                  </div>
                )}
              </SortableItem>
            );
          })}
        </SortableList>
      </div>
    </div>
  );
}
