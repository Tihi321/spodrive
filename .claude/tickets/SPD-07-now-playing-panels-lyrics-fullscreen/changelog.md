# SPD-07 changelog

## 2026-10-23: Now Playing side panels, large text, full screen, own lyrics

Now Playing (desktop / Echo) has switchable Lyrics and Playlist panels. Large text turns on automatically on Silk. A remembered full screen toggle is added. You can import your own `.lrc` lyrics, which are stored in `/Spodrive/lyrics` on Drive. VibeFlow can now write LRC files (VWT-05).

### spodrive (branch `SPD-07_now-playing-panels`, from `origin/master`)

All paths are under `apps/web/` unless noted.

- `src/state/settings.ts`
  - New settings: `npLyrics`, `npPlaylist`, `largeText` (`auto`/`on`/`off`) and `fullscreen`. Every setting is now saved.
  - `useLargeText()`: `auto` means large on Silk / `?device=1`.
- `src/ui/NowPlaying.tsx`
  - At `lg`, the header has the Lyrics and Playlist panel toggles, the full screen toggle and More. The bottom lyrics/queue row shows only below `lg`.
  - The player column has a fixed width, with the enabled panels side by side to its right. With both panels off, the player is centered.
  - With large text on, the cover is capped at 40dvh.
- `src/ui/SourceList.tsx` (new): the whole list being played, in its original order, with large rows.
  - The current track is highlighted and auto-centered. Auto-scroll pauses for 3 s after you scroll.
  - Tapping a song jumps to it in the queue, or restarts the list at that song.
- `src/player/store.ts`: new `context` (the ids the list was started with). It is saved and restored (only ids still in the library are kept), and cleared on reset or when the queue empties.
- `src/lib/fullscreen.ts`, `src/ui/FullscreenToggle.tsx` (new)
  - Full screen enter and exit, with webkit fallbacks, and an `active` store.
  - The keeper re-enters full screen on the next tap while the setting is on. Taps on the toggle itself are ignored.
  - If full screen ends some other way, the setting stays on for Silk and turns off elsewhere.
  - The toggle is hidden when the browser has no full screen API. It appears in the sidebar logo row and the Now Playing header.
- `src/App.tsx`, `src/main.tsx`: set `<html data-size="large">` and install the full screen keeper.
- `src/index.css`: `html[data-size=large] { font-size: 125% }`, a `large:` custom variant, and `.row-cv` intrinsic size in rem.
- `src/ui/TrackRow.tsx`, `src/ui/Shell.tsx`, `src/ui/Sheet.tsx`, `src/pages/Home.tsx`, `src/pages/SettingsPage.tsx`: px font sizes are now rem, so they scale with large text.
- `src/pages/SettingsPage.tsx`: a "Text size" choice (Automatic / Normal / Large) and the **Import lyrics files (.lrc)** button.
- `src/lib/drive.ts`
  - Shared `ensureSubfolderId(key)` (uploads and lyrics), `ensureLyricsFolderId`, `findLyricsFolderId` (doesn't create) and `deleteFile`.
  - `modifiedTime` is added to the file fields.
- `src/lib/db.ts`: `DriveIds.lyricsId`.
- `src/lib/user-lyrics.ts` (new)
  - Index of `/Spodrive/lyrics/<trackId>.lrc`, loaded once per session and refreshed on focus, online and visibility (throttled to 20 s).
  - Save, remove, `useLyricsVersion` and `useHasUserLyrics`.
- `src/lib/lyrics-fetch.ts`
  - User lyrics are checked first. They beat lrclib, including a cached "missing" entry.
  - They are re-downloaded only when Drive's `modifiedTime` changes, and the cached copy is kept while offline.
- `src/lib/lyrics.ts`: passes in the user source. The memo is cleared on a lyrics version bump, and `useLyrics` re-runs.
- `src/lib/lyrics-import.ts` (new)
  - Normalizing names (diacritics, đ), reading `[ti:]`/`[ar:]` tags, validation (200 KB cap; timed lines or plain text), the 4-step `matchLrcFiles`, the summary text, and the file picker.
  - Files that aren't valid UTF-8 are read as windows-1250.
- `src/ui/LyricsImport.tsx` (new): `ImportLyricsButton`, which imports several files and shows one summary toast.
- `src/ui/TrackMenu.tsx`: "Add lyrics file…" and "Remove my lyrics" (shown only when the track has your own lyrics).
- `src/lib/session.ts`: loads the lyrics index after sign-in, refreshes it on reconnect, and resets it on sign-out.
- `test/lyrics-import.test.ts` (new, 12 tests), `test/lyrics.test.ts` (user-lyrics cases).
- `README.md`, `public/privacy.html`: mention `/Spodrive/lyrics`.

### vibe-whisper-flow (branch `VWT-05_lrc-lyrics`)

See `vibe-whisper-flow/.claude/tickets/VWT-05-lrc-lyrics/changelog.md`. In short: an LRC output format, a multi-file batch that saves next to each source, `read_tags`, tests and a README section.

### Deviations

- The `fetchLyricsFor` `user` dep is `{ modifiedTime(id), download(id) }` rather than a single function. `undefined` means the index isn't loaded yet.
- The `loadLyrics` memo is cleared fully on a version bump, not per track. Lrclib results stay cached in IDB.
- There is no player-store test for `context` and no full screen test, because the store needs IDB/DOM and the tests run in node.
- VibeFlow's LRC `length` comes from the container duration. The orchestrator asked for this after review.
- An orchestrator fix: the full screen keeper ignores taps on the toggle, so turning it off after a reload doesn't flash full screen.

### Verification

- spodrive: `npm run lint` is clean, `npm test` gives 132 passed (12 files), and `npm run build -w @spodrive/web` is OK.
- vibe-whisper-flow: `.venv\Scripts\python.exe -m pytest tests -q` gives 243 passed.
- **Not run:**
  - The layout at 1280×720 and large text fitting in 720 px.
  - Full screen behavior in a browser and on Silk.
  - Real Drive create, update, list and delete of lyrics files.
  - Importing in a browser, and the windows-1250 decode.
  - A VibeFlow GUI batch with real songs and Cancel.
  - The Echo Show check.

### Follow-ups

- A manual QA pass on desktop and on the Echo, following the plan's Verification 2–7.
- Phones have no way to switch `npLyrics` (the header toggles are `lg` only). If it is turned off on a desktop, that device's phone layout hides the inline lyrics card.

### Status

Uncommitted in both repos.
