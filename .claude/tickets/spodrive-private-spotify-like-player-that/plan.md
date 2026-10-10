# Spodrive: private Spotify-like player that streams encrypted MP3s from Google Drive

## Context

The LinkedIn post said: *"Claude built me a private Spotify-like interface that streams AES-encrypted MP3s from Google Drive... it even fetches lyrics from lrclib.net."* The screenshot shows a dark, mobile-first Now Playing screen: cover art, "In The End – Linkin Park", a scrubber, prev/play/next, and a synced-lyrics card underneath with the current line highlighted.

The repo `C:\projects\Personal\spodrive` is empty apart from `README.md`. Choices you made:
- **Static PWA, no server.** Google login, Drive fetch and AES decryption all happen in the browser. Neither Google nor the host ever sees plaintext.
- **A CLI script** encrypts a local MP3 folder, uploads it to Drive and keeps an encrypted library index up to date.
- **v1 scope:** playlists, offline cache, albums/artists browsing, lock-screen controls (Media Session).
- **UI language:** English.

On approval, copy this plan to `.claude/tickets/spodrive-private-spotify/plan.md`. Build it with the `implement` skill on a branch like `spodrive-mvp` cut from `master`.

## Architecture

```
local MP3s ──► CLI (Node) ──encrypt──► Google Drive /Spodrive
                                        ├─ vault.json      (KDF salt/params + key-check blob, plaintext)
                                        ├─ library.enc     (encrypted track index)
                                        ├─ playlists.enc   (encrypted, written by the web app)
                                        ├─ tracks/<uuid>.bin  (chunked AES-GCM audio, random names)
                                        └─ covers/<uuid>.bin  (encrypted cover art)

PWA (browser) ── Google OAuth (GIS token client) ──► Drive REST API (Range requests)
   └─ Service Worker /stream/<trackId>: Range → fetch encrypted chunks → decrypt → 206 → <audio>
```

### Monorepo (npm workspaces, TypeScript everywhere)
- `packages/core` holds the code both sides share: the crypto format, KDF, manifest/playlist types, and the plaintext→ciphertext range math. It uses only `globalThis.crypto.subtle`, so the same code runs in Node 20+ and in the browser. This guarantees the CLI and the web app agree on the format.
- `apps/cli` handles encrypt + upload.
- `apps/web` is Vite + React + TS, with `vite-plugin-pwa` in `injectManifest` mode for the custom service worker, Zustand for player state, `idb` for IndexedDB, and Tailwind for styling.

## Crypto design (`packages/core`)
- **Passphrase → KEK:** PBKDF2-SHA256 with 600k iterations and a random 16-byte salt kept in `vault.json`. Argon2 is not in WebCrypto, so PBKDF2 keeps the CLI and browser identical. `vault.json` also holds a small encrypted check blob so a wrong passphrase fails fast.
- **Per-file random 256-bit content keys** are stored in the encrypted manifest. Changing the passphrase later only re-encrypts `library.enc`, not the audio.
- **Chunked file format `SPD1`:**
  - Header: magic, version, chunk size (64 KiB plaintext), 8-byte random nonce prefix.
  - Body: chunks, each AES-256-GCM. The nonce is `prefix ‖ uint32 chunkIndex`. The AAD is `chunkIndex ‖ isLastChunk`, which stops reordering and truncation.
  - Each chunk is 64 KiB + 16-byte tag. Encrypted offsets can therefore be computed, so the player can seek with Drive `Range` requests.
- **Manifest:** `library.enc` is JSON encrypted with the KEK as a single GCM blob. Each track entry has:
  - `id`, `driveFileId`, `coverFileId`
  - `title`, `artist`, `album`, `albumArtist`, `trackNo`, `discNo`, `year`
  - `durationSec`, `plainSize`, `mime`, `key` (base64), `sha256` of the source (for dedupe)
- **Unlocking:** after the first unlock, the KEK is stored in IndexedDB as a **non-extractable** CryptoKey, so each device asks for the passphrase once. Settings has a "Lock" action that wipes it.
- Unit tests (vitest) cover: round-trip encrypt/decrypt, arbitrary range decrypts across chunk boundaries, tamper and truncation detection, and wrong passphrase.

## CLI (`apps/cli`), run as `npm run spodrive -- <cmd>`
- `init`: OAuth desktop flow (`@google-cloud/local-auth` + `googleapis`, scope `drive.file`), passphrase prompt, then creates the `/Spodrive` folder tree, `vault.json` and an empty `library.enc`.
- `add <folder>`:
  1. Recursively finds `.mp3`/`.m4a`/`.flac` files.
  2. Reads tags and the embedded cover with `music-metadata`.
  3. Skips files whose sha256 is already in the manifest.
  4. Encrypts the audio and cover and uploads them via resumable upload, with concurrency 3 and a progress bar.
  5. Merges the new tracks into the manifest and re-uploads `library.enc`. The manifest is saved after every N tracks so an interrupted run can resume.
- `list`, `remove <query>`, `passwd` (rewraps only the manifest), `verify` (downloads a random sample and checks it decrypts).
- The OAuth refresh token is stored in `~/.spodrive/token.json` and never committed.

## Web app (`apps/web`)
**Auth and data layer**
- `auth.ts`: Google Identity Services token client with scope `drive.file`. Access tokens are refreshed silently every ~55 minutes and posted to the service worker.
- `drive.ts`: finds the Spodrive folder, downloads files, ranged downloads, updates files.
- `vault.ts`: unlock flow and the KEK cache.
- `library.ts`: decrypts the manifest and builds album and artist indexes plus a search index.

**Streaming service worker (`sw.ts`)**
- Intercepts `/stream/<trackId>`.
- Parses the `Range` header and maps it to chunk indexes and an encrypted byte range.
- Reads the bytes from the offline cache if present, otherwise fetches them from Drive with `Range` + `Authorization`.
- Decrypts the chunks, slices them to the requested range and returns `206` with `Content-Range` and `Content-Length` based on `plainSize`.
- The main thread sends it the track key and token over `postMessage`.
- **Fallback:** if `<audio>` reports an error or stalls for over 8 s, the app downloads the full file, decrypts it and plays a Blob URL. This covers iOS Safari quirks with service-worker media.
- Workbox precaches the app shell, so the UI loads offline.

**Player (`player/store.ts`)**
- One `<audio>` element, a queue, shuffle, repeat (off/all/one), prev/next, seek, and persisted last-played state.
- Prefetches the next track's encrypted bytes at about 80% of the current track, so the next track starts even with the screen locked.
- Media Session API provides the title, artist and decrypted cover artwork, plus play/pause/next/prev/seekto handlers for the lock screen and Android notification.

**Lyrics (`lyrics.ts`)**
- Calls `GET https://lrclib.net/api/get?track_name&artist_name&album_name&duration`, falling back to `/api/search` and then to plain lyrics.
- An LRC parser turns the result into `[timeMs, line][]`.
- Results are cached in IndexedDB, including "not found".
- A Settings toggle turns lyrics off for full privacy, since requests reveal track names to lrclib.

**Offline**
- "Download" on a track, album or playlist stores the *encrypted* `.bin` in IndexedDB or Cache Storage. The service worker reads from there first.
- Settings shows storage used and has a "remove downloads" action.
- Offline mode requires the KEK to be cached and uses the last decrypted manifest, which is kept encrypted in IndexedDB.

**Playlists**
- Create, rename, delete, add/remove tracks and reorder by drag.
- Stored in `playlists.enc` on Drive with last-write-wins plus an `updatedAt` merge. They sync between devices on app start and on focus.

## Screens (dark, Spotify-like, mobile-first, desktop-responsive)
1. **Connect**: "Sign in with Google", then the **Unlock** passphrase screen.
2. **Home / Library** with tabs: Songs, Albums, Artists, Playlists. Has a search bar and a list of recently played tracks.
3. **Album / Artist / Playlist detail**: cover header, track list, play/shuffle and download buttons.
4. **Mini-player bar**, sitting above the bottom nav and always visible while playing.
5. **Now Playing** (matches the screenshot):
   - Full-screen layout over a background gradient taken from the dominant colour of the cover (canvas sampling).
   - Large cover, title/artist, scrubber with times, shuffle / prev / play-pause / next / repeat.
   - A **lyrics card** below with the current line highlighted and auto-scrolling. Tapping it expands to full-screen lyrics, where tapping a line seeks to it.
6. **Queue** (reorder, remove) and **Settings** (lyrics toggle, downloads/storage, lock, sign out).

## Repo setup and docs
- Root `package.json` defines the workspaces. Scripts: `dev`, `build`, `test`, `lint`, `spodrive`.
- `apps/web/.env.example` holds `VITE_GOOGLE_CLIENT_ID`. `.gitignore` covers tokens, `.env` and `dist`.
- `README.md` gets a step-by-step Google Cloud setup:
  1. Create a project and enable the Drive API.
  2. Configure the OAuth consent screen as External/Testing and add yourself as a test user.
  3. Create a **Web** client ID with JS origins `http://localhost:5173` plus the deploy URL.
  4. Create a **Desktop** client for the CLI. Both clients must be in the same project so `drive.file` lets the web app see files the CLI created.
- `.github/workflows/pages.yml` deploys to GitHub Pages and sets the Vite `base` path. Cloudflare Pages also works because the app is purely static.

## Risks / notes
- **`drive.file` visibility across the web and desktop clients of the same Cloud project.** I'll check this first with a tiny spike. If it fails, switch to the `drive` scope, which is fine for personal use in Testing mode.
- **iOS Safari plus service-worker range streaming** has historically been flaky. The Blob-URL fallback covers it.
- **Unverified-app warning:** Google shows it on login. That is expected for a personal app in Testing mode.

## Verification
1. `npm test`: core crypto and range math, LRC parser, and range-request handling in the service worker (simulated with a mocked fetch).
2. CLI end to end: `spodrive init`, then `spodrive add ./sample-music` with 2–3 MP3s. In the Drive UI, confirm only random-named `.bin` files plus `vault.json` and `library.enc` exist and no metadata is visible. Then run `spodrive verify`.
3. `npm run dev` and open it in Chrome, driven with the claude-in-chrome tools:
   - Sign in, unlock, and check the library lists the tracks with covers.
   - Play a track and seek to the middle; DevTools Network should show `206` from `/stream/...` and ranged Drive requests.
   - Check that the next track auto-plays, shuffle and repeat work, and synced lyrics highlight in time with "In The End".
   - Create a playlist, reload, and confirm it is still there (it comes back from `playlists.enc`).
   - Download an album, switch DevTools to offline, and confirm it plays.
4. Install as a PWA on an Android phone: lock-screen controls and cover art show, playback continues with the screen locked, and the next track starts automatically.
5. `npm run build` succeeds, and the Pages deploy loads on the deploy URL with OAuth working.

## Implementation tracking

- **Branch:** `spodrive-mvp` (from `origin/master`). Plan file: this file.
- **Phases:**
  - [x] Phase A: root workspace + `packages/core` (crypto, format, types, range math, LRC parser) + tests
  - [x] Phase B1: `apps/cli` (init/add/list/remove/passwd/verify)
  - [x] Phase B2: `apps/web` (auth, drive, vault, library, SW streaming, player, lyrics, offline, playlists, screens)
  - [x] Phase C: README, GitHub Pages workflow, final verification

### Phase A notes (done)
Verified: `npm test` 24 tests pass; `npx tsc -p packages/core --noEmit` clean. Import everything from `@spodrive/core` (source exports, no build).
Root scripts: `test` = `vitest run` (root, finds all workspaces), `lint` = `--workspaces --if-present` (each workspace should define a `lint` script, e.g. `tsc --noEmit`), `dev` = `@spodrive/web` dev, `spodrive` = `tsx apps/cli/src/index.ts`. Web workspace must be named `@spodrive/web`. Base tsconfig: `tsconfig.base.json` (lib includes DOM; noUncheckedIndexedAccess on).

Exported API (`KeyInput` = `CryptoKey | Uint8Array` raw key; stream functions import raw keys automatically):
- bytes: `utf8Encode(s)`, `utf8Decode(b)`, `toBase64(b)`, `fromBase64(s)`, `concat(...parts)`, `randomBytes(n)`, `u32be(n)`, `bytesEqual(a,b)`, `bs(b)` (BufferSource cast)
- blob (SPB1 = magic4 + iv12 + ct+tag): `sealBlob(key: CryptoKey, pt, aad?)`, `openBlob(key, data, aad?)`, `sealJson(key, value, aad?)`, `openJson<T>(key, data, aad?)`, `generateContentKey(): Uint8Array(32)`, `importContentKey(raw): Promise<CryptoKey>` (non-extractable), `importContentKeyB64(b64)`, `BlobFormatError`
- kdf: `DEFAULT_ITERATIONS=600000`, `deriveKek(passphrase, salt, iterations?, extractable=false)`, `createVault(passphrase, iterations?, extractable?) -> {vault: VaultFile, kek}`, `unlockVault(vault, passphrase, extractable?) -> kek` (throws `WrongPassphraseError`). Passphrase is NFKC-normalized. `vault.check` is base64 of an SPB1 blob. Library/playlists are encrypted with `sealJson(kek, ...)` (raw bytes uploaded as library.enc / playlists.enc).
- stream-format (SPD1, header 20 bytes): `HEADER_SIZE=20`, `TAG_SIZE=16`, `DEFAULT_CHUNK_SIZE=65536`, `chunkCount(plainSize, cs?)`, `encryptedSize(plainSize, cs?)`, `encryptFile(key, plaintext, cs?) -> Uint8Array`, `encryptStream(key, source: (Async)Iterable<Uint8Array>, cs?) -> AsyncGenerator<Uint8Array>` (yields header then chunks), `parseHeader(bytes>=20) -> {version, chunkSize, noncePrefix}`, `planRange(plainSize, start, endInclusive, cs?) -> {firstChunk,lastChunk,encStart,encEndInclusive,sliceStart,sliceEnd}` (sliceEnd EXCLUSIVE; encStart/encEnd inclusive byte offsets into the whole encrypted file), `decryptChunks(key, header, encBytes, firstChunk, totalChunks) -> Uint8Array` (encBytes must start at chunk boundary `firstChunk`), `decryptFile(key, data)`, `decryptRange(key, header, plainSize, start, endInclusive, fetchEnc(encStart, encEndInclusive)) -> Uint8Array` (already sliced). Player flow: fetch bytes 0-19 -> parseHeader (or use track.chunkSize + prefix from header fetch), then decryptRange.
- manifest: constants `ROOT_FOLDER, VAULT_FILE, LIBRARY_FILE, PLAYLISTS_FILE, TRACKS_FOLDER, COVERS_FOLDER`; types `Track, Library, Playlist, PlaylistsFile`; `emptyLibrary()`, `emptyPlaylists()`, `mergePlaylists(a, b)` (per-id LWW by updatedAt, ties keep `a`, tombstones kept).
- lrc: `parseLrc(text) -> {timeMs,text}[]` (sorted, offset applied: positive offset = earlier), `activeLineIndex(lines, timeMs)` (-1 before first line), type `LrcLine`.
Deviations: none material. Extra helpers added (encryptStream, importContentKeyB64, u32be, randomBytes). `Track.chunkSize` is in the manifest but the header also carries it. Vitest 2.x, TS 5.x.

### Status notes (orchestrator)
- B1 CLI: implemented; dry-run e2e + unit tests pass. Drive/OAuth paths typecheck but are **unrun** (no credentials in this environment).
- B2 Web: implemented; 56 web tests (stream handler ranges/416/502/abort/tamper, queue, library, lyrics, color). Seeded smoke test in headless Chrome played via SW `/stream` with 206 ranges, seek, auto-advance, blob fallback, playlists locally. **Unrun:** real Google sign-in/Drive, iOS Safari, Android lock screen.
- C: README rewritten (Google Cloud setup, CLI, web, deploy, privacy), `.github/workflows/pages.yml` added (tests + build with `VITE_BASE=/<repo>/`, `vars.VITE_GOOGLE_CLIENT_ID`).
- Review fix requested: auth-error toasts → reconnect banner only, toast dedupe, single-flight refresh, lyrics highlight check.
- Known limitations: `passwd` not atomic (Drive revisions allow recovery); cover dedupe only within one `add` run; CLI encrypts whole file in memory (fine for MP3/FLAC sizes); explicit resumable upload sessions not used.
- Open spike: `drive.file` visibility across Desktop + Web clients in the same Cloud project must be confirmed on first real run; fallback = `drive` scope.
