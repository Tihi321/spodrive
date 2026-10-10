import { create } from "zustand";

interface UiState {
  nowPlaying: boolean;
  lyricsFull: boolean;
  queueOpen: boolean;
  /** Track context menu (optionally from inside a playlist, enabling "remove from playlist"). */
  menu: { trackId: string; playlistId?: string; index?: number } | null;
  /** "Add to playlist" picker. */
  picker: { trackIds: string[] } | null;
  setNowPlaying(open: boolean): void;
  setLyricsFull(open: boolean): void;
  setQueueOpen(open: boolean): void;
  openMenu(trackId: string, ctx?: { playlistId?: string; index?: number }): void;
  closeMenu(): void;
  openPicker(trackIds: string[]): void;
  closePicker(): void;
}

export const useUi = create<UiState>((set) => ({
  nowPlaying: false,
  lyricsFull: false,
  queueOpen: false,
  menu: null,
  picker: null,
  setNowPlaying: (nowPlaying) => set(nowPlaying ? { nowPlaying } : { nowPlaying, lyricsFull: false, queueOpen: false }),
  setLyricsFull: (lyricsFull) => set({ lyricsFull }),
  setQueueOpen: (queueOpen) => set({ queueOpen }),
  openMenu: (trackId, ctx) => set({ menu: { trackId, ...ctx } }),
  closeMenu: () => set({ menu: null }),
  openPicker: (trackIds) => set({ picker: { trackIds }, menu: null }),
  closePicker: () => set({ picker: null }),
}));
