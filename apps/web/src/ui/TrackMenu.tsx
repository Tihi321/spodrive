import { useNavigate } from "react-router-dom";
import { CircleArrowDown, Disc3, ListEnd, ListPlus, ListStart, Trash2, User } from "lucide-react";
import { useLibrary } from "../lib/library";
import { downloadTracks, removeDownloads, useOffline } from "../lib/offline";
import { removeTrackFromPlaylist } from "../lib/playlists";
import { playerActions } from "../player/store";
import { useUi } from "../state/ui";
import { toastError } from "../state/toasts";
import { Cover } from "./bits";
import { Sheet, SheetItem } from "./Sheet";
import { artistIdOf, albumIdOf } from "../lib/nav";

/** Global track context menu. */
export function TrackMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const openPicker = useUi((s) => s.openPicker);
  const setNowPlaying = useUi((s) => s.setNowPlaying);
  const index = useLibrary((s) => s.index);
  const downloaded = useOffline((s) => (menu ? s.downloaded.has(menu.trackId) : false));
  const navigate = useNavigate();
  const track = menu && index?.byId.get(menu.trackId);
  if (!menu || !track || !index) return null;

  const go = (path: string) => {
    close();
    setNowPlaying(false);
    navigate(path);
  };
  const albumId = albumIdOf(index, track);
  const artistId = artistIdOf(index, track);

  return (
    <Sheet onClose={close}>
      <div className="flex items-center gap-3 border-b border-white/10 px-3 pb-3 pt-2">
        <Cover trackId={track.id} className="h-12 w-12 rounded" />
        <div className="min-w-0">
          <div className="truncate font-semibold">{track.title}</div>
          <div className="truncate text-sm text-muted">{track.artist}</div>
        </div>
      </div>
      <SheetItem
        icon={<ListStart size={20} />}
        label="Play next"
        onClick={() => {
          playerActions.playNext(track.id);
          close();
        }}
      />
      <SheetItem
        icon={<ListEnd size={20} />}
        label="Add to queue"
        onClick={() => {
          playerActions.addToQueue(track.id);
          close();
        }}
      />
      <SheetItem icon={<ListPlus size={20} />} label="Add to playlist" onClick={() => openPicker([track.id])} />
      {menu.playlistId !== undefined && menu.index !== undefined && (
        <SheetItem
          icon={<Trash2 size={20} />}
          label="Remove from this playlist"
          onClick={() => {
            removeTrackFromPlaylist(menu.playlistId!, menu.index!);
            close();
          }}
        />
      )}
      {albumId && <SheetItem icon={<Disc3 size={20} />} label="Go to album" onClick={() => go(`/album/${albumId}`)} />}
      {artistId && <SheetItem icon={<User size={20} />} label="Go to artist" onClick={() => go(`/artist/${artistId}`)} />}
      {downloaded ? (
        <SheetItem
          icon={<Trash2 size={20} />}
          label="Remove download"
          onClick={() => {
            void removeDownloads([track.id]).catch((e) => toastError(e));
            close();
          }}
        />
      ) : (
        <SheetItem
          icon={<CircleArrowDown size={20} />}
          label="Download"
          onClick={() => {
            void downloadTracks([track]);
            close();
          }}
        />
      )}
    </Sheet>
  );
}
