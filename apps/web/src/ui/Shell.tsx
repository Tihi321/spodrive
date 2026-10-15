import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, ListMusic, Plus, Search, Settings, WifiOff } from "lucide-react";
import { reconnect, useAuth } from "../lib/auth";
import { activePlaylists, createPlaylist, usePlaylists } from "../lib/playlists";
import { useLibrary } from "../lib/library";
import { useShortcuts } from "../lib/shortcuts";
import { useOnline } from "../state/network";
import { Button, cx } from "./bits";
import { NowPlaying } from "./NowPlaying";
import { DesktopPlayerBar, MiniPlayer } from "./PlayerBars";
import { PlaylistPicker } from "./PlaylistPicker";
import { TrackMenu } from "./TrackMenu";
import { PromptSheet } from "./PromptSheet";


const navItems = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

function Logo() {
  return (
    <div className="flex items-center gap-2 px-3 py-4">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
      <span className="text-lg font-bold tracking-tight">Spodrive</span>
    </div>
  );
}

function Sidebar() {
  const file = usePlaylists((s) => s.file);
  const navigate = useNavigate();
  const lists = activePlaylists(file);
  const [creating, setCreating] = useState(false);
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-black p-2 lg:flex">
      <Logo />
      <nav className="flex flex-col gap-1" aria-label="Main">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold hover:text-white", isActive ? "bg-white/10 text-white" : "text-muted")
            }
          >
            <Icon size={20} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wider text-muted">
        Playlists
        <button
          aria-label="Create playlist"
          title="Create playlist"
          className="rounded p-1 hover:text-white"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
        </button>
      </div>
      {creating && (
        <PromptSheet
          title="New playlist"
          initial="New playlist"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) => navigate(`/playlist/${createPlaylist(name)}`)}
        />
      )}
      <div className="flex flex-col gap-0.5">
        {lists.map((p) => (
          <NavLink
            key={p.id}
            to={`/playlist/${p.id}`}
            className={({ isActive }) => cx("flex items-center gap-2 truncate rounded-lg px-3 py-2 text-sm hover:text-white", isActive ? "bg-white/10 text-white" : "text-muted")}
          >
            <ListMusic size={16} className="shrink-0" /> <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {lists.length === 0 && <p className="px-3 text-xs text-muted">No playlists yet</p>}
      </div>
    </aside>
  );
}

function BottomNav() {
  return (
    <nav className="pb-safe flex shrink-0 border-t border-line bg-black/95 lg:hidden" aria-label="Main">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "text-white" : "text-muted")}
        >
          <Icon size={22} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Banners() {
  const online = useOnline();
  const needsReconnect = useAuth((s) => s.needsReconnect);
  const syncing = useLibrary((s) => s.syncing);
  return (
    <>
      {needsReconnect && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/15 px-4 py-2 text-sm text-amber-200" role="alert">
          <span>Google session expired. Downloaded songs still play; streaming from Drive needs you to reconnect.</span>
          <Button className="!px-4 !py-1.5" onClick={() => void reconnect()}>
            Reconnect Google
          </Button>
        </div>
      )}
      {!online && (
        <div className="flex items-center gap-2 bg-white/10 px-4 py-1.5 text-xs text-white/80" role="status">
          <WifiOff size={14} /> Offline. Downloaded tracks and cached library are available.
        </div>
      )}
      {syncing && <div className="h-0.5 w-full animate-pulse bg-accent/70" aria-hidden />}
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  useShortcuts();
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Banners />
          <main className="pt-safe min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <MiniPlayer />
      <BottomNav />
      <DesktopPlayerBar />
      <NowPlaying />
      <TrackMenu />
      <PlaylistPicker />
    </div>
  );
}
