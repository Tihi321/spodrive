/** Talk to the service worker (page side). */
import { pageScope, streamUrl } from "./urls";

export function postToSw(message: unknown): void {
  if (!("serviceWorker" in navigator)) return;
  const send = (sw: ServiceWorker | null | undefined) => sw?.postMessage(message);
  if (navigator.serviceWorker.controller) send(navigator.serviceWorker.controller);
  else void navigator.serviceWorker.ready.then((r) => send(r.active)).catch(() => undefined);
}

/** Tell the SW to drop its memoized library/blob caches (lock, library change, downloads removed). */
export const refreshSw = () => postToSw({ type: "refresh" });

/** Resolve true once the SW controls this page (needed for /stream/ interception). */
export async function swControlsPage(timeoutMs = 2500): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(rej, timeoutMs))]);
  } catch {
    return false;
  }
  if (navigator.serviceWorker.controller) return true;
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(!!navigator.serviceWorker.controller), timeoutMs);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(t);
        resolve(true);
      },
      { once: true },
    );
  });
}

export const trackStreamUrl = (trackId: string) => streamUrl(pageScope(), trackId);
