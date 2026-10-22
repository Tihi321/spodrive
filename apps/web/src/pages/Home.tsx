import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Folder, FolderPlus, HardDrive, ListMusic, Plus, Search, Shuffle, X } from "lucide-react";
import type { Track } from "@spodrive/core";
import { useAuth } from "../lib/auth";
import { useLibrary, syncLibrary } from "../lib/library";
import { addFolders, addMusic, useScan } from "../lib/library-actions";
import { searchLibrary, type LibraryIndex } from "../lib/library-index";
import { activePlaylists, createPlaylist, usePlaylists } from "../lib/playlists";
import { playerActions, useRecent } from "../player/store";
import { AlbumGrid, ArtistRow } from "../ui/cards";
import { Button, Cover, EmptyState, Skeleton, Spinner, cx } from "../ui/bits";
import { PromptSheet } from "../ui/PromptSheet";
import { TrackRow } from "../ui/TrackRow";

const TABS = [
  ["songs", "Songs"],
  ["albums", "Albums"],
  ["artists", "Artists"],
  ["playlists", "Playlists"],
  ["folders", "Folders"],
] as const;
type Tab = (typeof TABS)[number][0];

export function LibraryGate({ children }: { children: (index: LibraryIndex) => React.ReactNode }) {
  const status = useLibrary((s) => s.status);
  const index = useLibrary((s) => s.index);
  const error = useLibrary((s) => s.error);
  if (index && index.tracks.length > 0) return <>{children(index)}</>;
  if (status === "loading" || status === "idle") {
    return (
      <div className="space-y-3 p-4" aria-label="Loading library">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-11 w-11" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <EmptyState title="Could not load your library">
        <p className="mb-4">{error}</p>
        <Button onClick={() => void syncLibrary().catch(() => undefined)}>Try again</Button>
      </EmptyState>
    );
  }
  return <EmptyLibrary />;
}

function EmptyLibrary() {
  const scan = useScan();
  const device = useAuth((s) => s.token?.via === "device");
  if (device) {
    return (
      <EmptyState title="Your library is empty" icon={<HardDrive size={40} />}>
        <p>Add music from your phone or computer. It shows up here after a refresh.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Your library is empty" icon={<HardDrive size={40} />}>
      <p className="mb-4">
        Add albums folder by folder: choose the folders, then select the songs in each one. You can also pick single songs, or upload them from this device (use the Upload tab; they go to Spodrive/Music in your Drive). Spodrive only sees what you pick or upload.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button disabled={scan.running} onClick={() => void addFolders()}>
          {scan.running ? <Spinner size={16} /> : <FolderPlus size={16} />}{" "}
          {scan.running ? `Adding ${scan.progress.done}/${scan.progress.total}` : "Add folders"}
        </Button>
        <Button variant="ghost" disabled={scan.running} onClick={() => void addMusic()}>
          <Plus size={16} /> Add music from Google Drive
        </Button>
      </div>
    </EmptyState>
  );
}

export function SearchBox({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search songs, albums, artists"
        aria-label="Search library"
        className="w-full rounded-full bg-white/10 py-2.5 pl-10 pr-10 text-sm outline-none placeholder:text-white/45 focus:bg-white/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white" onClick={() => onChange("")}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

export function SearchResults({ index, q }: { index: LibraryIndex; q: string }) {
  const res = useMemo(() => searchLibrary(index, q), [index, q]);
  const none = res.tracks.length + res.albums.length + res.artists.length === 0;
  if (none) return <EmptyState title="No results" icon={<Search size={40} />}>Nothing matches "{q}".</EmptyState>;
  const play = (list: Track[], i: number) => void playerActions.playTracks(list.map((t) => t.id), i, { source: `Search "${q}"` });
  return (
    <div className="space-y-6 pb-6">
      {res.artists.length > 0 && (
        <section>
          <h2 className="px-2 pb-1 text-lg font-bold">Artists</h2>
          {res.artists.slice(0, 5).map((a) => (
            <ArtistRow key={a.id} artist={a} />
          ))}
        </section>
      )}
      {res.albums.length > 0 && (
        <section>
          <h2 className="px-2 pb-1 text-lg font-bold">Albums</h2>
          <AlbumGrid albums={res.albums.slice(0, 12)} />
        </section>
      )}
      {res.tracks.length > 0 && (
        <section>
          <h2 className="px-2 pb-1 text-lg font-bold">Songs</h2>
          {res.tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} showAlbum onPlay={() => play(res.tracks, i)} />
          ))}
        </section>
      )}
    </div>
  );
}

function RecentRow({ index }: { index: LibraryIndex }) {
  const ids = useRecent((s) => s.ids);
  const tracks = ids.map((id) => index.byId.get(id)).filter((t): t is Track => !!t);
  if (tracks.length === 0) return null;
  return (
    <section className="pb-2" aria-label="Recently played">
      <h2 className="px-4 pb-2 text-lg font-bold">Recently played</h2>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
        {tracks.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="w-28 shrink-0 text-left"
            onClick={() => void playerActions.playTracks(tracks.map((x) => x.id), i, { source: "Recently played" })}
            aria-label={`Play ${t.title}`}
          >
            <Cover trackId={t.id} className="w-28 rounded-md shadow-md shadow-black/40" />
            <div className="mt-1.5 truncate text-xs font-semibold">{t.title}</div>
            <div className="truncate text-[11px] text-muted">{t.artist}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function PlaylistsTab() {
  const file = usePlaylists((s) => s.file);
  const byId = useLibrary((s) => s.index?.byId);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const lists = activePlaylists(file);
  return (
    <div>
      <div className="px-2 pb-2">
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={16} /> New playlist
        </Button>
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
      {lists.length === 0 && (
        <EmptyState icon={<ListMusic size={40} />} title="No playlists yet">
          Create one here, or use "Add to playlist" from any track menu.
        </EmptyState>
      )}
      {lists.map((p) => {
        const first = p.trackIds.find((id) => byId?.has(id));
        return (
          <Link key={p.id} to={`/playlist/${p.id}`} className="row-cv flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
            <Cover trackId={first} className="h-14 w-14 shrink-0 rounded" iconSize={22} />
            <div className="min-w-0">
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-xs text-muted">
                Playlist · {p.trackIds.length} {p.trackIds.length === 1 ? "song" : "songs"}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function FoldersTab({ index }: { index: LibraryIndex }) {
  if (index.folders.length === 0) {
    return (
      <EmptyState icon={<Folder size={40} />} title="No folders yet">
        Songs are grouped by the Drive folder they sit in. Add a folder (or songs from one) and it shows up here.
      </EmptyState>
    );
  }
  return (
    <div>
      {index.folders.map((f) => (
        <Link key={f.id} to={`/folder/${f.id}`} className="row-cv flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
          <Cover trackId={f.coverTrackId} className="h-14 w-14 shrink-0 rounded" iconSize={22} />
          <div className="min-w-0">
            <div className="truncate font-medium">{f.name}</div>
            <div className="truncate text-xs text-muted">
              {f.parents.length > 0 ? `${f.parents.join(" / ")} · ` : "Folder · "}
              {f.trackIds.length} {f.trackIds.length === 1 ? "song" : "songs"}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function Home() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "songs") as Tab;
  const [q, setQ] = useState("");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="mx-auto max-w-6xl pb-6">
      <div className="sticky top-0 z-10 bg-bg/95 px-4 pb-2 pt-4 backdrop-blur">
        <div className="mb-3 flex items-center gap-2 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <h1 className="text-xl font-bold">Spodrive</h1>
        </div>
        <SearchBox value={q} onChange={setQ} />
        {!q && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" role="tablist">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setParams(key === "songs" ? {} : { tab: key }, { replace: true })}
                className={cx(
                  "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition",
                  tab === key ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/15",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <LibraryGate>
        {(index) =>
          q.trim() ? (
            <div className="px-2">
              <SearchResults index={index} q={q} />
            </div>
          ) : (
            <>
              <div className="pt-2">
                <RecentRow index={index} />
              </div>
              <div className="px-2 pt-2">
                {tab === "songs" && (
                  <>
                    <div className="flex items-center justify-between px-2 pb-2">
                      <span className="text-sm text-muted">{index.tracks.length} songs</span>
                      <Button
                        variant="ghost"
                        className="!px-4 !py-1.5"
                        onClick={() =>
                          void playerActions.playTracks(index.tracks.map((t) => t.id), Math.floor(Math.random() * index.tracks.length), {
                            shuffle: true,
                            source: "Your library",
                          })
                        }
                      >
                        <Shuffle size={16} /> Shuffle all
                      </Button>
                    </div>
                    {index.tracks.map((t, i) => (
                      <TrackRow
                        key={t.id}
                        track={t}
                        showAlbum
                        onPlay={() => void playerActions.playTracks(index.tracks.map((x) => x.id), i, { source: "Your library" })}
                      />
                    ))}
                  </>
                )}
                {tab === "albums" && <AlbumGrid albums={index.albums} />}
                {tab === "artists" && index.artists.map((a) => <ArtistRow key={a.id} artist={a} />)}
                {tab === "playlists" && <PlaylistsTab />}
                {tab === "folders" && <FoldersTab index={index} />}
              </div>
            </>
          )
        }
      </LibraryGate>
    </div>
  );
}
