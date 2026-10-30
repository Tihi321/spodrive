# SPD-05: Keep playing across track changes with the screen off (Android)

> Branch: `SPD-05_background-playback` (from `origin/master`).

## Context

On Android (Brave, installed PWA), music keeps playing with the screen off **during a song**, but after a song (or a few songs) ends, the next song is selected at 0:00 and **paused**, and the lock-screen media notification disappears.

So background audio works. The **auto-advance** fails. Today, on `ended`, `PlayerEngine.load()` (`apps/web/src/player/engine.ts:123`) calls `a.pause()`, swaps `src` to `/stream/<id>` (SW → Drive), and calls `play()` again. While the page is hidden that leaves a window with no audible media. Chromium/Brave on Android lowers the page's priority and media focus in that window, and the new `play()` either gets rejected (`NotAllowedError` → the engine sets `wantPlay=false` and shows a toast nobody sees) or the element gets paused by the browser. Contributing risks that also fit "works sometimes, fails after a few songs":
- The 8 s stall watchdog (`engine.ts:106`) can trigger `enterFallback` while hidden (background network is slower). That **sticks for the session** (`sessionStorage`), and every later transition then downloads the whole file before playing, which makes the gap much longer.
- Every transition goes `pause()` → `onPlaying(false)` → `mediaSession.playbackState = "paused"`, which tells Android playback stopped.

**Capacitor is not needed, and on its own would not fix this.** An Android WebView pauses JS and media in the background unless playback moves to a native foreground-service player, which means rewriting playback, Drive streaming and auth natively. Fix the web player first.

## Approach

### 1. Playback event log (to confirm the root cause on the phone)
- New `apps/web/src/lib/playback-log.ts`: in-memory ring buffer (~300 entries) of `{t, ev, detail, hidden}`. It is saved to IndexedDB under a new `KV.playbackLog` key (`apps/web/src/lib/db.ts:63`), throttled, and also flushed on `visibilitychange`→hidden.
- Log from `engine.ts`: `ended`, load start (track id, stream vs blob), `play()` resolved / rejected (`err.name`), `pause` events (with "requested by us?" flag), `waiting`/`stalled`, `error` (`audio.error.code`), watchdog fallback, visibility changes. Log `need-token` handling from `auth.ts:240`.
- Settings → Playback section (`apps/web/src/pages/SettingsPage.tsx:163`): a "Playback log" row with **Copy** and **Clear** buttons.

### 2. Low-risk hardening of the single-element path (`engine.ts`, `store.ts`)
- **No pause on auto-advance:** in `load()`, skip `a.pause()` when the element has already `ended`. Add a `suppressPausedState` flag so the transition does not emit `onPlaying(false)`. Media Session stays `"playing"` until the new track plays or truly fails.
- **Don't drop the play intent while hidden:** in `tryPlay()`, if `NotAllowedError` happens while `document.hidden`, keep the metadata and set `playbackState = "paused"`. Do not clear the session, so the lock-screen notification (and its play button, which counts as a user gesture) stays. Also register a one-shot retry on `visibilitychange`→visible.
- **Unexpected pause recovery:** on a `pause` event we did not request (`wantPlay` true, not ended, not seeking), retry `play()` once after a short delay and log it.
- **Watchdog while hidden:** when `document.hidden`, raise the stall threshold (e.g. 30 s), and **do not** make fallback sticky in `sessionStorage` when the stall happened in the background (fallback for this track only).

### 3. Gapless handoff with a pre-buffered standby element (the main fix)
Remove the silent gap entirely so the page never stops being audible:
- `PlayerEngine` owns two `<audio>` elements (`active`, `standby`). Event listeners attach to both and act only when `e.target === active` (move the current constructor listener body into an `attach(el)` helper).
- **Unlock both on the first user gesture:** the first `play()` that comes from a click also calls `standby.play()` with a tiny silent WAV data-URI, then pauses it. This matches Android's per-element user-gesture policy.
- At `onNearEnd` (already fired at 80% / 30 s before the end, `engine.ts:49`), the store passes the next track to a new `engine.preloadNext(track)`. It sets `standby.src = trackStreamUrl(id)` with `preload="auto"` and calls `load()`. The existing `prefetchTrack` keeps filling Cache Storage, so the SW serves bytes locally.
- On `ended`: if the standby holds the expected next track, call `standby.play()` **synchronously inside the `ended` handler**, swap `active`/`standby`, then update store and Media Session. Otherwise fall back to today's `load()` path (with the step-2 hardening).
- Invalidate the standby when the queue changes (shuffle, jump, remove, repeat-one, manual next/prev). `store.ts` calls `engine.clearPreload()` from those actions. Volume is applied to both elements, and `unload()` clears both.
- The blob-fallback mode keeps using a single element (no preload) to limit scope.

### Files
- `apps/web/src/player/engine.ts`: most changes (dual element, preload, hardening, logging)
- `apps/web/src/player/store.ts`: call `preloadNext` in `onNearEnd`, `clearPreload` on queue edits, handle the "advanced via standby" callback (e.g. new `EngineEvents.onAdvanced(trackId)`) to update `queue.index`/`trackId`/Media Session without reloading
- `apps/web/src/player/mediasession.ts`: keep the state during transitions (no API change expected)
- `apps/web/src/lib/playback-log.ts` (new), `apps/web/src/lib/db.ts` (KV key), `apps/web/src/pages/SettingsPage.tsx` (log UI)
- Reuse: `trackStreamUrl` (`lib/sw-bridge.ts:37`), `nextIndex` (`player/queue.ts`), `prefetchTrack` (`lib/offline.ts:155`)

## Verification
1. `npm test` and `npm run build` pass. Add unit tests where logic is pure (the ring buffer, and the "is standby valid for next index" decision if extracted into `queue.ts`).
2. Desktop: `npm run dev`. Play a queue, seek near the end, confirm the next track starts with no gap and the queue/Now Playing/Media Session update. Shuffle, jump, remove, and repeat-one all invalidate the preload correctly.
3. Android (Brave PWA, the real test): deploy, start a queue of short tracks, turn the screen off, and leave it for 5+ track changes. The notification should stay and the music should continue. Afterwards, Settings → Playback log → Copy shows uninterrupted `ended → standby play resolved` entries.
4. Optional live debugging: USB + `brave://inspect` on desktop to watch the console during a screen-off transition.
5. Also check on the phone (outside the code): Android Settings → Apps → Brave → Battery → **Unrestricted**. Retest in Chrome as an installed PWA to see whether Brave-specific media behavior is involved.

## Implementation status

- [x] Step 1: playback log (`lib/playback-log.ts`, `KV.playbackLog`, engine/auth logging, Settings Copy/Clear row, `test/playback-log.test.ts`)
- [x] Step 2: single-element hardening (no pause on ended, suppressed "paused" during transition, hidden NotAllowedError keeps intent + retry on visible, unexpected-pause retry, 30 s hidden watchdog, non-sticky background fallback)
- [x] Step 3: dual-element standby handoff (`preloadNext`/`clearPreload`, `EngineEvents.onAdvanced`, store invalidation on queue edits)

Deviations / notes:
- Background-stall fallback is per track (`fallbackFor`), not persisted; a fallback while visible stays sticky as before.
- Queue edits that do not reload the current track (shuffle, repeat, playNext, addToQueue, move, remove non-current) call `refreshPreload()`: clear the standby and re-preload if the near-end point was already passed. Load-causing actions only clear.
- Standby unlock runs at the top of `load()`/`play()` (sync part); marked unlocked only when the silent play resolves.
- Not exercised on a real device or in a browser; only static checks and unit tests ran.

Verification: `npm test` 10 files / 98 tests passed; `npm run build` (tsc --noEmit + vite build + SW) succeeded; `npm run lint` (tsc --noEmit) clean.

Review corrections (applied):
- Unexpected-pause retry now only runs within 10 s of a track start (`trackStartedAt`, set in `load()` and `advanceToStandby()`); later pauses (call, focus loss, headphones) are reported as paused and not resumed. Both branches are logged.
- `refreshPreload()` keeps the standby when the expected next track id is unchanged (new `engine.preloadedId`, shared `nextTrack()` helper in the store).
