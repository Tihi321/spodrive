import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Folder, ListMusic, Pencil, Trash2 } from "lucide-react";
import type { Track } from "@spodrive/core";
import { useLibrary } from "../lib/library";
import { folderTrackIds, formatDuration, type Album } from "../lib/library-index";
import { deletePlaylist, renamePlaylist, reorderPlaylist, usePlaylists } from "../lib/playlists";
import { playerActions, usePlayer } from "../player/store";
import { folderKey, playlistKey, usePlayModes } from "../state/playmodes";
import { AlbumGrid } from "../ui/cards";
import { EmptyState, IconButton } from "../ui/bits";
import { DetailHeader } from "../ui/DetailHeader";
import { ConfirmSheet, PromptSheet } from "../ui/PromptSheet";
import { SortableItem, SortableList } from "../ui/Sortable";
import { TrackRow } from "../ui/TrackRow";
import { LibraryGate } from "./Home";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const totalTime = (tracks: Track[]) => {
  const s = tracks.reduce((a, t) => a + t.durationSec, 0);
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};

export function AlbumPage() {
  const { id } = useParams();
  return <LibraryGate>{(index) => <AlbumBody album={index.albumById.get(id ?? "")} byId={index.byId} />}</LibraryGate>;
}

function AlbumBody({ album: a, byId }: { album: Album | undefined; byId: Map<string, Track> }) {
  if (!a) return <EmptyState title="Album not found" />;
  const tracks = a.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t);
  const multiDisc = new Set(tracks.map((t) => t.discNo ?? 1)).size > 1;
  return (
    <div className="mx-auto max-w-5xl pb-8">
      <DetailHeader
        kind="Album"
        title={a.title}
        coverTrackId={a.coverTrackId}
        tracks={tracks}
        source={a.title}
        subtitle={`${a.artist}${a.year ? ` · ${a.year}` : ""} · ${plural(tracks.length, "song")}, ${totalTime(tracks)}`}
      />
      <div className="px-2">
        {tracks.map((t, i) => (
          <div key={t.id}>
            {multiDisc && (i === 0 || (tracks[i - 1]!.discNo ?? 1) !== (t.discNo ?? 1)) && (
              <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Disc {t.discNo ?? 1}</div>
            )}
            <TrackRow
              track={t}
              number={t.trackNo ?? i + 1}
              onPlay={() => void playerActions.playTracks(tracks.map((x) => x.id), i, { source: a.title })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArtistPage() {
  const { id } = useParams();
  return (
    <LibraryGate>
      {(index) => {
        const artist = index.artistById.get(id ?? "");
        if (!artist) return <EmptyState title="Artist not found" />;
        const tracks = artist.trackIds.map((i) => index.byId.get(i)).filter((t): t is Track => !!t);
        const albums = artist.albumIds.map((i) => index.albumById.get(i)!).filter(Boolean);
        return (
          <div className="mx-auto max-w-5xl pb-8">
            <DetailHeader
              kind="Artist"
              title={artist.name}
              coverTrackId={artist.coverTrackId}
              tracks={tracks}
              source={artist.name}
              round
              subtitle={`${plural(albums.length, "album")} · ${plural(tracks.length, "song")}`}
            />
            <section className="px-2">
              <h2 className="px-2 pb-1 pt-2 text-lg font-bold">Albums</h2>
              <AlbumGrid albums={albums} />
              <h2 className="px-2 pb-1 pt-6 text-lg font-bold">Songs</h2>
              {tracks.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  showAlbum
                  onPlay={() => void playerActions.playTracks(tracks.map((x) => x.id), i, { source: artist.name })}
                />
              ))}
            </section>
          </div>
        );
      }}
    </LibraryGate>
  );
}

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const playlist = usePlaylists((s) => s.file.playlists.find((p) => p.id === id && !p.deleted));
  const loaded = usePlaylists((s) => s.loaded);
  const index = useLibrary((s) => s.index);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // visible rows keep their original index in the playlist (for reorder/remove)
  const rows = useMemo(
    () =>
      (playlist?.trackIds ?? [])
        .map((tid, i) => ({ track: index?.byId.get(tid), i }))
        .filter((r): r is { track: Track; i: number } => !!r.track),
    [playlist?.trackIds, index],
  );

  if (!playlist) {
    return loaded ? (
      <EmptyState icon={<ListMusic size={40} />} title="Playlist not found">
        It may have been deleted on another device.
      </EmptyState>
    ) : null;
  }
  const tracks = rows.map((r) => r.track);
  const ids = rows.map((r) => String(r.i));

  return (
    <div className="mx-auto max-w-5xl pb-8">
      <DetailHeader
        kind="Playlist"
        title={playlist.name}
        coverTrackId={tracks[0]?.id}
        tracks={tracks}
        source={playlist.name}
        modeKey={playlistKey(playlist.id)}
        subtitle={<ModeSubtitle modeKey={playlistKey(playlist.id)} text={`${plural(tracks.length, "song")}${tracks.length ? `, ${totalTime(tracks)}` : ""}`} />}
        actions={
          <>
            <IconButton label="Rename playlist" onClick={() => setRenaming(true)} className="border border-white/20">
              <Pencil size={20} />
            </IconButton>
            <IconButton label="Delete playlist" onClick={() => setDeleting(true)} className="border border-white/20">
              <Trash2 size={20} />
            </IconButton>
          </>
        }
      />
      {renaming && (
        <PromptSheet title="Rename playlist" initial={playlist.name} submitLabel="Save" onClose={() => setRenaming(false)} onSubmit={(n) => renamePlaylist(playlist.id, n)} />
      )}
      {deleting && (
        <ConfirmSheet
          title="Delete playlist?"
          message={`"${playlist.name}" will be removed on all your devices. Tracks stay in your library.`}
          confirmLabel="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            deletePlaylist(playlist.id);
            navigate("/?tab=playlists", { replace: true });
          }}
        />
      )}
      <div className="px-2">
        {tracks.length === 0 ? (
          <EmptyState title="This playlist is empty">Use "Add to playlist" in a song's menu to fill it.</EmptyState>
        ) : (
          <SortableList ids={ids} onMove={(from, to) => reorderPlaylist(playlist.id, rows[from]!.i, rows[to]!.i)}>
            {rows.map((r, vi) => (
              <SortableItem key={r.i} id={String(r.i)}>
                {(handle) => (
                  <TrackRow
                    track={r.track}
                    showAlbum
                    leading={handle}
                    menuCtx={{ playlistId: playlist.id, index: r.i }}
                    onPlay={() =>
                      void playerActions.playTracks(tracks.map((x) => x.id), vi, { source: playlist.name, modeKey: playlistKey(playlist.id) })
                    }
                  />
                )}
              </SortableItem>
            ))}
          </SortableList>
        )}
        {tracks.length > 0 && <p className="px-3 pt-4 text-xs text-muted">Total {formatDuration(tracks.reduce((a, t) => a + t.durationSec, 0))}</p>}
      </div>
    </div>
  );
}

/** "12 songs, 48 min · Shuffle · Repeat" plus a hint when this playlist/folder is what's playing. */
function ModeSubtitle({ modeKey, text }: { modeKey: string; text: string }) {
  const mode = usePlayModes((s) => s.modes[modeKey]);
  const playingThis = usePlayer((s) => s.sourceKey === modeKey && s.trackId !== null);
  const parts = [text, mode?.shuffle && "Shuffle", mode?.repeat && "Repeat", playingThis && "Now playing"].filter(Boolean);
  return <>{parts.join(" · ")}</>;
}

export function FolderPage() {
  const { id } = useParams();
  const source = useLibrary((s) => s.library?.sources.find((x) => x.id === id && x.kind === "folder"));
  return (
    <LibraryGate>
      {(index) => {
        if (!source) {
          return (
            <EmptyState icon={<Folder size={40} />} title="Folder not found">
              It may have been removed from the library.
            </EmptyState>
          );
        }
        const tracks = folderTrackIds(index, source.id)
          .map((i) => index.byId.get(i))
          .filter((t): t is Track => !!t);
        const key = folderKey(source.id);
        return (
          <div className="mx-auto max-w-5xl pb-8">
            <DetailHeader
              kind="Folder"
              title={source.name}
              coverTrackId={tracks.find((t) => t.hasCover)?.id ?? tracks[0]?.id}
              tracks={tracks}
              source={source.name}
              modeKey={key}
              subtitle={<ModeSubtitle modeKey={key} text={`${plural(tracks.length, "song")}${tracks.length ? `, ${totalTime(tracks)}` : ""}`} />}
            />
            <div className="px-2">
              {tracks.length === 0 ? (
                <EmptyState title="No songs in this folder">Use "Rescan" in Settings after adding files to it in Drive.</EmptyState>
              ) : (
                tracks.map((t, i) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    showAlbum
                    onPlay={() => void playerActions.playTracks(tracks.map((x) => x.id), i, { source: source.name, modeKey: key })}
                  />
                ))
              )}
            </div>
          </div>
        );
      }}
    </LibraryGate>
  );
}
