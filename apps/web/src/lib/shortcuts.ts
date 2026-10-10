import { useEffect } from "react";
import { playerActions, usePlayer, useProgress } from "../player/store";

/** Desktop keyboard shortcuts: space play/pause, arrows seek/volume, N/P next/previous. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return;
        if (tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
        if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
        if (tag === "INPUT" && e.key.startsWith("Arrow")) return; // let sliders handle their own arrows
      }
      const { trackId, volume } = usePlayer.getState();
      if (!trackId) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          void playerActions.toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          e.shiftKey ? void playerActions.next(false) : playerActions.seek(useProgress.getState().position + 5);
          break;
        case "ArrowLeft":
          e.preventDefault();
          e.shiftKey ? void playerActions.prev() : playerActions.seek(useProgress.getState().position - 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          playerActions.setVolume(Math.min(1, volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          playerActions.setVolume(Math.max(0, volume - 0.05));
          break;
        case "n":
        case "N":
          void playerActions.next(false);
          break;
        case "p":
        case "P":
          void playerActions.prev();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
