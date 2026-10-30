# SPD-07: Now Playing side panels, large text, full screen, own lyrics (+ VibeFlow LRC)

> Ticket folder: `spodrive/.claude/tickets/SPD-07-now-playing-panels-lyrics-fullscreen/`
> Branches: `SPD-07_now-playing-panels` in spodrive (from `origin/master`), `VWT-05_lrc-lyrics` in vibe-whisper-flow (from `origin/master`, plan in `vibe-whisper-flow/.claude/tickets/VWT-05-lrc-lyrics/plan.md`).

## Context

On the Echo Show 8 (Silk, about 1280×720 CSS px, so the `lg` desktop layout), Now Playing shows the player on the left and an always-on Lyrics card on the right. Most of the songs (Croatian kids' songs) have no lyrics on lrclib.net, so the card is usually empty. The song list text (15 px titles, 12 px artists) is too small to read from across the room, and Silk's address bar takes up screen space.

The user wants:
1. **Right side panels you can switch on and off**: Lyrics and the **full source playlist** (the whole playlist or album that is playing, not only "up next").
2. **Bigger, readable lists** on the Echo.
3. **A full screen toggle** that stays on (it's a setting, not a one-off).
4. **A way to make lyrics** for songs lrclib doesn't have: transcribe them locally with VibeFlow (whisper, Croatian model) into timed `.lrc` files, then import them into Spodrive. Lyrics are stored on Drive, so the Echo shows them too.

Choices the user made: VibeFlow + import for lyrics. The right panel shows the full source playlist. Large text turns on by itself on Silk/Echo and can be switched in Settings. The full screen toggle goes in the sidebar top and the Now Playing header.

## A. Settings and UI state

`apps/web/src/state/settings.ts`: add
- `npLyrics: boolean` (default `true`), `npPlaylist: boolean` (default `true`): which right panels are on.
- `largeText: "auto" | "on" | "off"` (default `"auto"`).
- `fullscreen: boolean` (default `false`).

`set()` currently persists only two named keys. Change it to persist every `Settings` key (pick the keys from `DEFAULTS`).

## B. Now Playing: switchable right panels (`ui/NowPlaying.tsx`)

**`lg` and up (desktop and Echo):**
- Header row: Collapse | "Playing from" | **Lyrics toggle (Mic2)**, **Playlist toggle (ListMusic)**, **Full screen toggle**, More (…). Toggles use `IconButton active` (accent color when on). The bottom row with the Mic2 and ListMusic buttons is hidden at `lg`. That frees a row of height on the Echo.
- Layout: the player column has a fixed width (`lg:w-[min(36vw,30rem)] shrink-0`). The enabled panels sit to its right as `flex-1` columns side by side, each full height (`lg:h-[calc(100dvh-…)]`) with the existing tinted card style. With both panels off, the player column is centered. The outer `max-w-6xl` becomes `max-w-[100rem]` so two panels fit.
- Lyrics panel: the existing `LyricsPanel mode="card"`. Clicking it still opens the full lyrics overlay.
- Playlist panel: new `ui/SourceList.tsx` (see C).

**Below `lg` (phones):** no change in behavior. The bottom Mic2 and ListMusic buttons open the full screen lyrics and queue overlays as now. The inline lyrics card below the controls is shown only when `npLyrics` is on.

## C. Full source playlist panel (`ui/SourceList.tsx`, `player/store.ts`)

- `player/store.ts`: add `context: string[]` to `PlayerState`. `playTracks(ids, index, opts)` stores `ids` (the original, unshuffled order) as `context`. Persist it with `queue`, `source` and `volume` in the `Persisted` record, and restore it in `restorePlayer`. `stop` clears it. When `context` is empty (older saved state), fall back to `queue.original ?? queue.items`.
- `SourceList`: header with the source name (`source || "Now playing"`) and the track count. Rows: cover, title, artist, duration. The current track is highlighted (accent color + `Equalizer`) and scrolled into view on track change, using `lib/scroll.ts` `centeredScrollTop` the same way `LyricsPanel` does, with a pause after the user scrolls.
- Tapping a row: if the id is in `queue.items`, call `playerActions.jump(thatIndex)`. Otherwise call `playTracks(context, i, { shuffle: queue.shuffle, source })`.
- Rows reuse `Cover`/`Equalizer` from `ui/bits.tsx`. Not `TrackRow` (no menu, larger touch target: `py-2.5`, `h-14 w-14` cover, `text-lg` title, `text-sm` artist).

## D. Large text mode (Echo readability)

- New hook `useLargeText()` in `state/settings.ts`: resolves `"auto"` to `isLimitedBrowser()` (`lib/device-auth.ts`). An effect in `App.tsx` sets `document.documentElement.dataset.size = "large"` or removes it.
- `index.css`:
  - `html[data-size="large"] { font-size: 125%; }`. Tailwind v4 text and spacing are in rem, so rows, padding and type all scale. Media-query breakpoints don't change (rem in media queries uses the browser default).
  - `@custom-variant large (&:where([data-size="large"], [data-size="large"] *));` for the few spots that need different values.
  - `.row-cv` `contain-intrinsic-size` becomes `auto 3.5rem`.
- Replace px arbitrary font sizes in shared list UI with rem so they scale: `TrackRow` (`text-[15px]` → `text-[0.9375rem]`, `text-[11px]` → `text-[0.6875rem]`), the `Shell` bottom nav, and the `NowPlaying` "Playing from" label. Grep `text-\[\d+px\]` across `src/ui` and `src/pages` and convert each.
- Height fit on the Echo (about 720 px tall): `large:lg:max-w-[min(100%,40dvh)]` on the Now Playing cover. Check that the player column fits without scrolling.
- `pages/SettingsPage.tsx`, Playback/Display section: a "Text size" choice: Automatic (large on Echo/TV), Normal, Large.

## E. Full screen toggle (`lib/fullscreen.ts`, `ui/FullscreenToggle.tsx`)

- `lib/fullscreen.ts`:
  - `fullscreenSupported()` (`document.fullscreenEnabled || webkitFullscreenEnabled`), `enterFullscreen()`, `exitFullscreen()`, with `webkit` fallbacks.
  - A small zustand store `useFullscreen` with `active`, updated on `fullscreenchange`/`webkitfullscreenchange`.
  - `installFullscreenKeeper()`, called once from `main.tsx`/`App.tsx`: while `settings.fullscreen` is on and the page isn't full screen, a capture-phase `pointerdown` listener re-enters full screen. Browsers need a user gesture, so after a reload or coming back from the Echo home screen the **next tap** restores full screen.
  - Exit handling: the toggle turns the setting off. If full screen ends some other way (Esc, back gesture), keep the setting on Silk (`isLimitedBrowser()`, where that's the point). On other browsers, turn it off so Esc on desktop isn't fought.
- `ui/FullscreenToggle.tsx`: an `IconButton` with `Maximize`/`Minimize` icons and `active` while on. Renders nothing when unsupported.
- Placement: the `Shell` sidebar header next to the "Spodrive" logo (visible at `lg`, so on the Echo), and the Now Playing header (all sizes).

## F. Your own lyrics: import `.lrc` files, stored on Drive

**Drive storage** (`lib/drive.ts`): app-created files under `/Spodrive/lyrics/`, so `drive.file` can see them, and the Echo's TV client can too (same project, already proven by SPD-06).
- Generalize `ensureUploadsFolderId` into a shared `ensureSubfolderId(name, key)` and add `ensureLyricsFolderId()`. Add `lyricsId` to `DriveIds`.
- Add `deleteFile(fileId)`.
- File name: `<trackId>.lrc`. Create with `createFile`, overwrite with `updateFile`.

**User lyrics index** (`lib/user-lyrics.ts`, new):
- `loadUserLyricsIndex()`: lists the lyrics folder once per session (`listChildrenPage`, fields id/name/modifiedTime) into `Map<trackId, {fileId, modifiedTime}>`. Refresh it with the same triggers as playlists (`installPlaylistSyncTriggers` pattern: visibility/online). Don't create the folder on read.
- `saveUserLyrics(trackId, lrcText)`, `removeUserLyrics(trackId)`: write or delete on Drive, update the index, write the IDB cache, and bump a `useLyricsVersion` counter.

**Lookup order** (`lib/lyrics-fetch.ts`, `lib/lyrics.ts`):
- `fetchLyricsFor` gets an optional dep `user?: (trackId) => Promise<string | null>`, checked **first**. A user LRC always wins over lrclib, including over a cached lrclib "missing" entry.
- The IDB cache entry gets `source?: "lrclib" | "user"` and `modifiedTime?`. User lyrics are re-downloaded only when Drive's `modifiedTime` changes.
- `loadLyrics` memo is dropped for a track when its user lyrics change. `useLyrics` depends on `useLyricsVersion` so the panel updates right away.

**Import UI:**
- **Settings → Lyrics → "Import lyrics files (.lrc)"**: a hidden `<input type="file" accept=".lrc,.txt" multiple>`. No Picker needed, so it works on any device that has files.
- Matching (pure `matchLrcFiles(files, tracks)` in `lib/lyrics-import.ts`). Normalize strings: lowercase, NFKD, strip diacritics, keep letters and digits. Then, in order:
  1. `[ti:]` + `[ar:]` tags equal the track's title + artist.
  2. `[ti:]` matches exactly one track.
  3. The file name stem equals the title, `artist - title`, or `title - artist`.
  4. The stem contains exactly one track title.
  Ambiguous or unmatched files are reported, not guessed.
- Result: one summary toast ("12 lyrics imported, 2 not matched: a.lrc, b.lrc").
- **Track menu** (`ui/TrackMenu.tsx`): "Add lyrics file…" (one file, saved to that track, no matching) and "Remove my lyrics" (only when the track has user lyrics).
- Validate before saving: `parseLrc` must give at least one timed line, or the file has plain text (stored as is and shown as unsynced lyrics). Cap the size at 200 KB.
- `public/privacy.html` and `README.md`: lyrics files are stored in `/Spodrive/lyrics` on your Drive.

## G. VibeFlow: songs → timed LRC (repo `vibe-whisper-flow`, ticket `VWT-05`)

The File tab already decodes audio with PyAV and gets timed segments (`filetranscribe.transcribe_file` → `transcribe_segments` for whisper.cpp and Parakeet). It renders txt/SRT/VTT. Add:
- `vibeflow/filetranscribe.py`: an `"lrc"` format (`FORMATS`, `FORMAT_LABELS["lrc"] = "Lyrics (LRC)"`, `FORMAT_EXT[".lrc"]`).
  - `render(segments, "lrc", meta=None)` writes `[ti:]`, `[ar:]`, `[al:]`, `[length:mm:ss]` and `[re:VibeFlow]` headers, then a `[mm:ss.xx] text` line per segment.
  - It inserts an empty timed line (`[mm:ss.xx]`) at a segment's end when the gap to the next one is over 4 s, so Spodrive shows ♪ during instrumental parts.
  - `read_tags(src)` reads title/artist/album from `container.metadata` with PyAV. The tags are what Spodrive matches on first, since Drive tracks have the same tags.
- File tab (`settings_ui.py` `_build_file`): allow **several files** (`askopenfilenames`). With more than one file, or with the new "Save next to each source file" checkbox (on by default for LRC), each result is written as `<source stem>.lrc` beside its source, one after another, with "File k of n" progress. Cancel stops the batch. Single-file preview, copy and save stay as they are.
- Recommended model hint in the tab when LRC is chosen: `large-v3-turbo-hr` for Croatian songs, Parakeet v3 for mixed languages. Music under the vocals lowers accuracy. The LRC is a draft you can fix in any text editor before importing.
- Tests: `tests/test_filetranscribe.py` (or the existing file) gets LRC render cases (timestamps, gap markers, tag headers, centisecond rounding), a `read_tags` test with a missing-tags fallback, and a batch output-path test.
- README: a "Song lyrics for Spodrive" section covering transcribe → import in Spodrive.

## Files

- **spodrive, new:** `apps/web/src/ui/SourceList.tsx`, `apps/web/src/ui/FullscreenToggle.tsx`, `apps/web/src/lib/fullscreen.ts`, `apps/web/src/lib/user-lyrics.ts`, `apps/web/src/lib/lyrics-import.ts`, `apps/web/test/lyrics-import.test.ts`
- **spodrive, changed:** `ui/NowPlaying.tsx`, `ui/LyricsPanel.tsx` (version dep only if needed), `ui/TrackRow.tsx`, `ui/Shell.tsx`, `ui/TrackMenu.tsx`, `pages/SettingsPage.tsx`, `state/settings.ts`, `player/store.ts`, `lib/lyrics.ts`, `lib/lyrics-fetch.ts`, `lib/drive.ts`, `lib/db.ts` (DriveIds), `App.tsx`/`main.tsx`, `index.css`, `test/lyrics.test.ts`, `README.md`, `public/privacy.html`
- **vibe-whisper-flow, changed:** `vibeflow/filetranscribe.py`, `vibeflow/settings_ui.py`, tests, `README.md`

## Verification

1. spodrive: `npm run lint`, `npm test`, `npm run build` pass. New tests:
   - `matchLrcFiles`: tags, file stems, diacritics, ambiguous and unmatched files.
   - `fetchLyricsFor`: user lyrics win over lrclib and over a cached "missing" entry, and are re-fetched when `modifiedTime` changes.
   - `context` persists in the player store.
2. Desktop at 1280×720 (Chrome devtools), `npm run dev`:
   - Toggle Lyrics/Playlist in the Now Playing header: one, both or neither panel shows, and the choice survives a reload.
   - Playlist panel shows the full source in order (also with shuffle on), highlights and scrolls to the current song, and tapping a song plays it.
   - Phone width: overlays unchanged.
3. Large text: add `?device=1`, or set Settings → Text size → Large. Rows and panels scale up, and Now Playing fits in 720 px without scrolling.
4. Full screen: the toggle enters and leaves full screen. With it on, reload, tap once, and it's back. On desktop, Esc turns the setting off.
5. Lyrics: transcribe 2–3 songs in VibeFlow (File tab, LRC, `large-v3-turbo-hr`) → import in Spodrive → synced lyrics show and highlight. Check that `/Spodrive/lyrics/<id>.lrc` exists in Drive. "Remove my lyrics" falls back to lrclib.
6. VibeFlow: `pytest`. Run a batch of 3 files and check that the `.lrc` files are written next to their sources.
7. Echo Show (after deploy): large text is on by itself, the full screen toggle hides the Silk address bar and comes back after one tap when you return to the page, the playlist panel is readable, and imported lyrics show up.

## Implementation status

- [x] A. Settings keys + persist all (also `useLargeText()` here)
- [x] B. Now Playing switchable right panels
- [x] C. Source playlist panel + `context` in player store (cleared in `reset()` and when the queue empties; no store test: store needs IDB/document, tests run in node)
- [x] D. Large text mode (px to rem also in Home.tsx and Sheet.tsx)
- [x] E. Full screen toggle (orchestrator fix: the keeper ignores taps on the toggle itself, so turning it off after a reload doesn't flash full screen)
- [x] F. Own lyrics (Drive storage, lookup order, import, track menu). Deviations: `user` dep is `{ modifiedTime(id), download(id) }` (needs the index time up front; `undefined` = index not loaded); `ensureSubfolderId(key)` takes a key only; the `loadLyrics` memo is cleared fully on a version bump; files that aren't UTF-8 fall back to windows-1250
- [x] G. VibeFlow LRC (tracked in the VWT-05 plan; pytest 243 passed)
- [x] Verification 1: `npm run lint` clean, `npm test` 132 passed (12 files), `npm run build -w @spodrive/web` OK
- [ ] Verification 2–7 (manual / device): not run; needs a signed-in browser, real Drive and the Echo
