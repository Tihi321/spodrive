import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

interface ToastState {
  items: Toast[];
  dismiss(id: number): void;
}

let nextId = 1;
export const useToasts = create<ToastState>((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(
  message: string,
  opts: { kind?: Toast["kind"]; action?: Toast["action"]; durationMs?: number } = {},
): void {
  if (useToasts.getState().items.some((t) => t.message === message)) return; // dedupe visible duplicates
  const id = nextId++;
  const t: Toast = { id, message, kind: opts.kind ?? "info", action: opts.action };
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), t] }));
  const ms = opts.durationMs ?? (opts.action ? 12000 : opts.kind === "error" ? 6000 : 3500);
  setTimeout(() => useToasts.getState().dismiss(id), ms);
}

export const toastError = (e: unknown, prefix?: string) =>
  toast(`${prefix ? prefix + ": " : ""}${e instanceof Error ? e.message : String(e)}`, { kind: "error" });
