/** navigator.onLine as a store (one set of listeners for the whole app, cheap to read from every track row). */
import { create } from "zustand";

export const useNetwork = create<{ online: boolean }>(() => ({ online: typeof navigator === "undefined" ? true : navigator.onLine }));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => useNetwork.setState({ online: true }));
  window.addEventListener("offline", () => useNetwork.setState({ online: false }));
}

export const useOnline = (): boolean => useNetwork((s) => s.online);
