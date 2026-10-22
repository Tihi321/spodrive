# Changelog: SPD-06

## 2026-10-22: Echo Show code sign-in and adding music folder by folder

Spodrive can sign in on an Echo Show (Silk) with Google's device-code flow through a small Netlify function. Music can be added folder by folder: choose folders, then select the songs inside each one.

**Repo:** spodrive. **Branch:** `SPD-06_echo-and-folders` (from `origin/master`). **Status:** uncommitted.

### Folder by folder
- `apps/web/src/lib/picker.ts`
  - Shared `openPicker()` helper. `pickFromDrive` behaves as before.
  - New `pickFolders()`: multi-select, folders only.
  - New `pickSongsIn(folder)`: Picker rooted at the folder (`setParent`), audio only, no subfolders, multi-select.
- `apps/web/src/types/picker.d.ts`: added `DocsView.setParent` and `ViewId.FOLDERS`.
- `apps/web/src/lib/sources.ts`: new `addFolder(lib, folder, files, deps)`.
  - It takes the picked songs plus whatever listing the folder finds (the listing wins on duplicates) and turns them into one folder source named after the folder.
  - It takes over loose-file tracks from that folder and keeps `addedAt` when re-adding.
  - It only adds, never removes.
- `apps/web/src/lib/library-actions.ts`
  - `addFolders()`: choose folders, then pick songs in each (skipped when "Read whole folders" is on). Saves once and shows one summary toast.
  - `addSongsToFolder(sourceId)`.
  - The empty-folder hint in `addMusic` now points at **Add folders**.
- `apps/web/src/pages/Home.tsx`: the empty library offers **Add folders** as the main action. Add music is the secondary one.
- `apps/web/src/pages/SettingsPage.tsx`
  - New **Add folders** button.
  - New per-folder **Add songs** button, hidden with full read.
  - In a device session, all Picker actions and the "Read whole folders" toggle are hidden and a note is shown instead. Home does the same.
- `apps/web/test/sources.test.ts`: 5 `addFolder` tests.

### Echo Show / TV sign-in
- `netlify/functions/device-auth.mts` (new): `POST /api/device-auth` with the actions start, poll, refresh and revoke.
  - Proxies to Google's OAuth endpoints with `GOOGLE_TV_CLIENT_ID` / `GOOGLE_TV_CLIENT_SECRET`. Returns 501 if they aren't set.
  - Only the site's own origin and localhost are allowed. Input is validated. Nothing is stored or logged.
- `netlify/tsconfig.json` (new) and root `package.json`: `lint` also type-checks the function.
- `netlify.toml`: functions directory. `.github/workflows/ci.yml`: the deploy command passes `--functions`.
- `apps/web/src/lib/device-auth.ts` (new)
  - Client for the function: start, poll (honours `interval`, adds 5 s on `slow_down`, abortable), refresh and revoke.
  - Pure parsers.
  - `isLimitedBrowser()` (Silk UA or `?device=1`).
- `apps/web/src/lib/auth.ts`
  - Tokens are tagged `via: "gis" | "device"`.
  - Device tokens refresh through the function and keep their refresh token. `invalid_grant` raises the reconnect banner.
  - Sign-out revokes through the function.
  - GIS isn't preloaded for device sessions.
- `apps/web/src/lib/session.ts`
  - `useCodeSignIn` store with `startCodeSignIn` / `cancelCodeSignIn`.
  - `reconnectSession()`: for a device session it tries a silent refresh, otherwise goes back to the sign-in screen with the cache kept.
- `apps/web/src/pages/Gate.tsx`
  - **Sign in with a code** is primary on Silk / `?device=1`, and a small link elsewhere.
  - The code screen shows a large code, the URL, a waiting spinner, cancel, retry and new-code options, and error messages.
- `apps/web/src/ui/Shell.tsx`: the Reconnect banner uses `reconnectSession()`.
- `apps/web/src/lib/db.ts`: `StoredToken.via` and `StoredToken.refreshToken`.
- `apps/web/test/device-auth.test.ts` (new): 11 tests.

### Docs
- `README.md`
  - The **Add folders** bullet replaces the "being verified" note.
  - New "Echo Show / TV" section.
  - Deploy and privacy notes.
- `docs/google-cloud-setup.md`: step 11 covers the TV client, the Netlify env vars (Functions scope), `npx netlify dev` and the curl smoke test. Step 10.4 now uses Add folders. Two new troubleshooting rows.
- `apps/web/public/privacy.html`: the code sign-in goes through a Netlify function that only forwards the OAuth exchange.

### Deviations from the plan
- `addFolders` holds the scan lock while the song pickers are open.
- The device endpoint is the absolute `/api/device-auth`, not relative to `VITE_BASE`.
- On a device session, Reconnect goes back to the sign-in screen when the refresh token is rejected.

### Verification
- `npm run lint`: pass (web, core and the Netlify function).
- `npm test`: 11 files, 114 tests passed.
- `npm run build -w @spodrive/web`: pass.
- A smoke test of the function handler (implementer scratch script) passed. It checked 405 on GET, 403 on a foreign origin, 501 without env vars, and 400 on bad input.

**Not run:**
- Picker flows against real Google.
- `netlify dev` with the real device flow.
- The deployed site.
- The Echo Show 8 itself.

### Follow-ups and limitations
- Create the "TVs and Limited Input devices" OAuth client in the same Cloud project and set `GOOGLE_TV_CLIENT_ID` / `GOOGLE_TV_CLIENT_SECRET` in Netlify (Functions scope).
- Still unverified: whether the TV client sees `drive.file` grants made through the web client. Test it with the curl steps in `docs/google-cloud-setup.md` first.
- No adding music on the Echo, and no whole-folder read there: `drive.readonly` isn't allowed in the device flow.
- Not yet checked on the Echo: Silk service-worker streaming, and playback when the screen goes home or to sleep.
