# SPD-04: Background playback, lasting sign-in, offline, playlist/folder play modes

Branch: `SPD-04_background-offline-playmodes`

## Reported
1. On mobile with the screen off, music stops after a while.
2. Have to reconnect Google almost every time I come back.
3. Not sure downloaded music plays offline / when not connected.
4. Shuffle on/off and repeat on/off on a playlist itself, and on folders.

## Root cause (1 + 2)
The GIS token flow has no refresh token. Tokens last 1 h, and renewing opens a Google popup, which browsers
block without a tap. The timer refresh, the refresh on return (visibilitychange) and the service worker's
"need-token" request all failed silently, so:
- screen off: the next track's Range request had no valid token -> 502 -> fallback blob download also failed -> stop;
- coming back: the refresh attempt failed -> "Reconnect Google" banner.
Also, the `pause` fired on every track change (and by `ended`) set the media session to "paused" between tracks.

## Changes
- `netlify/functions/auth.ts` (`/api/auth/{status,exchange,refresh,logout}`): GIS code flow (GIS always sends
  access_type=offline + prompt=consent, checked in gsi/client), code exchanged with the client secret, refresh token
  kept only in an HttpOnly/Secure/SameSite=Strict cookie scoped to /api/auth. Custom `X-Spodrive` header as CSRF guard.
- `lib/server-auth.ts` (page + SW), `lib/auth.ts`: "server" vs "browser" mode (stored in IndexedDB `authMode`).
  Server mode renews silently; falls back to the old token flow when the function isn't configured (e.g. `vite dev`).
- `sw.ts` / `stream/sources.ts`: the service worker renews the token itself via `/api/auth/refresh` before asking the page.
- `player/engine.ts`: track switches and `ended` no longer report a pause; offline/signed-out load errors are
  "unavailable" (skip) instead of switching to compatibility (blob) mode.
- `player/queue.ts` + `player/store.ts`: `isPlayable` (downloaded, or online and signed in); next/prev/auto-advance
  skip unavailable songs; Play/Shuffle buttons start at the first playable song; tapping an unavailable song explains why.
- `lib/offline.ts`: `navigator.storage.persist()` on download.
- `state/playmodes.ts`: per playlist/folder shuffle + repeat (device-local, KV `playModes`). DetailHeader switches;
  player shuffle/repeat changes are saved back to the playing playlist/folder.
- Folders tab + `/folder/:id` page (picked folder sources, album order).
- TrackRow dims songs that can't play right now; Settings shows the session type with a "Stay signed in" button.
- Docs: README, google-cloud-setup.md, privacy.html; CI deploys `--functions`.

## Needed to activate the lasting sign-in
Netlify site env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, then redeploy. Check `/api/auth/status` -> `{"enabled":true}`.
Existing devices: Settings -> Stay signed in (or tap Reconnect once).

## Verification
- `npm run lint`, `npm test` (110 tests incl. new `auth-function.test.ts`, `playable.test.ts`), `npm run build -w @spodrive/web`.
- Not verified on a real phone / real Netlify deploy yet.
