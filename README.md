# Spodrive

A private, Spotify-like music player for your own MP3s. Tracks are stored **AES-256-GCM encrypted** on your Google Drive and are decrypted and streamed in the browser, with seeking, offline downloads, playlists, lock-screen controls and synced lyrics from [lrclib.net](https://lrclib.net).

There is no server. The web app is a static PWA, and Google only ever stores ciphertext with random file names.

```
local MP3s ──► spodrive CLI ──encrypt──► Google Drive /Spodrive (random-named .bin files)
                                                  │
PWA (browser) ◄── service worker: Range → fetch encrypted chunks → decrypt → <audio>
```

## How it works

- **Passphrase → key:** your passphrase is turned into a key-encryption key (KEK) with PBKDF2-SHA256 at 600k iterations. The salt and a check blob live in `vault.json`.
- **Per-track keys:** each track has its own random 256-bit key. All track keys, plus the tags (title, artist, album, duration, ...), live in `library.enc`, which is encrypted with the KEK.
- **Audio format (`SPD1`):** audio is encrypted in 64 KiB AES-GCM chunks. Each chunk's position and "is last chunk" flag are authenticated, so chunks can't be reordered or the file truncated without detection.
- **Streaming:** because the chunks are fixed-size, the browser's service worker can translate a `Range` request on the audio into a ranged Drive download and decrypt only what's needed. That gives instant seeking without downloading the whole file.
- **On-device key:** after the first unlock, the KEK is kept in IndexedDB as a **non-extractable** `CryptoKey`. **Settings → Lock** removes it.
- **Offline:** offline downloads and covers are stored still encrypted on the device.

Repository layout:

| Path | What |
| --- | --- |
| `packages/core` | Shared crypto/format code (WebCrypto only, runs in Node and the browser), manifest types, LRC parser |
| `apps/cli` | `spodrive` CLI: encrypts your music and uploads it to Drive |
| `apps/web` | The PWA (Vite + React + TypeScript, streaming service worker) |

## 1. Google Cloud setup (once)

1. Create a project at <https://console.cloud.google.com/> and **enable the Google Drive API**.
2. **OAuth consent screen:** User type *External*, publishing status *Testing*. Add your own Google account under **Test users**.
3. **Credentials → Create OAuth client ID → Desktop app** (for the CLI). Download the JSON and save it as `~/.spodrive/credentials.json`. You can also pass `--credentials <path>` or set `SPODRIVE_CREDENTIALS`.
4. **Credentials → Create OAuth client ID → Web application** (for the PWA). Under **Authorized JavaScript origins** add:
   - `http://localhost:5173`
   - your deploy origin, e.g. `https://<user>.github.io` (scheme and host only, no path)

> Both clients **must be in the same Cloud project**. The app uses the narrow `drive.file` scope, which only lets it see files created by this project. That means it can only touch the `Spodrive` folder and nothing else in your Drive.
>
> Because the app is in Testing mode, Google shows an "unverified app" warning at sign-in. That is expected for a personal app.

## 2. Install

Requires Node 20+.

```sh
npm install
```

## 3. Encrypt and upload your music (CLI)

```sh
npm run spodrive -- init                 # sign in (opens a browser), choose a passphrase, create /Spodrive on Drive
npm run spodrive -- add ~/Music          # scan, encrypt and upload (.mp3/.m4a/.flac); safe to re-run, duplicates are skipped
npm run spodrive -- list                 # show the library
npm run spodrive -- verify --sample 5    # download 5 random tracks and check they decrypt to the original bytes
```

Other commands:
- `status`: root folder, track count, total size.
- `remove <query>`: deletes matching tracks from Drive and the library.
- `passwd`: changes the passphrase. Only `library.enc`/`playlists.enc` are re-encrypted; the audio is not re-uploaded.
- `add <folder> --dry-run <outDir>`: writes the encrypted layout locally without contacting Google.

Environment variables for scripting:

| Variable | Purpose |
| --- | --- |
| `SPODRIVE_PASSPHRASE` | passphrase, skips the prompt |
| `SPODRIVE_NEW_PASSPHRASE` | new passphrase for `passwd` |
| `SPODRIVE_YES=1` | auto-confirm prompts |
| `SPODRIVE_CREDENTIALS` | path to the Desktop OAuth client JSON |
| `SPODRIVE_HOME` | config dir (default `~/.spodrive`, which holds `token.json` and `config.json`) |

The refresh token in `~/.spodrive/token.json` gives access to your Spodrive files. Keep it private.

## 4. Run the web app

```sh
cp apps/web/.env.example apps/web/.env   # set VITE_GOOGLE_CLIENT_ID to the *Web application* client ID
npm run dev                              # http://localhost:5173
```

Sign in with Google, enter your passphrase, and play. On a phone, open the deployed URL and use **Add to Home screen** to install it as an app. That also gives you lock-screen and notification controls.

The streaming service worker takes control after the first load. Until then (the very first visit), and on browsers where service-worker streaming fails, the app falls back to downloading and decrypting the whole track.

## 5. Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests, builds the web app and publishes `apps/web/dist` on every push to `master`.

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables:** add `VITE_GOOGLE_CLIENT_ID`.
3. Add `https://<user>.github.io` to the Web client's authorized JavaScript origins.

The workflow builds with `VITE_BASE=/<repo>/`. Routing uses hash URLs, so no 404 rewrites are needed. The app is fully static, so Cloudflare Pages or Netlify work too. Set `VITE_BASE=/` there.

## Development

```sh
npm test                                  # vitest: core crypto/format, CLI dry-run e2e, stream handler, queue, lyrics, ...
npm run lint                              # type-check all workspaces
npm run build                             # production build (apps/web/dist)
npm run generate-pwa-assets -w @spodrive/web   # regenerate icons from apps/web/public/logo.svg
```

## Privacy notes

- **What Google sees:** random file names, file sizes, and when files are read.
- **Lyrics:** fetching lyrics sends the track title, artist, album and duration to lrclib.net. You can turn this off in **Settings**. Fetched lyrics are cached unencrypted in the browser.
- **Forgotten passphrase:** if you forget it, the library can't be recovered. There is no reset.
