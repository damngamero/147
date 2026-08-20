# 147

Class log → topics → automatic 1-4-7 blurt schedule → weekly → fortnightly.

Vite + vanilla TypeScript + IndexedDB. No framework, no server, no account, no internet.
One codebase ships three ways: browser, a Windows `.exe` (Electron) and an Android `.apk`
(Capacitor, with a home screen widget).

```bash
npm run dev
```

Then open http://localhost:5190

## The rules this app enforces

**Two revision methods, set per chapter** — **Blurt** (write everything from memory) or
**Questions** (work practice questions on paper). Maths, and any physics chapter that's more
about solving than recalling, wants Questions. Toggle it on the chapter page; it only changes the
instructions and labels, the 1-4-7 schedule is identical either way.

**A blurt covers a whole class**, not a single topic. Every topic taught in one class comes up
together, on the same day. You blurt on paper; the app only asks how each topic went, 1-5.

**1-4-7 ladder** — one ladder per class, offsets counted from the date it happened:

| Blurt | Gap | Offset from class | Example (class on the 14th) |
| ----- | --- | ----------------- | --------------------------- |
| 1     | +1  | +1 day            | 15th                        |
| 2     | +4  | +5 days           | 19th                        |
| 3     | +7  | +12 days          | 26th                        |

**After the ladder** — a class that has cleared all three goes onto a **weekly** blurt, anchored
to the day the last one was actually done.

**Only today** — the Today tab shows what is due today and nothing else. A blurt that is not due
yet cannot be opened at all; blurting early throws away the gap that makes spacing work.

**Weak spots** — the 1-5 ratings per topic are the only input the app wants back, and the Weak
spots tab ranks every topic worst-first from them.

**Chapter graduation** — when the chapter is marked *finished* **and** its flagged *last topic*
has cleared its 1-4-7, the chapter goes onto a **fortnightly** blurt, and the per-class weekly
blurts in that chapter stop. One fortnightly chapter blurt replaces them. Un-tick *finished* and
everything reverts. With no last topic flagged, the fallback trigger is every topic having cleared.

A topic still mid-ladder inside a graduated chapter keeps its remaining 1-4-7 blurts — it just
never gets a weekly one, it drops straight into the chapter blurt when it clears.

Skipping a blurt counts as resolving it, so a missed day never jams the ladder.

## Builds

```bash
npm run exe
```

Writes `release/147 Setup <version>.exe` (installer) and `release/147 <version>.exe` (portable),
version taken straight from `package.json`.

electron-builder normally unzips Electron to `win-unpacked.tmp` and renames that folder; on this
machine the rename fails with `EPERM` every time (something holds a handle on the freshly
extracted binaries — Defender, most likely). `scripts/exe.mjs` sidesteps it by unpacking the
cached Electron zip into `.electron-dist` itself and passing `--c.electronDist`.

```bash
npm run icons
```

Regenerates the app icon from `scripts/icon.py` into `build/icon.ico` (Windows), `build/icon.png`
(window/taskbar) and every Android mipmap density via `@capacitor/assets`. Only needed if the
icon design changes.

```bash
npm run apk
```

Writes `release/147-debug.apk` — sideload it straight onto the phone. `npm run apk -- --release`
makes an unsigned release APK instead. The script finds the Android SDK and a JDK 21+ itself
(Android Studio's bundled `jbr` counts) and writes `android/local.properties`.

Requirements for the APK: Android Studio's SDK (platform 36) and a JDK 21+. Capacitor 8 rejects
JDK 17, which is why the script hunts for the bundled one.

### Cutting a release (for self-update to see it)

The APK checks GitHub Releases for updates (see "Self-update" below), so a build only reaches
phones once it is actually published there:

1. Bump the version — **in two places, they have to match**: `"version"` in `package.json` and
   `versionName` in `android/app/build.gradle` (bump `versionCode` too, it just counts up).
2. `npm run apk` and `npm run exe`.
3. On GitHub: **Releases → Draft a new release**. Tag it `v<version>` (e.g. `v0.3.0`) — the `v`
   is optional, the app strips it either way. Attach `release/147-debug.apk`. Publish.
4. Optional: attach the `.exe` files too, for anyone installing the desktop app fresh.

Steps 1-2 are scriptable; step 3 needs a browser session on github.com, so it stays manual (or
hook up the `gh` CLI / a GitHub Action later if this gets tedious).

## Reminders and widget

- **Reminders** — Settings → Reminders. On Android these are real scheduled notifications at
  5pm on every day something is due, rebuilt whenever the schedule changes. In the browser and
  the desktop app you get one notification per day while 147 is open.
- **Home screen widget (Samsung / any Android)** — long-press the home screen → Widgets → 147.
  Shows the due count and the top three topics; tapping it opens the app. The web layer parks a
  JSON payload in `CapacitorStorage` and pokes the native provider, since a widget cannot run JS.

- **147 calendar (Android)** — Settings → 147 calendar. Writes the schedule into a **local**
  calendar (`ACCOUNT_TYPE_LOCAL`, via `CalendarContract`) that is not tied to any Google or
  Samsung account, so it shows up as its own separate, independently toggleable row in Samsung
  Calendar's calendar list — hide it with one tap without touching real classes and events. Every
  sync is a full replace (clear the 147 calendar's events, write the current schedule fresh), so
  there is nothing to reconcile and nothing can go stale. Needs only the normal Android calendar
  permission — no account, no OAuth, no internet. `android/.../CalendarPlugin.java`.
- **Self-update (Android + desktop)** — checked automatically on launch and every few hours in
  the background; a **Restart now / Later** popup shows up when a newer build is found (Settings
  → Updates also has a manual "Check for updates" button). Needs the repo to be public (an
  unauthenticated `fetch` against the GitHub API).
  - **Android**: downloads the attached APK and hands it to the system installer — needs, the
    first time, the "install unknown apps" toggle for 147 specifically, which the app walks you
    to if it's off. `android/.../UpdaterPlugin.java`.
  - **Desktop**: downloads the installer, runs it silently (`/S`, no wizard, no elevation needed
    since it's a per-user install), then relaunches itself into the new build automatically.
    `electron/main.cjs`, `electron/preload.cjs`.
  - `src/update.ts` picks between the two; `src/updateBanner.ts` owns the popup. See "Cutting a
    release" above for how a new version actually reaches this check.

There is deliberately no Google Calendar or Google Tasks integration — see below for why.

## Cloud sync — no Google sign-in, just a code

Optional, and off until you set it up. It runs on **your own** Firebase project — nothing is
hosted by this app and there is no shared backend. There is no Google account involved at all:
every device authenticates *anonymously* with Firebase (invisible, no consent screen), and a
random `accountKey` generated on the first device is what actually partitions the data — not the
Firebase identity, since two anonymous sessions can never be "the same user" without a server.

1. Create a project at console.firebase.google.com, add a **Web app**, copy the `firebaseConfig`.
2. **Authentication → Sign-in method → Anonymous → Enable.**
3. Create a **Firestore Database**.
4. Publish these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /accounts/{accountKey}/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /pairs/{code} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. In the app: **Settings → Cloud sync → Paste Firebase config**, then **Turn on sync**.

The config is stored in `localStorage`, not compiled in, so the same `.exe`/`.apk` works against
any project without a rebuild — `VITE_FIREBASE_CONFIG` at build time is just the default.

**Adding a second device** — the first (already-synced) device shows a permanent six-digit
**sync token** right in Settings → Cloud sync, mapping to that device's `accountKey` in Firestore.
It never expires — generated once per account, reused for every future device. On the second
device, **Have a sync token?**, type the six digits, and it adopts the same `accountKey` and
syncs — pulling in everything from the first device, pushing up anything only it had.
**Regenerate token** replaces it outright if it ever leaks; the old one stops resolving
immediately. The real secret is still the `accountKey`, which is never shown on screen — the
token is just a lookup for it.

**Capped at 3 devices per account** — each device has its own random id (separate from the
accountKey), tracked in `accounts/{accountKey}/data/devices`. Redeeming the token past that cap
is refused outright rather than silently letting a fourth device in.

**Freeing a slot needs a second device's approval** — a device can always unlink *itself*
outright, but removing a *different* one (say, a laptop that got sold) only writes a request to
`accounts/{accountKey}/data/removal`. No device can act on its own request. The next linked
device that isn't the target and isn't the requester sees a pending request when it opens
Settings and gets an approve/deny popup — approving actually removes the target and frees the
slot, denying just clears the request. This stops one device from unilaterally kicking another
off the account.

**Merge model** — last-write-wins per record on `updatedAt`, which `db.put` stamps on every
write. Deletes leave a tombstone in the `deletes` store so they survive a sync instead of being
resurrected by the other device.

Sync is **automatic and has no button**: it runs on launch and a few seconds after any change —
logging a class or clearing a blurt is the trigger.

### Why not Google Calendar or Google Tasks

Both were built and torn back out. Google refuses to show its OAuth sign-in page inside an
embedded WebView (the "This browser or app may not be secure" wall) — which is exactly what a
Capacitor Android app is, so real Google sign-in never worked reliably on the phone build no
matter which flow was tried (popup, redirect, or the native Google Sign-In plugin, which needs a
registered Android app + SHA-1 fingerprint + `google-services.json` in the Firebase project just
to attempt it). Dropping Google sign-in entirely for the anonymous + sync-token model sidesteps
the problem outright — there is no WebView to get blocked in, because there is no OAuth page.
The one real cost: no more auto-push to a Google Calendar or a Google Tasks list, since both
require a genuine Google OAuth grant that a six-digit sync token structurally cannot provide.
The local Android calendar above ended up being the better replacement anyway — no account
needed, and it stays out of your real calendar by construction rather than by discipline.

## Backup

Plan → Backup exports the whole database as JSON and imports it back. On the phone the file goes
to Documents and opens the share sheet. That is also how you move data between the PC app and the
phone app — there is no sync.

## Phases

1. **DONE** — data model (subject → chapter → topic), class logging, inline topic creation,
   last-topic flag, chapter-finished flag, day log, IndexedDB, hash routing, dark UI.
2. **DONE** — the scheduler: 1-4-7 generation, Today queue with overdue/due/cleared, tick done,
   skip, push to tomorrow, day rollover handling.
3. **DONE** — stage transitions: topic → weekly, chapter → fortnightly, weekly retirement,
   reversal when *finished* is un-ticked, gate status shown on the chapter page.
4. **DONE** — blurt session screen: write it out, reveal the class notes to check against,
   1-5 self score, per-topic history.
5. **DONE** — Plan tab: upcoming grouped by day, search across topics, JSON backup export/import.
6. **DONE** — packaging: Windows `.exe` (Electron + electron-builder), Android `.apk`
   (Capacitor), local notifications on both.
7. **DONE** — calendar export (see above).
8. **DONE** — Android home screen widget.
9. **DONE** — first-run walkthrough (7 steps, replayable) and a full **How 147 works** page
   behind the **?** in the top bar. Every input placeholder was removed; the hints live in the
   field labels instead.
10. **DONE** — Firebase cloud sync (Auth + Firestore, last-write-wins with tombstones) and
    push into a dedicated **147 Calendar** in Google Calendar.
11. **DONE** — **Settings** page behind the gear (themes, cloud, calendar, reminders, backup),
    four themes, fully automatic sync and calendar reconciliation with no manual buttons.
12. **DONE** — the blurt unit became the **class**, not the topic; Today shows only today and
    refuses future blurts; no typing in the app, just a 1-5 rating per topic; the **Weak spots**
    tab replaced the upcoming list.
13. **DONE** — per-chapter revision method (Blurt vs Questions).
14. Built, then removed — a live **147 Calendar** push and later a **147 Tasks** push, both via
    Google OAuth. Both worked from a desktop browser but Google blocks its sign-in page inside a
    Capacitor Android WebView, so neither was reliable on the phone build.
15. **DONE** — cloud sync rebuilt around anonymous Firebase auth + a random `accountKey` per
    account, paired across devices with a six-digit code instead of any Google sign-in. Fixes the
    phone sign-in failure at the root, since there is no OAuth page left to block.
16. **DONE** — a local, account-free **147 calendar** on Android via `CalendarContract`, kept
    deliberately separate from the user's real calendar. Home screen widget resized to a sane
    default footprint (was defaulting to roughly 3×2 cells).
17. **DONE** — self-update for the sideloaded APK: checks GitHub Releases, downloads and launches
    the installer for a newer build. Manual, two button presses, no background polling.
18. **DONE** — desktop self-update (silent install + relaunch), a Restart now/Later banner on both
    platforms that checks in the background, parallelized sync (reads/writes batched instead of
    sequential), pull-to-refresh, a live sync-status dot, and a chip-style topic adder with inline
    rename/delete on the Log class page.
19. **DONE** — the 10-minute pairing code became a permanent, regenerable **sync token**, capped
    at 3 devices per account. Removing a device other than the one you're on doesn't act
    unilaterally — it files a request that a *different* linked device has to approve via a popup
    before the slot actually frees up.

## Layout

| File                    | Job                                                            |
| ----------------------- | -------------------------------------------------------------- |
| `src/types.ts`          | data shapes (Subject, Chapter, Topic, ClassLog, Blurt, DayLog)  |
| `src/db.ts`             | IndexedDB stores + load/put/delete/clear                        |
| `src/state.ts`          | in-memory store, all mutations, write-through to IndexedDB      |
| `src/schedule.ts`       | **the 1-4-7 / weekly / fortnightly engine** — `syncSchedule()`  |
| `src/notify.ts`         | reminders (web + Android) and the widget payload bridge         |
| `src/backup.ts`         | JSON export/import, native file saving                          |
| `src/cloud.ts`          | Firebase config, anonymous auth, permanent sync token + device cap, last-write-wins merge |
| `src/syscal.ts`         | bridges to the native local Android calendar                    |
| `src/update.ts`         | GitHub Releases version check + install trigger (Android + desktop) |
| `src/updateBanner.ts`   | background update check + Restart now/Later banner              |
| `src/pulltorefresh.ts`  | pull-to-refresh gesture, forces an immediate sync                |
| `src/util.ts`           | local-time date maths, `R147_OFFSETS`, ids, escaping            |
| `src/router.ts`         | hash routing (`#/blurt/b_1`, `#/log?chapter=c_1`)               |
| `src/ui.ts`             | toast, modal prompt, confirm, click delegation                  |
| `src/views/*.ts`        | today, log, plan, blurt, subjects, subject, chapter, parts      |
| `src/theme.ts`          | the four themes and how they are applied                          |
| `src/tour.ts`           | first-run walkthrough overlay                                    |
| `src/main.ts`           | shell, tabs, render loop, day rollover, background update watch |
| `electron/main.cjs`     | desktop window + IPC handlers for self-update                   |
| `electron/preload.cjs`  | exposes `window.desktopUpdater` to the renderer                 |
| `scripts/apk.mjs`       | SDK/JDK detection + gradle build + APK copy                     |
| `scripts/exe.mjs`       | Electron unpack workaround + electron-builder                    |
| `android/.../BlurtWidget.java` | home screen widget provider                             |
| `android/.../WidgetPlugin.java` | lets the web app refresh the widget                    |
| `android/.../CalendarPlugin.java` | the local "147" calendar                              |
| `android/.../UpdaterPlugin.java` | downloads + launches the installer for a new APK       |

`syncSchedule()` is idempotent — ladder blurts have deterministic ids (`b_<topicId>_r1`), so it
runs after every mutation, on boot, on tab focus and at midnight without ever duplicating work.

Dates are always local `yyyy-mm-dd` (`util.toISO`) — a class logged at 11pm must not slide into
tomorrow via UTC.
