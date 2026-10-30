# Changelog: SPD-04 (Folders tab + read whole folders)

## 2026-10-15

Branch `SPD-04_folders` (from `master` @ 767785b). Uncommitted.

**Why:** the scanner was already recursive (12 levels), but with `drive.file` a picked folder doesn't give access to the songs inside it. That is why "Rescan folders" found nothing new. The user chose an opt-in for the broader scope.

- `apps/web/src/lib/auth.ts`, `db.ts`, `types/gis.d.ts`: optional `drive.readonly`.
  - Each token now stores the scopes Google granted with it.
  - `hasFullRead()` checks a token for `drive.readonly`. `requestFullRead()` asks for it.
  - Refreshes ask for the same scopes the current token already has.
- `apps/web/src/lib/library-actions.ts`: `enableFullRead()` asks for the access, then rescans the folder sources.
  - A picked folder with no readable songs gets a hint to turn on "Read whole folders".
  - Scan results report an `updated` count, and a scan with only updates is saved too.
- `apps/web/src/pages/SettingsPage.tsx`: "Read whole folders" toggle in Library. Turning it off explains how to revoke the access (sign out, or myaccount.google.com/permissions).
- `packages/core/src/manifest.ts`: Track gains `folderId?` and `folderPath?`.
- `apps/web/src/lib/sources.ts`:
  - Every found file records its folder id and path.
  - Loose picked files look up their parent folder, when it is readable.
  - `diffSource().moved` plus `relocateTracks()` backfill or update folders without re-reading tags.
  - `adoptTracks()`: a folder source takes over tracks from loose-pick sources, so a folder rescan keeps them up to date. Pick sources left empty are dropped.
- `apps/web/src/lib/library-index.ts`: `folders` / `folderById`.
- `apps/web/src/pages/Home.tsx`: Folders tab. `pages/Details.tsx` + `App.tsx`: `/folder/:id` page, with an "Add folder to playlist" action.
- Tests: `sources.test.ts`, `library.test.ts`.
- README.

**Verification:** `npm run lint` pass, `npm test` pass (94 tests), `npm run build` pass. Not run: a real Google consent for `drive.readonly`, or a scan in the live app.
