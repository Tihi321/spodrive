import { useState } from "react";
import { ListMusic, Plus } from "lucide-react";
import { activePlaylists, addTracksToPlaylist, createPlaylist, usePlaylists } from "../lib/playlists";
import { useUi } from "../state/ui";
import { toast } from "../state/toasts";
import { Sheet, SheetItem } from "./Sheet";

export function PlaylistPicker() {
  const picker = useUi((s) => s.picker);
  const close = useUi((s) => s.closePicker);
  const file = usePlaylists((s) => s.file);
  const [name, setName] = useState("");
  if (!picker) return null;
  const lists = activePlaylists(file);
  const n = picker.trackIds.length;
  const label = n === 1 ? "track" : "tracks";

  const done = (playlistName: string) => {
    toast(`Added ${n} ${label} to ${playlistName}`, { kind: "success" });
    setName("");
    close();
  };

  return (
    <Sheet title="Add to playlist" onClose={close} z={70}>
      <form
        className="flex gap-2 px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const nm = name.trim() || "New playlist";
          createPlaylist(nm, picker.trackIds);
          done(nm);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          aria-label="New playlist name"
          className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:bg-white/15"
        />
        <button className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black" type="submit">
          <Plus size={16} /> Create
        </button>
      </form>
      {lists.length === 0 && <p className="px-4 pb-4 text-sm text-muted">No playlists yet. Create your first one above.</p>}
      {lists.map((p) => (
        <SheetItem
          key={p.id}
          icon={<ListMusic size={20} />}
          label={`${p.name} (${p.trackIds.length})`}
          onClick={() => {
            addTracksToPlaylist(p.id, picker.trackIds);
            done(p.name);
          }}
        />
      ))}
    </Sheet>
  );
}
