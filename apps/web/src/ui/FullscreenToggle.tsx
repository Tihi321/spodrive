import { Maximize, Minimize } from "lucide-react";
import { fullscreenSupported, toggleFullscreen, useFullscreen } from "../lib/fullscreen";
import { useSettings } from "../state/settings";
import { IconButton } from "./bits";

/** Keeps the page in full screen while on. Renders nothing where the browser has no full screen API. */
export function FullscreenToggle({ size = 22, className }: { size?: number; className?: string }) {
  const wanted = useSettings((s) => s.fullscreen);
  const active = useFullscreen((s) => s.active);
  if (!fullscreenSupported()) return null;
  const on = wanted || active;
  return (
    <IconButton
      label={on ? "Exit full screen" : "Full screen"}
      active={on}
      onClick={toggleFullscreen}
      className={className}
      data-fullscreen-toggle=""
    >
      {on ? <Minimize size={size} /> : <Maximize size={size} />}
    </IconButton>
  );
}
