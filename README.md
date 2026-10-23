# Spodrive

A Spotify-like music player for the audio files already in your Google Drive. Sign in with Google, pick files or folders with the Google Picker (or upload them from your device), and play them with seeking, offline downloads, playlists, lock-screen controls and synced lyrics from [lrclib.net](https://lrclib.net).

There is no server. The web app is a static PWA that talks to Google directly from your browser.

```
Google sign-in (drive.file) ──► "Add music from Google Drive" ──► Google Picker
                                                                     │
PWA (browser): tags/covers read via ranged Drive downloads ◄─────────┘
   library.json + playlists.json  ──►  Drive /Spodrive (created by the app)
   service worker: Range proxy to Drive ──► <audio>
```

## How it works

- **Sign-in:** Google Identity Services token flow with the narrow `drive.file` scope. No backend, no client secret.
- **Adding music:** press **Add music from Google Drive** to open the Picker and choose audio files or folders. Spodrive can only access what you pick, plus the files it creates itself. Your original files are never modified or moved. The Picker also has an **Upload** tab: files uploaded there go to `Spodrive/Music` in your Drive and are added to the library straight away.
- **Tags and covers:** read in the browser (music-metadata) from ranged Drive downloads, so no full download is needed.
- **Library storage:** the library index and playlists are plain JSON (`library.json`, `playlists.json`) in a `Spodrive` folder the app creates in your Drive, so they sync across devices.
- **Sources:** folder sources can be rescanned to pick up new tracks. Removing a source only removes it from the library, never from your Drive.
- **Read whole folders (optional):** with `drive.file`, Google only gives Spodrive the files you select, not the songs inside a picked folder. Settings > Library > *Read whole folders* also asks for `drive.readonly`. With it, adding one folder brings in everything below it (12 levels deep), and Rescan finds songs added later. `drive.readonly` is a restricted scope. Without Google's verification, users see an "unverified app" warning and the app is capped at 100 users. It isn't needed to use the app.
- **Folders:** the Home *Folders* tab groups songs by the Drive folder they sit in. A folder page can play, shuffle, download or add the whole folder to a playlist.
- **Streaming:** the service worker acts as a `Range` proxy to Drive, so seeking works without downloading the whole file.
- **Offline:** offline downloads are stored on the device (not encrypted).
- **Lyrics and controls:** synced lyrics come from lrclib.net (can be turned off in Settings). You can also import your own `.lrc` files (**Settings → Import lyrics files**, or **Add lyrics file…** in a track's menu). They are matched to tracks by their `[ti:]`/`[ar:]` tags or file name, stored in `Spodrive/lyrics` in your Drive (so every device, including an Echo Show, shows them) and take priority over lrclib.net. Lock-screen and notification controls use the Media Session API.
- **Add folders:** with `drive.file`, picking a folder gives Spodrive the folder but not the songs inside it. **Add folders** works around that in two steps: choose one or more folders, then, one folder at a time, a second Picker opens inside that folder and you select its songs (Shift+click selects a range). Each folder becomes its own folder source with its real name. To add songs that were put in the folder later, use **Add songs** on that folder in Settings > Library. With *Read whole folders* turned on, the second step is skipped and the whole folder is added.

Repository layout:

| Path | What |
| --- | --- |
| `packages/core` | Shared manifest types and LRC parser |
| `apps/web` | The PWA (Vite + React + TypeScript, streaming service worker) |

## Echo Show / TV

Some browsers, such as Silk on an Echo Show, can't use the Google sign-in popup. There, Spodrive offers **Sign in with a code** (Google's OAuth device flow). It is the main button in Silk, and a small link under the Google button elsewhere. You can also open the app with `?device=1` to prefer it.

1. The screen shows a short code and an address (google.com/device).
2. Open that address on your phone or computer, enter the code and approve.
3. The Echo picks up the sign-in and loads your library. The session stays signed in and refreshes itself.

What works: playback and seeking, the library, playlists, offline downloads where the browser allows them. What doesn't: adding music and whole-folder reading. The Picker and `drive.readonly` aren't available in this flow, so those buttons are hidden. Add music from your phone or computer, and it shows up on the Echo after a refresh.

The code flow needs a small Netlify function, `netlify/functions/device-auth.mts` (served at `/api/device-auth`). Google's token endpoint needs the client secret of a *TVs and Limited Input devices* OAuth client, so the secret can't live in the browser. The function only forwards the OAuth exchange (start, poll, refresh, revoke) and stores nothing. It needs two Netlify site environment variables (Functions scope):

| Variable | Value |
| --- | --- |
| `GOOGLE_TV_CLIENT_ID` | the *TVs and Limited Input devices* OAuth client ID |
| `GOOGLE_TV_CLIENT_SECRET` | that client's secret |

Without them the function answers `501` and the code screen says sign-in with a code isn't set up. Setup steps: [docs/google-cloud-setup.md](docs/google-cloud-setup.md#11-tv--echo-show-sign-in-with-a-code-optional).

To try it locally, run the site through the Netlify CLI so the function is served too, with the two variables in your shell or a `.env` file at the repo root:

```sh
npx netlify dev     # then open http://localhost:8888/?device=1
```

## 1. Google Cloud setup (once, for the deployer)

Step-by-step guide for a new project, with screen names, troubleshooting and where each value goes: [docs/google-cloud-setup.md](docs/google-cloud-setup.md). Short version:

1. Create a project at <https://console.cloud.google.com/> and enable the **Google Drive API** and the **Google Picker API**.
2. **Credentials → Create OAuth client ID → Web application.** Under **Authorized JavaScript origins** add (scheme and host only, no path):
   - `http://localhost:5173`
   - `https://spodrive.tihomir-selak.from.hr`
3. **Credentials → Create API key.** Restrict it to **HTTP referrers** (`http://localhost:5173/*` and `https://spodrive.tihomir-selak.from.hr/*`) and to the **Google Picker API**.
4. **App ID** is the project number (Project settings / dashboard).
5. **OAuth consent screen:**
   - User type *External*, with the app name and a support email.
   - Home page `https://spodrive.tihomir-selak.from.hr`
   - Privacy policy `https://spodrive.tihomir-selak.from.hr/privacy.html` (served from `apps/web/public/privacy.html`)
   - Authorized domain `tihomir-selak.from.hr`
   - Scopes: only `drive.file`.
   - **Publish app → In production**, so any Google account can sign in without being added as a test user.

> `drive.file` is a non-sensitive scope, so there is no sensitive-scope review or CASA security audit. The console may ask for a lightweight brand verification form.
>
> No Desktop OAuth client is needed.

## 2. Install

Requires Node 20+.

```sh
npm install
```

## 3. Run the web app

```sh
cp apps/web/.env.example apps/web/.env   # fill in the three Google values below
npm run dev                              # http://localhost:5173
```

| Variable | Value |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | the *Web application* OAuth client ID |
| `VITE_GOOGLE_API_KEY` | the referrer- and Picker-restricted API key |
| `VITE_GOOGLE_APP_ID` | the Google Cloud project number |
| `VITE_BASE` | public base path, `/` by default |

Sign in with Google, press **Add music from Google Drive**, pick your music, and play. On a phone, open the deployed URL and use **Add to Home screen** to install it as an app.

The streaming service worker takes control after the first load. Until then (the very first visit), and on browsers where service-worker streaming fails, the app falls back to downloading the whole track.

## 4. Deploy (Netlify via GitHub Actions)

Live at **https://spodrive.tihomir-selak.from.hr**.

`.github/workflows/ci.yml` does two things:
- On every push and pull request it type-checks, tests and builds.
- On a push to `master` it rebuilds and deploys `apps/web/dist` with the Netlify CLI (`netlify deploy --prod`).

The deploy also publishes `netlify/functions` (the Echo Show / TV sign-in function above). `netlify.toml` sets the security headers and turns off caching for `sw.js`, `index.html` and the manifest.

Repository **Settings → Secrets and variables → Actions** needs:

| Name | Kind | Value |
| --- | --- | --- |
| `NETLIFY_AUTH_TOKEN` | secret | Netlify personal access token |
| `NETLIFY_SITE_ID` | secret | Netlify site ID (Site configuration → Site details) |
| `VITE_GOOGLE_CLIENT_ID` | variable (or secret) | the *Web application* OAuth client ID |
| `VITE_GOOGLE_API_KEY` | variable (or secret) | the Picker API key |
| `VITE_GOOGLE_APP_ID` | variable (or secret) | the Google Cloud project number |

The deploy is skipped, with a notice, until all five are set.

If the Netlify site is also linked to the repo, turn off Netlify's own builds (**Site configuration → Build & deploy → Stop builds**). Otherwise every push deploys twice.

The app itself is fully static and uses hash routing, so any static host works (only the optional code sign-in needs the Netlify function). Build with `VITE_BASE=/` at a domain root, or `VITE_BASE=/<path>/` under a sub-path. Add the host to the OAuth client's authorized origins and the API key's referrers.

## Development

```sh
npm test                                  # vitest
npm run lint                              # type-check all workspaces
npm run build                             # production build (apps/web/dist)
npm run generate-pwa-assets -w @spodrive/web   # regenerate icons from apps/web/public/logo.svg
```

## Privacy notes

- **Your audio is plain:** the files are ordinary audio files in your own Google Drive, so Google stores and can read them like any other Drive file. Spodrive adds no encryption.
- **No server:** the app has no backend and collects nothing. The only exception is the optional code sign-in for TVs, which passes through a Netlify function that forwards the OAuth exchange and stores nothing. It only accesses the files you picked plus the `Spodrive` folder it created (`drive.file` scope).
- **Lyrics:** fetching lyrics sends the track title, artist, album and duration to lrclib.net. You can turn this off in **Settings**.
- **On device:** the library, covers, lyrics and offline downloads are cached in the browser (IndexedDB / Cache Storage). **Sign out** clears them. You can revoke access under Google Account → Security → Third-party access.
- The full policy is at `/privacy.html`.
