import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./bits";

/** Bottom sheet on mobile, centred dialog on desktop. */
export function Sheet({ title, onClose, children, z = 60 }: { title?: string; onClose: () => void; children: ReactNode; z?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 flex items-end justify-center lg:items-center" style={{ zIndex: z }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="sheet-in pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-surface2 p-2 shadow-2xl lg:max-w-md lg:rounded-2xl">
        {title && (
          <div className="flex items-center justify-between px-3 py-2">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function SheetItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left text-[0.9375rem] hover:bg-white/5 active:bg-white/10 ${danger ? "text-red-400" : ""}`}
    >
      <span className="w-5 shrink-0 text-white/70">{icon}</span>
      {label}
    </button>
  );
}
