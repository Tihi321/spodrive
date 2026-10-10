import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Music } from "lucide-react";
import { useCover } from "../lib/covers";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}
export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-full p-2 transition hover:text-white active:scale-95 disabled:opacity-40",
        active ? "text-accent" : "text-white/80",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} aria-hidden />;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-muted">
      <div className="text-white/40">{icon ?? <Music size={40} />}</div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={cx("eq inline-flex h-4 items-end", !playing && "paused")} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-white/30 border-t-white"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Square cover art with a placeholder. */
export function Cover({ trackId, className, iconSize = 24 }: { trackId?: string | null; className?: string; iconSize?: number }) {
  const url = useCover(trackId);
  return (
    <div className={cx("relative aspect-square overflow-hidden bg-gradient-to-br from-surface2 to-surface", className)}>
      {url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/25">
          <Music size={iconSize} />
        </div>
      )}
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50",
        variant === "primary" && "bg-accent text-black hover:brightness-110",
        variant === "ghost" && "border border-white/25 text-white hover:border-white/60",
        variant === "danger" && "border border-red-500/50 text-red-400 hover:bg-red-500/10",
        className,
      )}
      {...rest}
    />
  );
}
