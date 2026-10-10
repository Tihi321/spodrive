import { useToasts } from "../state/toasts";

const colors = {
  info: "border-white/15",
  success: "border-accent/60",
  error: "border-red-500/60",
} as const;

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-28"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`fade-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-surface2 px-4 py-3 text-sm shadow-xl ${colors[t.kind]}`}
        >
          <span className="min-w-0 break-words">{t.message}</span>
          {t.action && (
            <button
              className="shrink-0 font-semibold text-accent"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="shrink-0 text-white/50 hover:text-white" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
