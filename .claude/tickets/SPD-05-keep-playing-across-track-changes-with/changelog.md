# Changelog

## 2026-10-19 · SPD-05: Gapless auto-advance so playback survives track changes with the screen off

**Repo:** spodrive · **Branch:** `SPD-05_background-playback` (from `origin/master`) · **Status:** uncommitted

### Files changed
- `apps/web/src/player/engine.ts`
  - The engine now uses two `<audio>` elements: one active, one standby. `audio` is a getter for the active element. Events from the standby are ignored.
  - `preloadNext(track)` buffers the next track on the standby. This only happens in stream mode and only when a service worker controls the page.
  - On `ended`, the engine calls `standby.play()` synchronously, swaps the elements and emits the new `onAdvanced(id)`, so there is no silent gap. If that `play()` rejects, it falls back to `load()`.
  - The standby is unlocked with a generated silent WAV on the first user-initiated `play()`/`load()`.
  - `load()` no longer pauses an element that has already ended, and does not report "paused" while a track change is in progress.
  - **`NotAllowedError` while hidden:** the engine keeps the play intent and the media session, and retries once when the page becomes visible. There is no toast.
  - **Pause recovery:** an unexpected pause within 10 s of a track start gets one retry. Later pauses, such as a phone call or headphones disconnecting, are reported normally and not resumed.
  - **Watchdog:** the stall threshold is 30 s while hidden. A fallback triggered while hidden applies to that track only and is not saved to `sessionStorage`.
  - Playback events are logged throughout.
- `apps/web/src/player/store.ts`:
  - `onAdvanced` advances the queue, metadata, recents and persistence without reloading.
  - `nextTrack()` / `preloadNextTrack()` run at the near-end point and handle both prefetch and standby preload.
  - Actions that reload clear the preload. Other queue edits call `refreshPreload()`, which keeps the standby when the next track is unchanged.
  - `initPlayer` loads the playback log.
- `apps/web/src/lib/playback-log.ts` (new):
  - `RingLog` holds 300 entries.
  - `log()`, `getLogText()` and `clearLog()` are exported, and `useLogCount` drives the UI count.
  - The log is saved to IndexedDB at most every 5 s, and immediately when the page goes hidden.
- `apps/web/src/lib/db.ts`: `KV.playbackLog`.
- `apps/web/src/lib/auth.ts`: logs SW `need-token` requests.
- `apps/web/src/pages/SettingsPage.tsx`: Settings → Playback has a "Playback log" row with an entry count, **Copy** and **Clear**.
- `apps/web/test/playback-log.test.ts` (new): ring buffer and formatting tests.

### Deviations from the plan
- `refreshPreload()` was added so queue edits that don't reload the current track rebuild the standby when needed, instead of silently losing gapless playback.
- Unexpected-pause recovery is limited to a 10 s window after a track start (review correction), so the app doesn't auto-resume after calls or headphone disconnects.
- The standby unlock is attempted on every `load()`/`play()` until it succeeds, not only on the first one.

### Verification
- `npm test`: 10 files, 98 tests passed.
- `npm run build`: passed (tsc, vite, SW build).
- `npm run lint`: passed.
- **Not run:** desktop browser check of the gapless handoff and queue edits, and the real test on an Android Brave PWA with the screen off across 5+ track changes.

### Follow-ups and known limitations
- If the problem persists on the phone, copy Settings → Playback → Playback log after a failure to find the failing step.
- Blob fallback mode still uses one element with no preload, so it can still have a gap.
- Phone-side checks: Android battery setting for Brave → Unrestricted; compare with a Chrome-installed PWA.
- The Google token still lasts ~1 h, and a silent refresh from a hidden page may be blocked. That would show as `need-token` in the log. It is out of scope here.
