# Changelog: SPD-03

## 2026-10-11: SPD-03: plain Drive library via Google Picker (encryption and CLI removed)

The app now runs as "sign in → approve → pick songs/folders from Drive → play". There is no passphrase, no CLI and no backend. The scope stays `drive.file`.

### Repo `spodrive`, branch `SPD-03_drive-picker-plain` (from `origin/master` @ 36c03fc)

**Removed**
- `apps/cli/` (whole workspace). The root `package.json` loses the `spodrive` script and the `tsx` devDependency, and `package-lock.json` is regenerated.
- `packages/core/src/blob.ts`, `kdf.ts`, `stream-format.ts`, `bytes.ts`: all encryption code.
- `apps/web/src/lib/keyring.ts`: the KEK cache.

**Core**
- `packages/core/src/manifest.ts` has the new data shapes:
  - `Source` and the plain `Track` (`size`, `md5`, `hasCover`, `sourceId`).
  - `Library` v2 with `sources`.
  - File names `library.json` / `playlists.json`.
- `packages/core/src/index.ts`: exports trimmed to match. `packages/core/test/core.test.ts`: only the mergePlaylists and LRC tests remain.

**Web app: new files**
- `apps/web/src/lib/picker.ts`: Google Picker with audio mime filter, folders selectable and multiselect. Missing `VITE_GOOGLE_API_KEY`/`VITE_GOOGLE_APP_ID` shows a clear error. `apps/web/src/types/picker.d.ts` holds its typings.
- `apps/web/src/lib/tags.ts`: pure helpers: tag mapping with file/folder-name fallbacks, ID3v2 head-size logic, audio mime detection.
- `apps/web/src/lib/metadata.ts`:
  - ranged head fetch (256 KiB, up to 4 MiB for large tags),
  - `music-metadata` `parseBuffer`/`selectCover` from its browser entry,
  - covers downscaled to 512px JPEG.
- `apps/web/src/lib/sources.ts`: pure scanner with injected deps.
  - Expands folders recursively and diffs by md5.
  - All loose files from one pick become one source.
  - Rescan drops tracks whose files are gone. A track whose file changed keeps its `addedAt` and `sourceId`.
- `apps/web/src/lib/library-actions.ts`: `addMusic` / `rescan` / `removeSourceById` and the scan-progress store. A picked folder with no readable files shows a hint to multi-select its songs instead.

**Web app: changed files**
- `apps/web/src/lib/drive.ts`: adds `createFolder`, `ensureRootId` (memoized, so only one Spodrive folder is ever created), `listChildrenPage`, `getFileMeta`.
- `apps/web/src/lib/library.ts`: reads and writes plain `library.json`, with `commitLibrary` and `setTrackDuration`. Sync rule: remote wins unless the local copy has a newer `updatedAt`, in which case local is pushed.
- `apps/web/src/lib/playlists.ts`: `playlists.json` and its local cache are now plain JSON.
- `apps/web/src/lib/db.ts`: IndexedDB v2. On upgrade it drops the `headers` store, the legacy KV keys, cached covers and drive ids. Adds `KV.library` / `KV.playlists`.
- `apps/web/src/lib/session.ts`: phases are now `booting | signedOut | ready`, with no unlock or lock.
- `apps/web/src/lib/covers.ts`: covers are JPEG blobs in IndexedDB keyed by track id, re-extracted lazily on a miss.
- `apps/web/src/lib/offline.ts`: size checks use `track.size`; `getAudioBlob` replaces `getEncryptedBlob`.
- `apps/web/src/stream/handler.ts`, `apps/web/src/stream/sources.ts`, `apps/web/src/sw.ts`: the service worker is now a plain Range proxy. It serves an offline/prefetch blob, or passes a Drive 206 through as a stream, with token refresh on 401.
- `apps/web/src/player/engine.ts`: the Blob fallback plays the downloaded file directly. Unknown durations are filled from `loadedmetadata`.
- `apps/web/src/App.tsx`, `apps/web/src/pages/Gate.tsx`: the Unlock, NoRoot and Checking screens are removed.
- `apps/web/src/pages/Home.tsx`: the empty library shows an "Add music from Google Drive" button.
- `apps/web/src/pages/SettingsPage.tsx`: Lock is removed. A new Library section has add, rescan all, per-source Rescan/Remove, and progress.
- `apps/web/src/lib/library-index.ts`, `apps/web/src/lib/urls.ts`, `apps/web/src/player/store.ts`, `apps/web/src/types/gis.d.ts`, `apps/web/index.html`, `apps/web/vite.config.ts`: field and wording updates (no "encrypted").
- `apps/web/package.json`: adds `music-metadata@^12.1.0`.
- Tests:
  - `apps/web/test/handler.test.ts` is rewritten for the plain proxy.
  - `apps/web/test/sources.test.ts` and `apps/web/test/tags.test.ts` are new.
  - `apps/web/test/library.test.ts` uses the updated track factory.

**Docs / deploy**
- `README.md` is rewritten for the new flow and the Google Cloud setup: Picker API, referrer-restricted API key, App ID, and consent screen **Publish → In production**.
- `apps/web/public/privacy.html` (new): the privacy policy the consent screen needs.
- `apps/web/.env.example` and `.github/workflows/ci.yml`: add `VITE_GOOGLE_API_KEY` / `VITE_GOOGLE_APP_ID`. The deploy is skipped with a warning until they are set.

### Deviations from the plan
- **Step 0 spike not run.** It needs real Cloud keys and an interactive sign-in. Both paths are shipped instead: folders can be selected, and an unreadable folder gets a multi-select hint. The spike is now part of manual verification, with the result to be recorded in `spike.md`.
- `parseBuffer` uses `duration: false`, because only the head of the file is read. Duration comes from the Xing/CBR header, otherwise from `loadedmetadata`.
- Tags and covers come from the file head only. M4A files with `moov` at the end fall back to file-name metadata and no cover.
- Loose picked files are grouped into one source per Picker call instead of one source per file (review fix).
- `library.json` sync is whole-file last-writer-wins, not a per-track merge.

### Verification
Run:
- `npm run lint`: pass (core and web `tsc --noEmit`).
- `npm test`: pass (9 files, 87 tests).
- `npm run build`: pass (vite and SW build). `music-metadata` resolves to its browser `core` entry.
- grep for encryption symbols in `apps/web/src`: only the legacy-key cleanup in `db.ts` remains.

**Not run** (needs real Google keys, consent and devices): plan verification steps 2–8. That means the Picker, the folder-access spike, sign-in with a non-test account after publishing, tag reading on real files, SW streaming and seeking, offline, second-device sync, rescan/remove, and the Android PWA. The `ci.yml` YAML was reviewed by eye only.

### Follow-ups / known limitations
- Run the spike and record `spike.md`. If folder access doesn't work, consider turning off folder selection in `picker.ts` (`setSelectFolderEnabled(false)`).
- Google Cloud console: enable the Picker API, create the API key, publish the consent screen, and set the Actions variables `VITE_GOOGLE_API_KEY` / `VITE_GOOGLE_APP_ID`.
- If the user deletes the Spodrive folder, a stale cached root id could make the first write fail until the cached ids are cleared.

### Commit status
Uncommitted, on branch `SPD-03_drive-picker-plain`.
