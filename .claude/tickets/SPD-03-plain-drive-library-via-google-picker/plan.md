# SPD-03: Plain Drive library via Google Picker (sign in → approve → play)

## Context

Today Spodrive only plays music that the `spodrive` CLI encrypted and uploaded. It also needs a passphrase. The OAuth consent screen is in *Testing*, so only test users you add by hand can sign in, and Google shows an "unverified app" warning. You never used the encrypted CLI flow. You want anyone (friends or the public) to be able to:

1. open the PWA,
2. sign in with Google and approve,
3. pick MP3s/folders that are already in their own Drive with the Google Picker,
4. play them, with no backend, no CLI, no passphrase and no test-user list.

What makes this work without a server or a Google review:
- **Scope stays `drive.file`.** It is non-sensitive, so the app can go **In production** without sensitive-scope verification or a CASA audit. `drive.file` only covers files the app created or the user picked in the Picker, so the Picker is how music gets in.
- **Sign-in stays as it is.** The GIS token flow (`apps/web/src/lib/auth.ts`) already works with no backend: silent 1h refresh, the token mirrored to IndexedDB for the service worker.
- **Encryption is removed entirely**: vault, passphrase, SPD1 chunked crypto, encrypted covers, and the CLI.

Ticket folder: copy this plan to `.claude/tickets/SPD-03-drive-picker-plain/plan.md` on approval. Implement with the `implement` skill on branch `SPD-03_drive-picker-plain` cut from `master`.

## Step 0: Spike (do first, ~30 min, decides one branch of the design)

It is unclear from Google's docs and community answers whether picking a **folder** in the Picker gives `drive.file` access to the files **inside** it. Test it with a throwaway HTML page and the real client ID and API key:
- Pick a folder with nested MP3s, then call `files.list q="'<folderId>' in parents"` and `files.get?alt=media` on a child.
- **If children are readable:** folder picking is the main UX. Scan recursively, and **Rescan** later picks up new files.
- **If not:** the Picker opens with folders browsable but not selectable, and the user multi-selects files (shift/ctrl-select inside a folder). There is no folder rescan, so the user adds new files with "Add music" again.

Write the result into the ticket folder as `spike.md`. The rest of the plan supports both outcomes, and only the scanning in `sources.ts` differs.

## Data model (`packages/core/src/manifest.ts`)

The app creates a `Spodrive` folder in the user's Drive (`appProperties spodrive=root`, the same lookup as `drive.ts:findRoot`). It holds two **plain JSON** files, so the library syncs across devices. The user's MP3s stay where they are and are never modified.

- `library.json`:
  ```ts
  interface Source { id: string; kind: "folder" | "file"; name: string; addedAt: string }
  interface Track {
    id: string;            // = driveFileId
    driveFileId: string;
    sourceId: string;
    title; artist; album; albumArtist; trackNo?; discNo?; year?;
    durationSec: number;   // 0 if unknown → filled from <audio> loadedmetadata
    size: number;          // bytes (from Drive metadata)
    mime: string;
    md5: string;           // Drive md5Checksum, to detect changed files on rescan
    hasCover: boolean;
    addedAt: string;
  }
  interface Library { format: "spodrive-library"; version: 2; updatedAt; sources: Source[]; tracks: Track[] }
  ```
- `playlists.json`: the same `PlaylistsFile` shape and `mergePlaylists()` as now, stored as plain JSON.
- Fields removed from Track: `key`, `coverKey`, `coverFileId`, `coverMime`, `chunkSize`, `plainSize`, `sha256`. Rename the constants `LIBRARY_FILE`→`library.json` and `PLAYLISTS_FILE`→`playlists.json`, and remove `VAULT_FILE`, `TRACKS_FOLDER` and `COVERS_FOLDER`.

## Changes

### 1. Remove encryption and the CLI
- Delete `apps/cli/` and its workspace entry and npm scripts in the root `package.json`.
- In `packages/core/src`, delete `blob.ts`, `kdf.ts`, `stream-format.ts` and the crypto tests. Keep `manifest.ts`, `lrc.ts`, and `bytes.ts` only if something still uses it.
- Delete `apps/web/src/lib/keyring.ts` and the `headers` IndexedDB store usage.
- In `db.ts` KV, remove `kek`, `vault`, `libraryEnc` and `playlistsEnc`. Add `library` (plain JSON) and `playlists` (plain JSON). Bump the DB version and clear the old keys on upgrade.

### 2. Session and gate (`apps/web/src/lib/session.ts`, `pages/Gate.tsx`, `App.tsx`)
- Phases: `booting → signedOut → ready`. Remove `checking`, `needsUnlock` and `noRoot`, and remove `unlock()`/`lock()`.
- `boot()`: if a token or cached library exists, go to `ready` (this works offline from the cached library). Otherwise go to `signedOut`. `connect()`: `signIn()`, then `ready`.
- `afterReady()` keeps its current shape: load the cached library from KV, then `syncLibrary()` (download `library.json` if the root exists), then playlists, then `restorePlayer`. A missing root just means the library is empty.
- In `Gate.tsx`, remove `UnlockScreen` and `NoRootScreen` and update the ConnectScreen copy (no encryption wording).
- `signOutEverywhere()` stays the same, minus the kek and headers parts.

### 3. Google Picker + adding music (new `apps/web/src/lib/picker.ts`, `apps/web/src/lib/sources.ts`)
- `picker.ts`: load `https://apis.google.com/js/api.js`, then `gapi.load('picker')`, then build a `DocsView`:
  - Filters: `setMimeTypes("audio/mpeg,audio/mp4,audio/x-m4a,audio/flac,audio/aac,audio/ogg")`, `setIncludeFolders(true)`, and `setSelectFolderEnabled(<spike result>)`.
  - Builder options: `MULTISELECT_ENABLED`, `setOAuthToken(await getAccessToken())`, `setDeveloperKey(VITE_GOOGLE_API_KEY)` and `setAppId(VITE_GOOGLE_APP_ID)`.
  - It resolves with the picked docs.
  - Add Picker typings next to `apps/web/src/types/gis.d.ts`.
- `sources.ts` (scanner):
  1. Expand picked folders recursively with `files.list` (paged, `pageSize 1000`, audio mime filter, fields `id,name,mimeType,size,md5Checksum,parents`).
  2. Skip files already in the library with the same md5.
  3. Read tags with **`music-metadata`**, which is already in `node_modules` from the CLI, and add it to `apps/web/package.json`. Use its browser `core` entry, `parseBuffer`:
     - Fetch the head with the existing `downloadRange` (`apps/web/src/lib/drive.ts:70`). Start with the first 256 KiB. If the ID3v2 header says the tag is bigger (large cover), fetch up to that size, capped at 4 MiB.
     - Call `parseBuffer(head, { mimeType, size }, { duration: true })`. With `size`, it estimates MP3 duration from the Xing/VBRI or CBR header. Use `selectCover` for the picture.
     - Map the tags to the Track fields. Port `mapTags` from `apps/cli/src/scan.ts:52-71` without `node:path`. If the tags are empty, use the file name as the title and the parent folder name as the album.
  4. Run 4 files at a time and report progress in a zustand store.
  5. Store each cover in the IndexedDB `covers` store, keyed by track id, as a downscaled 512px JPEG made with an `OffscreenCanvas`/canvas.
  6. Merge the new tracks into the library and write `library.json`. Create the `Spodrive` root and the file on the first add, reusing `createFile`/`updateFile` from `drive.ts`.
- **Rescan** (folder sources only): re-list each folder and add new files. Drop tracks whose file is gone (404/trashed), and re-read tags when the md5 changes.
- **Remove source**: drops its tracks from the library. It never touches the user's files.

### 4. Playback (service worker and engine)
- `apps/web/src/stream/handler.ts`: replace the SPD1 logic with a plain proxy. Keep `parseRangeHeader`.
  - `handleStreamRequest(req, id, deps)`: look up the track. If it is downloaded, serve the Range from the local Blob (the existing `localBlob` slicing, with the size check `blob.size === track.size`). Otherwise forward the Range to Drive through the existing `driveRange`/token refresh in `stream/sources.ts`.
  - Return a 206/200 with `Content-Range` and `Content-Length` (computed from `track.size`), `Accept-Ranges: bytes` and `Content-Type: track.mime`.
- `apps/web/src/sw.ts`: `loadLibrary()` reads `KV.library` (plain JSON) instead of the KEK and `libraryEnc`. Remove `headerCache`.
- `apps/web/src/player/engine.ts`: `loadBlob()` turns the full Drive download (or offline blob) directly into a Blob URL, with no decrypt. Keep the stream/fallback/watchdog logic unchanged.
- If `durationSec` is 0, update it in memory from `audio.duration` on `loadedmetadata` and persist it when the library is next written.

### 5. Covers, offline, playlists, settings
- `covers.ts`: look up the IndexedDB `covers` store by track id. On a miss (e.g. a second device), re-extract lazily with the same head fetch and parse as the scanner, then cache it. Remove decryption.
- `offline.ts`: replace `encryptedSize(...)` with `track.size`. Also fix `SettingsPage.tsx:69`. Update the copy, since downloads are no longer encrypted.
- `playlists.ts`: plain JSON in `playlists.json` and `KV.playlists`. Remove `sealJson`/`openJson`/`requireKek`. Keep the merge and sync logic as it is.
- Settings: remove "Lock" and the passphrase copy. Add a **Library** section with "Add music from Drive", the sources list with Rescan/Remove, and scan progress.
- `pages/Home.tsx` `LibraryGate` empty state: replace the CLI instructions with an "Add music from Google Drive" button that opens the Picker.

### 6. Google Cloud + deploy (README + CI)
- Console steps for the README:
  1. Enable the **Google Picker API**.
  2. Create an **API key** restricted to HTTP referrers (`http://localhost:5173/*` and the deploy origin) and to the Picker API.
  3. App ID = the **project number**.
  4. On the OAuth consent screen, set the app name, support email, home page and privacy policy URL, and the authorized domain `tihomir-selak.from.hr`. Then **Publish app → In production**. The only scope is `drive.file` (non-sensitive). If the console asks for basic brand verification, it is a lightweight form, not a security review.
- Add `apps/web/public/privacy.html`, a short static privacy policy: the app reads only the files you pick, has no server, and sends lyrics lookups to lrclib.net.
- `.env.example`: add `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID`. `.github/workflows/ci.yml`: pass them as Actions variables.
- Rewrite the README: remove the CLI, crypto and Desktop-client sections, and describe the new flow and privacy notes. Google can now read the audio, because the files are plain MP3s in the user's own Drive.

## Tests (vitest, existing DI style, no mocks library)
- Rewrite `apps/web/test/handler.test.ts` for the plain proxy, with a fake `fetchRange` that records ranges. Cover full, open-ended and suffix ranges, local blob vs Drive, and 401 → token refresh (keep the `createTokenRequester` tests).
- New `apps/web/test/sources.test.ts` covers:
  - the tag mapping and file-name fallbacks (pure function),
  - md5 dedupe and merge,
  - remove-source pruning,
  - recursive folder expansion with an injected `listChildren`.
- New test for the head-size logic: read the ID3v2 synchsafe size from the header bytes and work out how many bytes to fetch.
- Update the `library.test.ts` `track()` factory to the new Track shape.
- Delete the core crypto tests and `apps/cli/test`.

## Verification
1. `npm run lint && npm test && npm run build` all pass.
2. `npm run dev`, then sign in with a **second Google account that is not a test user**. This only works after Publish → In production. Approve the `drive.file` consent and check there is no test-user error.
3. Add music:
   - Pick a Drive folder (or multi-select files, depending on the spike).
   - Progress shows, and tracks appear with correct title, artist and album, covers and durations.
   - `library.json` and `playlists.json` appear in `/Spodrive` in Drive.
4. Playback and seeking:
   - Play a track and seek mid-track. DevTools → Network shows `/stream/<id>` 206 responses and Drive `alt=media` with `Range`.
   - Unregister the SW to check that the Blob fallback plays.
5. Offline: download an album, go offline in DevTools, and check it plays and seeks.
6. Second device or browser profile: sign in with the same account. The library and playlists load from `library.json`, and covers re-extract lazily.
7. Rescan after adding an MP3 to the picked folder in Drive. Remove a source and check that the Drive files are untouched.
8. Deploy to Netlify and repeat step 2 on an Android phone with the installed PWA, including lock-screen controls.

## Implementation status

- **Branch:** `SPD-03_drive-picker-plain` (from `origin/master` @ 36c03fc). Authoritative plan: this file.
- **Deviation (Step 0):** the spike needs the Picker API key/App ID from the Cloud console and an interactive Google sign-in, so it cannot run during implementation. Implementation ships both paths: folder selection is enabled. When a folder is picked, its children are listed. If none are readable (the drive.file limitation), the user is told to open the folder and multi-select files instead. The spike is now part of manual verification step 3. Record the result in `spike.md`.

### Checklist
- [x] 1. Remove encryption + CLI. Deleted `apps/cli`, core `blob.ts`/`kdf.ts`/`stream-format.ts`/`bytes.ts` (nothing used bytes.ts any more), `lib/keyring.ts`; root `spodrive` script and `tsx` devDependency removed; `music-metadata@^12.1.0` added to `apps/web`; `npm install` updated `package-lock.json`. `db.ts` is now version 2: drops the `headers` store, the old KV keys (`kek`, `vault`, `libraryEnc`, `playlistsEnc`), the `covers` store contents and `driveIds` on upgrade; adds `KV.library`/`KV.playlists`. Core `manifest.ts` has the new Source/Track/Library shape.
- [x] 2. Session / gate. Phases are `booting | signedOut | ready`; Unlock/NoRoot/Checking screens, `unlock()`/`lock()`/`isUnlocked()` and the Settings Lock button are gone. `boot()` goes to `ready` when a token or a cached library exists.
- [x] 3. Picker + scanner. New `lib/picker.ts` (+ `types/picker.d.ts`, `gis.d.ts` gets `picker?`), `lib/tags.ts` (pure: mapTags, ID3v2 head size, mime), `lib/metadata.ts` (music-metadata `parseBuffer`/`selectCover` via the browser `core` entry, head fetch, cover downscale), `lib/sources.ts` (pure scanner with injected deps), `lib/library-actions.ts` (add/rescan/remove + zustand scan progress), `drive.ts` gains `createFolder`, `ensureRootId`, `listChildrenPage`, `getFileMeta`. `library.ts` now reads/writes plain `library.json` (`commitLibrary`, `setTrackDuration`). Missing `VITE_GOOGLE_API_KEY`/`VITE_GOOGLE_APP_ID` shows an error toast from the "Add music" button. Picked folders that give no readable audio produce a toast telling the user to open the folder and multi-select songs.
- [x] 4. Playback. `stream/handler.ts` is a plain Range proxy (`fetchRange` dep returns bytes or a stream); `stream/sources.ts` serves the local blob (size check `track.size`) or streams a 206 from Drive with 401 token refresh; `sw.ts` reads `KV.library`, `headerCache` removed; `engine.ts` blob fallback plays the downloaded file directly and persists unknown durations through `setTrackDuration` on `loadedmetadata`.
- [x] 5. Covers / offline / playlists / settings UI. `covers.ts` caches downscaled JPEG blobs by track id and lazily re-extracts on a miss; `offline.ts` uses `track.size` (`getEncryptedBlob` renamed `getAudioBlob`); `playlists.ts` uses plain `playlists.json`/`KV.playlists`; Settings has a Library section (add, rescan, per-source Rescan/Remove, progress) and no encryption wording; Home empty state has "Add music from Google Drive"; PWA/`index.html` descriptions no longer say "encrypted".
- [x] 6. README / privacy / env / CI. README rewritten (Picker flow, Cloud setup incl. Picker API, referrer-restricted API key, App ID, consent screen Publish → In production; CLI/crypto removed). New `apps/web/public/privacy.html`. `.env.example` + `ci.yml` gain `VITE_GOOGLE_API_KEY`/`VITE_GOOGLE_APP_ID` (deploy skipped with a warning until set). ci.yml reviewed by eye (no YAML parser available).
- [x] Tests updated; lint/test/build green. `handler.test.ts` rewritten (plain proxy + `createByteSource` local blob vs Drive, 401 refresh, Range ignored, 403; `createTokenRequester` kept); new `sources.test.ts` (mapTags/fallbacks, md5 dedupe + merge, remove-source pruning, recursive expansion with injected `listChildren`, add/rescan); new `tags.test.ts` (ID3v2 synchsafe size + head-size logic); `library.test.ts` factory updated; core test reduced to mergePlaylists + LRC; CLI tests deleted with the CLI.
  - Evidence (repo root): `npm run lint` pass (core + web `tsc --noEmit`), `npm test` pass (9 files, 85 tests), `npm run build` pass (vite build + SW build, no node-module externalization warnings; music-metadata parsers are split into lazy chunks). grep for openJson/sealJson/decryptFile/encryptedSize/requireKek/keyring/vault/libraryEnc/encrypt/passphrase in `apps/web/src` finds only the legacy-key cleanup in `db.ts`.

### Deviations (steps 1-5)
- `parseBuffer` is called with `duration: false`, not `true`: only the head of the file is parsed, so a full scan would measure the truncated buffer. Duration comes from Xing/CBR info when available, otherwise 0 and is filled from `loadedmetadata`.
- Tags are only read from the head (first 256 KiB, up to 4 MiB for large ID3v2 tags). M4A files with `moov` at the end fall back to file name/folder name metadata and no cover.
- `fetchRange` in the stream handler may return a stream (Drive 206 passes through) so playback starts before the whole range arrives; local blobs return bytes.
- `library.json` sync rule: remote replaces local unless local `updatedAt` is newer (then local is pushed), no per-track merge; remove-source therefore propagates.
- Playlists: the Spodrive folder is only created for playlists when something is dirty; the library creates it on the first add.
- Not verified at runtime (needs real Google keys/consent): Picker, folder-vs-multi-select spike, Drive listing, music-metadata on real files, SW playback. Only compile, unit tests and build were run.
- Review fixes: all loose files of one Picker call form ONE "file" source (`pick_<uuid>`, label like `Song.mp3 and 41 more`); folders stay one source each; a new source that ends up owning no tracks is not added. `ensureRootId` memoizes its in-flight promise (cleared on settle) so concurrent first writes create one folder. `mergeTracks` keeps `addedAt` and `sourceId` of an existing track when its md5 changed. Tests added in `sources.test.ts`. Re-run: lint pass, test pass (9 files, 87 tests), build pass.
