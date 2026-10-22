# SPD-06: Echo Show (Alexa) sign-in + add music folder by folder

> Branch: `SPD-06_echo-and-folders` (from `master`).

## Context

Two problems, both reported by the user:

1. **Spodrive doesn't work on an Echo Show 8 (Alexa+).** The only browser is Silk. Sign-in uses the GIS token client (`apps/web/src/lib/auth.ts`, `initTokenClient` + popup). Silk either blocks the popup or Google rejects it as an embedded browser (`disallowed_useragent`). Fix: Google's **OAuth device flow** ("TVs and Limited Input devices"). The Echo shows a short code, the user approves at google.com/device on a phone, and the Echo polls until it gets an access token **and a refresh token**. `drive.file` is allowed in the device flow; `drive.readonly` is not (so "Read whole folders" is unavailable on the Echo). The Echo does not need the Picker: music is added on the phone/computer, and the Echo reads `library.json` / `playlists.json` from `/Spodrive` and streams.
   - The token endpoint needs the TV client's **secret**, and Google's device/token endpoints may not allow browser CORS. So add one small **Netlify function** that holds the secret and proxies the calls. The site is already on Netlify.
   - Assumption to verify on the real device: `drive.file` grants belong to the Cloud **project**, so a second OAuth client (TV type) in the same project sees the files picked through the web client.

2. **Picking a whole folder doesn't bring in its songs** (with `drive.file`, picking a folder grants the folder, not the files inside). The user wants to **add folders one by one, and several folders manually**. Fix: a two-step "Add folders" flow:
   1. A folders-only Picker (multi-select) to choose one or more folders.
   2. For each chosen folder in turn, a Picker opened **inside that folder** (`DocsView.setParent(folderId)`), audio only, no subfolders, multi-select. The user selects the songs (Shift+click selects a range). Selecting the songs is what grants access to them.
   The result is one **folder source** per folder (with the real folder name, so the Folders tab and Rescan work). When "Read whole folders" (`drive.readonly`) is on, step 2 is skipped and the folder is expanded as today.

## Approach

### A. Folder by folder (`picker.ts`, `sources.ts`, `library-actions.ts`, UI)

- `apps/web/src/types/picker.d.ts`: add `DocsView.setParent(id)`, `ViewId.FOLDERS`, and anything else used.
- `apps/web/src/lib/picker.ts`:
  - Factor the shared builder setup (token, key, app id, multi-select, callback → `PickedDoc[]`) into a helper that `pickFromDrive` reuses.
  - `pickFolders(): Promise<PickedDoc[]>`: folders only (`DocsView(ViewId.FOLDERS)` or DOCS with folder mime type, `setSelectFolderEnabled(true)`, `setIncludeFolders(true)`), multi-select, title "Choose folders to add".
  - `pickSongsIn(folder: {id, name}): Promise<PickedDoc[]>`: `DocsView(DOCS).setParent(folder.id).setMimeTypes(PICKER_MIME_TYPES).setIncludeFolders(false)`, LIST mode, multi-select, title `Select the songs in "<name>"` (keep it short; mention Shift+click if the title allows). No upload tab.
- `apps/web/src/lib/sources.ts`: new pure, injectable `addFolder(lib, folder: PickedDoc, files: PickedDoc[], deps, onProgress?) : Promise<ScanResult>`:
  - `getMeta` each picked file and run `toFound(meta, { id: folder.id, path: [folder.name] })`. Skip files that fail (count as failed).
  - Union with `expandFolder(folder, deps.listChildren)` when it succeeds (songs picked earlier, or everything when drive.readonly is granted). Ignore listing errors. Dedupe by id, listing wins.
  - Empty union → `emptyFolders: [folder.name]`.
  - Otherwise `diffSource` against `folder.id` (adding only, so ignore `removedIds`), `applyDiff`, `adoptTracks` (takes over loose-file tracks), `upsertSource({ id: folder.id, kind: "folder", name: folder.name, addedAt })` (keep the original `addedAt` if the source exists).
  - Reuse `applyDiff`, `adoptTracks`, `upsertSource`, `toFound`, `expandFolder`. Don't duplicate them.
- `apps/web/src/lib/library-actions.ts`:
  - `addFolders()`: `pickFolders()` → for each folder in sequence: `hasFullRead` ? `[]` : `await pickSongsIn(folder)`. A cancelled step 2 skips that folder unless full read is on. Then `addFolder(...)` inside one `run("Adding folders", …)`, threading the library through. Save once, then show one summary toast (`"<n> tracks added from <k> folders"`, plus empty-folder names).
  - `addSongsToFolder(sourceId)`: re-open step 2 for an existing folder source (to add songs put there later), then `addFolder`.
  - Update the `addMusic` empty-folder toast text to point at **Add folders** instead of "open the folder in the picker".
- UI:
  - `apps/web/src/pages/Home.tsx` `EmptyLibrary`: add a second button **Add folders** next to "Add music from Google Drive". Adjust the copy so folder-by-folder is the suggested way to add albums.
  - `apps/web/src/pages/SettingsPage.tsx` Library section: an **Add folders** button next to "Add or upload music". Per folder source, add an **Add songs** button (hidden when full read is on, where Rescan covers it).
- Tests (`apps/web/test/sources.test.ts`): `addFolder` with fake deps covers picked files only (listing returns nothing), union with the listing, the empty result → `emptyFolders`, adoption of a loose-file track (its `pick_` source disappears), and re-adding to an existing folder keeps `addedAt` and adds no duplicates.

### B. Echo Show sign-in with a code (device flow)

**Server: `netlify/functions/device-auth.mts`** (repo root, modern Netlify Functions API, no dependencies, `export const config = { path: "/api/device-auth" }`):
- `POST` JSON `{ action: "start" }` → `POST https://oauth2.googleapis.com/device/code` (`client_id`, `scope=drive.file`) → returns `{ device_code, user_code, verification_url, expires_in, interval }`.
- `{ action: "poll", device_code }` → `POST https://oauth2.googleapis.com/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, client id + secret → pass Google's JSON and status through (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or tokens).
- `{ action: "refresh", refresh_token }` → token endpoint with `grant_type=refresh_token`.
- `{ action: "revoke", token }` → `POST https://oauth2.googleapis.com/revoke`.
- Env: `GOOGLE_TV_CLIENT_ID`, `GOOGLE_TV_CLIENT_SECRET` (Netlify site environment variables, Functions scope). Missing → `501 { error: "device_signin_not_configured" }`.
- Accept only `POST`. Reject other `Origin`s (allow the site's own origin from `process.env.URL` / `DEPLOY_PRIME_URL`, and `http://localhost:*`). Validate the action and the field types. Never log tokens.
- `netlify.toml`: `[functions] directory = "netlify/functions"`. `.github/workflows/ci.yml` deploy step: add `--functions="$GITHUB_WORKSPACE/netlify/functions"` (absolute because of `--filter`).
- Type-check: make sure the function is covered by `npm run lint`. Either give it a tiny `tsconfig` included in the lint, or keep it plain enough that the existing setup catches it. Use the global `Request`/`Response` types, no `@netlify/functions` dependency.

**Client:**
- `apps/web/src/lib/db.ts`: `StoredToken` gets optional `refreshToken?: string` and `via?: "gis" | "device"`.
- New `apps/web/src/lib/device-auth.ts`:
  - `startDeviceSignIn()`, which returns the code info.
  - `pollDeviceSignIn(info, signal)`, which honours `interval`, adds 5 s on `slow_down`, and stops on `expired_token` / `access_denied` / abort.
  - `refreshDeviceToken(refreshToken)` and `revokeDeviceToken(token)`.
  - Keep the response parsing pure and unit-testable (for example `parseTokenResponse` and `nextPollDelay`).
  - `isLimitedBrowser()`: `/\bSilk\//` in UA, or `?device=1` in the URL / hash.
- `apps/web/src/lib/auth.ts`:
  - `refreshToken()` / `reconnect()` / `getAccessToken()`: when the current token has `via === "device"` and a `refreshToken`, refresh through `refreshDeviceToken` instead of GIS. Keep the refresh token in the new stored token. If refresh fails with `invalid_grant`, set `needsReconnect`.
  - `scheduleRefresh` and the SW `need-token` path go through `refreshToken()`, so they work unchanged.
  - `hasFullRead` stays false for device tokens.
  - `signOut()`: for device tokens, revoke the refresh token through the function (best effort) instead of `google.accounts.oauth2.revoke`.
  - Export a `setDeviceToken(tok)` (or similar) so the session can store the result and fetch the user (`fetchUser` works with any token).
  - Don't preload GIS when the stored token is a device token (avoids needless script loads on Silk).
- `apps/web/src/lib/session.ts`: `connectWithCode()` flow state for the gate. Store the token on success, then `setPhase("ready")` and `afterReady()` exactly like `connect()`.
- `apps/web/src/pages/Gate.tsx` `ConnectScreen`:
  - New **Sign in with a code** option. It's the primary button when `isLimitedBrowser()`, otherwise a small secondary link ("Using a TV or Echo Show? Sign in with a code").
  - Code view: big `user_code`, the `verification_url`, a "Waiting for approval…" spinner, Cancel, a restart on expiry, and clear errors (not configured / denied / expired). Make it readable from a distance (large type), and touch-friendly.
  - No new dependency for a QR code.
- Reconnect banner (find where `reconnect()` is used, e.g. `ui/Shell.tsx`): for device tokens a silent refresh usually just works. If it needs the user, send them to the code screen (for example sign out locally to the gate, keeping the cached library, or open the code sheet). Choose the simplest option that doesn't lose data.
- Hide Picker-based actions in a device session (`token.via === "device"`): "Add music", "Add folders", "Add songs", and the "Read whole folders" toggle. Show a one-line note instead: "Add music from your phone or computer, it shows up here after a refresh." Rescan and Remove stay.
- Tests: `apps/web/test/device-auth.test.ts` covers token-response parsing, the poll-delay rules (`slow_down`), and `isLimitedBrowser` UA detection.

### C. Docs
- `README.md`: an "Echo Show / TV" section that covers the code sign-in, what works (playback, library, playlists), what doesn't (adding music, whole folders), the Netlify function and its env vars, and local dev with the function via `npx netlify dev`. Replace the "being verified" folder note with the new **Add folders** flow.
- `docs/google-cloud-setup.md`: create an OAuth client of type **TVs and Limited Input devices** in the same project, then set `GOOGLE_TV_CLIENT_ID` / `GOOGLE_TV_CLIENT_SECRET` in Netlify → Site configuration → Environment variables (Functions scope). Also include the curl smoke test for the device flow.
- `apps/web/public/privacy.html`: mention that the device sign-in passes through a Spodrive function on Netlify that only forwards the OAuth exchange and stores nothing.

## Files
- New: `netlify/functions/device-auth.mts`, `apps/web/src/lib/device-auth.ts`, `apps/web/test/device-auth.test.ts`
- Changed: `apps/web/src/lib/{auth,db,session,picker,sources,library-actions}.ts`, `apps/web/src/types/picker.d.ts`, `apps/web/src/pages/{Gate,Home,SettingsPage}.tsx`, the reconnect banner component, `apps/web/test/sources.test.ts`, `netlify.toml`, `.github/workflows/ci.yml`, `README.md`, `docs/google-cloud-setup.md`, `apps/web/public/privacy.html`

## Verification
1. `npm run lint`, `npm test`, `npm run build` pass.
2. Desktop, `npm run dev`:
   - **Add folders**: pick two folders. Each opens a songs picker inside that folder, and the selected songs land as two folder sources with the right names. The Folders tab groups them. Add songs to an existing folder source without creating duplicates. With full read on, the second picker is skipped.
   - The existing "Add music from Google Drive" and upload still work.
3. Device flow locally: `npx netlify dev` with the TV client env vars, open `/?device=1`, approve on a phone, and the library loads. Force token expiry (edit `expiresAt` in IndexedDB) and check the refresh goes through `/api/device-auth`. Sign out revokes.
4. Echo Show 8 (after deploy and setting the Netlify env vars): open the site in Silk, sign in with the code, and confirm the picked songs are visible (this proves the cross-client `drive.file` assumption). Play, seek, and check whether playback continues when the screen returns home.

## Implementation status
- [x] A. Folder by folder (`pickFolders`/`pickSongsIn`, `addFolder`, `addFolders`/`addSongsToFolder`, Home/Settings buttons, device-session hiding, 5 new tests)
- [x] B. Device-flow sign-in (`netlify/functions/device-auth.mts`, `lib/device-auth.ts`, auth/session/Gate/Shell, 11 new tests)
- [x] C. Docs (README, google-cloud-setup step 11, privacy.html)
- [x] Verification 1: `npm run lint`, `npm test` (114 passed), `npm run build -w @spodrive/web` all pass
- [ ] Verification 2–4: manual desktop Picker run, `netlify dev` device flow, Echo Show check (need real Google / device)

Deviations / notes:
- `addFolders` holds the scan lock while the song pickers are open (no concurrent scan can start mid-flow).
- Reconnect banner on a device session: silent refresh first; if Google rejects the refresh token, back to the sign-in screen ("Sign in with a code again") with the cached library kept.
- Client calls the absolute `/api/device-auth` (the function lives at the site root, not under `VITE_BASE`).
- Root `lint` also runs `tsc -p netlify/tsconfig.json` (new `netlify/tsconfig.json`).
