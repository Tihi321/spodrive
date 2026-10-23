/** Full screen helpers (with webkit fallbacks) and the keeper that re-enters it after the browser drops it. */
import { create } from "zustand";
import { useSettings } from "../state/settings";
import { isLimitedBrowser } from "./device-auth";

interface WebkitDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const doc = () => document as WebkitDocument;

export function fullscreenSupported(): boolean {
  return !!(document.fullscreenEnabled || doc().webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(document.fullscreenElement || doc().webkitFullscreenElement);
}

export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as WebkitElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else await el.webkitRequestFullscreen?.();
  } catch {
    // needs a user gesture; the keeper retries on the next tap
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    if (!isFullscreen()) return;
    if (document.exitFullscreen) await document.exitFullscreen();
    else await doc().webkitExitFullscreen?.();
  } catch {
    // already out
  }
}

export const useFullscreen = create<{ active: boolean }>(() => ({ active: false }));

/** The toggle button: flips the setting and enters / leaves full screen (inside the click gesture). */
export function toggleFullscreen(): void {
  const on = !useSettings.getState().fullscreen;
  toggling = true;
  useSettings.getState().set("fullscreen", on);
  void (on ? enterFullscreen() : exitFullscreen()).finally(() => setTimeout(() => (toggling = false), 300));
}

let toggling = false;
let installed = false;

/**
 * Call once at startup. While the fullscreen setting is on and the page isn't full screen, the next tap re-enters it
 * (browsers need a user gesture). When full screen ends another way (Esc, back gesture) the setting stays on Silk,
 * where full screen is the point, and turns off elsewhere so Esc isn't fought.
 */
export function installFullscreenKeeper(): void {
  if (installed) return;
  installed = true;
  const sync = () => {
    const active = isFullscreen();
    const was = useFullscreen.getState().active;
    useFullscreen.setState({ active });
    if (was && !active && !toggling && !isLimitedBrowser() && useSettings.getState().fullscreen) {
      useSettings.getState().set("fullscreen", false);
    }
  };
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
  document.addEventListener(
    "pointerdown",
    (e) => {
      // a tap on the toggle itself is handled by toggleFullscreen (re-entering here would flash on the way out)
      if ((e.target as Element | null)?.closest?.("[data-fullscreen-toggle]")) return;
      if (useSettings.getState().fullscreen && !isFullscreen() && fullscreenSupported()) void enterFullscreen();
    },
    true,
  );
}
