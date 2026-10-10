import { Link } from "react-router-dom";
import type { Album, Artist } from "../lib/library-index";
import { Cover } from "./bits";

export function AlbumCard({ album }: { album: Album }) {
  return (
    <Link to={`/album/${album.id}`} className="group block min-w-0 rounded-lg p-2 transition hover:bg-white/5" aria-label={`${album.title} by ${album.artist}`}>
      <Cover trackId={album.coverTrackId} className="w-full rounded-md shadow-lg shadow-black/40" iconSize={40} />
      <div className="mt-2 truncate text-sm font-semibold">{album.title}</div>
      <div className="truncate text-xs text-muted">
        {album.year ? `${album.year} · ` : ""}
        {album.artist}
      </div>
    </Link>
  );
}

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
      {albums.map((a) => (
        <AlbumCard key={a.id} album={a} />
      ))}
    </div>
  );
}

export function ArtistRow({ artist }: { artist: Artist }) {
  const n = artist.albumIds.length;
  return (
    <Link to={`/artist/${artist.id}`} className="row-cv flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
      <Cover trackId={artist.coverTrackId} className="h-14 w-14 shrink-0 rounded-full" iconSize={22} />
      <div className="min-w-0">
        <div className="truncate font-medium">{artist.name}</div>
        <div className="text-xs text-muted">
          {n} {n === 1 ? "album" : "albums"} · {artist.trackIds.length} {artist.trackIds.length === 1 ? "song" : "songs"}
        </div>
      </div>
    </Link>
  );
}
