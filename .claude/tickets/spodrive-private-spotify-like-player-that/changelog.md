# Changelog

## 2026-10-10 — spodrive-private-spotify-like-player-that

Spodrive MVP built: a static PWA plus a CLI. Music is stored AES-256-GCM encrypted on Google Drive and decrypted and streamed in the browser, with synced lrclib lyrics, playlists, offline downloads and Media Session controls.

### Repository: spodrive (branch `spodrive-mvp`, from `origin/master`)

**Root**
- `package.json`: npm workspaces (`packages/*`, `apps/*`). Scripts are `dev`, `build`, `test` (vitest), `lint` (per-workspace tsc) and `spodrive` (tsx CLI).
- `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `.gitignore` (tokens, credentials, `.env`, `dist`, `.claude/temp`), `.editorconfig`, `package-lock.json`.
- `README.md`: rewritten. Covers the architecture and security model, Google Cloud setup (Desktop and Web clients in the same project, `drive.file`), CLI usage, environment variables, dev, deploy and privacy notes.
- `.github/workflows/pages.yml`: on push to `master`, runs `npm ci`, `npm test`, then builds the web app with `VITE_BASE=/<repo>/` and `vars.VITE_GOOGLE_CLIENT_ID`, then deploys to GitHub Pages.

**`packages/core`** (`@spodrive/core`, source-exported, WebCrypto only)
- `kdf.ts`: PBKDF2-SHA256 (600k iterations) KEK, `createVault`/`unlockVault`, and a check blob that raises `WrongPassphraseError` on a wrong passphrase.
- `blob.ts`: SPB1 single-shot AES-GCM blob, JSON seal/open, content key generation and import.
- `stream-format.ts`: SPD1 chunked format.
  - 20-byte header, 64 KiB AES-GCM chunks.
  - Each chunk's IV is the nonce prefix ‖ its index, and its AAD is the index ‖ the isLast flag.
  - Functions: `encryptFile`, `encryptStream`, `planRange`, `decryptChunks`, `decryptRange`, `decryptFile`.
- `manifest.ts`: types for Track, Library, Playlist and PlaylistsFile; Drive layout constants; `mergePlaylists` (last-write-wins with tombstones).
- `lrc.ts`: LRC parser and `activeLineIndex`.
- `bytes.ts`: base64, UTF-8 and concat helpers.
- `test/core.test.ts`: 24 tests.
  - Round-trips at chunk boundaries and random ranges.
  - Tamper, truncation and reorder detection.
  - Vault, blobs, playlist merge, LRC.

**`apps/cli`** (`@spodrive/cli`, run with `npm run spodrive -- <cmd>`)
- `index.ts` defines the commands `init`, `add [--concurrency] [--dry-run <dir>]`, `list`, `remove`, `passwd`, `verify [--sample]` and `status`, plus a global `--credentials` option.
- `auth.ts`: OAuth through `@google-cloud/local-auth`; the refresh token is stored in `~/.spodrive/token.json` (0600).
- `drive.ts`: `DriveStore`. Finds the root folder by its `appProperties.spodrive=root` marker, caches folder and file ids in `~/.spodrive/config.json`, and uploads, downloads and deletes files.
- `store.ts`: the `Store` interface and `LocalStore`, which backs `--dry-run`.
- `vault.ts`, `prompt.ts`, `paths.ts`: session, vault and prompt helpers. Environment variables `SPODRIVE_PASSPHRASE`, `SPODRIVE_NEW_PASSPHRASE`, `SPODRIVE_YES`, `SPODRIVE_KDF_ITERATIONS`, `SPODRIVE_CREDENTIALS` and `SPODRIVE_HOME` are supported.
- `scan.ts`: finds .mp3, .m4a and .flac files and maps their `music-metadata` tags, falling back to placeholder values when tags are missing.
- `commands/*`: the command implementations.
  - Dedupe by sha256.
  - The manifest is saved every 10 tracks.
  - Covers are deduped by hash within a run.
  - `remove` also removes the track ids from playlists.
- `test/cli.test.ts`: scan and fallback mapping, and a dry-run end-to-end test with an ffmpeg-generated tagged MP3 (decrypt, compare sha256, check dedupe on re-add).

**`apps/web`** (`@spodrive/web`, Vite + React 18 + TS + Tailwind + vite-plugin-pwa injectManifest)
- **Streaming**
  - `src/sw.ts` and `src/stream/{handler,sources}.ts`: the service worker serves `scope/stream/<trackId>` without help from the page. It reads the KEK, the cached `library.enc` and the token from IndexedDB.
  - Supports Range forms `a-b`, `a-` and suffix ranges, plus 200, 416 and 502 responses.
  - Decryption is progressive, from batched ranged fetches. Bytes come from the offline cache, then the prefetch cache, then Drive. Cancelling aborts pending fetches, and on a 401 the SW asks the page for a new token.
- **Data layer** (`src/lib/`)
  - Google Identity Services token client with silent refresh and a reconnect banner (`auth`).
  - Drive REST client (`drive`), IndexedDB layer (`db`), unlock/lock/sign-out (`session`, `keyring`).
  - Library fetch and cache with single-flight refresh, plus album/artist/search indexes (`library`, `library-index`).
  - Covers cached encrypted and decrypted in memory (`covers`), dominant colour (`color`).
  - Downloads and prefetch (`offline`).
  - Playlists with merge, debounced sync, and sync on focus and when back online (`playlists`).
  - lrclib lookup by get then search, a best match by duration, and a cache that retries "not found" after 7 days (`lyrics*`).
  - Auth-error classification (`errors`), lyrics scroll helper (`scroll`).
- **Player** (`src/player/`)
  - Pure queue logic (`queue.ts`) with shuffle, repeat and prev-restart.
  - `engine.ts` owns the `<audio>` element, prefetches the next track at 80%, and falls back to Blob playback after an error or an 8 s stall.
  - `mediasession.ts` sets lock-screen metadata and handlers.
  - `store.ts` is the Zustand store, with the queue and position persisted.
- **UI** (`src/ui/`, `src/pages/`)
  - Gate flow: Connect, NoRoot, Unlock.
  - Home with Songs/Albums/Artists/Playlists tabs and Recently played; Search; album, artist and playlist detail pages; Settings.
  - Mini-player and desktop player bar, with a sidebar on desktop.
  - Now Playing matches the reference: cover-colour gradient, transport controls, and a lyrics card with the active line highlighted, auto-scroll and tap-to-seek in full screen.
  - Queue with drag reorder, toasts with dedupe, keyboard shortcuts.
- **App shell and assets**
  - Toasts with dedupe (`src/state/toasts.ts`).
  - PWA icons generated from `public/logo.svg`; `.env.example` with `VITE_GOOGLE_CLIENT_ID` and `VITE_BASE`.
- **Tests:** `test/{handler,queue,library,lyrics,color,misc}.test.ts`.

### Deviations from the plan
- **Whole-file CLI encryption:** the CLI encrypts each file whole in memory (`encryptFile`) because it computes the sha256 first, and it uses googleapis' default media upload instead of explicit resumable sessions.
- **Cover dedupe:** covers are only deduped within a single `add` run; the manifest has no cover-hash field.
- **`passwd` is not atomic:** it writes `library.enc` and `playlists.enc`, then `vault.json`. Drive file revisions allow recovery if it is interrupted.
- **The service worker builds as `iife`,** which vite-plugin-pwa's manifest injection requires.
- **New SW versions:** the PWA uses `registerType: 'prompt'`, so a new version shows a "Reload" toast instead of reloading mid-song.
- **Unlock screen:** the "Remember on this device" toggle was dropped. The KEK is always kept non-extractable until Lock.
- **Navigation:** the bottom nav is Home / Search / Settings, with the Library tabs inside Home.
- **Review fix after the first pass:**
  - Drive auth errors now go only to the reconnect banner, with no toast; the cached library stays on screen, and sync re-runs after reconnecting.
  - Toasts are deduped and library refresh is single-flight.
  - Fixed a bug where the lyrics card did not auto-scroll when Now Playing opened.

### Verification
**Passing:**
- `npm test`: 8 files, 90 tests, all passing (core 24, CLI 6, web 60).
- `npm run lint`: tsc is clean in every workspace.
- `npm run build`: the web build succeeds, producing `sw.js` and a manifest with 20 entries precached.
- CLI dry run: `SPODRIVE_PASSPHRASE=test SPODRIVE_KDF_ITERATIONS=1000 npm run spodrive -- add .claude/temp/cli-sample --dry-run .claude/temp/cli-out` produced the expected encrypted layout.
- Headless Chrome smoke script with an IndexedDB and offline cache seeded with WAVs encrypted by core:
  - It booted to Ready and streamed via the SW with 206 ranges.
  - Seek, next, auto-advance and the forced Blob fallback worked.
  - Synced lyrics were highlighted, and the cover gradient rendered.
  - Playlist CRUD worked locally.
  - Screenshots are in `.claude/temp/*.png`.

**Not run (needs real credentials or devices):**
- Real Google OAuth in the CLI and the web app.
- Drive upload and download, and playlist sync against Drive.
- The `drive.file` cross-client visibility spike.
- iOS Safari, Android lock screen and installed-PWA behaviour.
- The GitHub Pages deploy.

### Follow-ups / known limitations
- Confirm on the first real run that `drive.file` lets the Web client see files the Desktop client created. If it doesn't, switch both to the `drive` scope.
- Optional: add `coverSha256` to Track for cover dedupe across runs; make `passwd` write a backup first.
- `npm audit` reports advisories in transitive dev dependencies. These were not addressed.

### Commit status
Uncommitted on branch `spodrive-mvp`.
