import { startTour } from '../tour';
import { onAct } from '../ui';
import { addDays, fmtDate, todayISO } from '../util';

export function render(): string {
  // A worked example off today's date, so the ladder is never abstract.
  const c = todayISO();
  const example = `
    <table class="guide">
      <tr><th>Blurt</th><th>Gap</th><th>Lands on</th></tr>
      <tr><td>class</td><td>—</td><td>${fmtDate(c)}</td></tr>
      <tr><td>blurt 1</td><td>+1</td><td>${fmtDate(addDays(c, 1))}</td></tr>
      <tr><td>blurt 2</td><td>+4</td><td>${fmtDate(addDays(c, 5))}</td></tr>
      <tr><td>blurt 3</td><td>+7</td><td>${fmtDate(addDays(c, 12))}</td></tr>
      <tr><td>then</td><td>weekly</td><td>${fmtDate(addDays(c, 19))}, and on</td></tr>
    </table>`;

  return `
    <a class="back-link" href="#" data-act="back">&lsaquo; Back</a>
    <h1>How 147 works</h1>

    <div class="card">
      <div class="actions">
        <button class="btn primary" data-act="tour">Replay the walkthrough</button>
      </div>
    </div>

    <h2>The loop</h2>
    <div class="card guide-body">
      <p><b>1 — Log the class.</b> Date, subject, chapter, the topics covered, and what you
      actually did. Topics you type in are created on the spot, and the class date is what the
      whole schedule counts from.</p>
      <p><b>2 — Blurt when told.</b> <b>Today</b> tells you which class is up. Write it out
      <b>on paper</b> — every topic from that class, in one go, from memory. Then hit
      <b>Rate it</b>, check against the class notes, and score each topic 1-5.</p>
      <p><b>3 — Do nothing else.</b> Clearing a blurt schedules the next one automatically.</p>
    </div>

    <h2>The 1-4-7 ladder</h2>
    <div class="card guide-body">
      <p>Three blurts per <b>class</b> — not per topic — counted from the day it happened:
      <b>+1 day</b>, then <b>+4 more</b>, then <b>+7 more</b>. Everything taught in that class
      comes up together on the same day. If you logged a class today:</p>
      ${example}
      <p class="muted small">Missing a day never breaks the chain. An overdue blurt stays at the
      top of Today until you clear it, and skipping one counts as resolved so the ladder keeps
      moving.</p>
    </div>

    <h2>After the ladder — weekly</h2>
    <div class="card guide-body">
      <p>A class that has been through all three blurts drops to <b>one blurt a week</b>,
      counted from the day you actually did the last one rather than the day it was due. Do a
      blurt four days late and the next one shifts with you.</p>
    </div>

    <h2>Finished chapters — fortnightly</h2>
    <div class="card guide-body">
      <p>Two things have to be true:</p>
      <p>• the chapter is marked <b>finished</b>, and<br />
         • the class that taught the topic you flagged as <b>last topic</b> has cleared its
         1-4-7.</p>
      <p>When both land, the chapter itself goes onto a <b>fortnightly</b> blurt — the whole
      chapter at once — and every per-class weekly blurt in it stops. One blurt replaces many.</p>
      <p>If you never flag a last topic, the fallback is every class in the chapter having
      cleared its ladder. Untick <b>finished</b> at any point and the weekly topic blurts come
      straight back.</p>
      <p class="muted small">A class still mid-ladder inside a finished chapter keeps its
      remaining 1-4-7 blurts — it just never gets a weekly one, it joins the chapter blurt
      instead.</p>
    </div>

    <h2>The tabs</h2>
    <div class="card guide-body">
      <p><b>Today</b> — what is due <em>today</em>, and nothing else. There is deliberately no
      list of what is coming, and a blurt that is not due yet cannot be opened: blurting early
      throws away the gap that makes spacing work.</p>
      <p><b>Log class</b> — the entry form, and the full history of every class you have logged.
      Tap any past class to edit it; changing its date moves that topic's blurts with it.</p>
      <p><b>Weak spots</b> — every topic you have rated, worst first, with its average and how
      many times you have been over it. Built entirely from the 1-5 scores.</p>
      <p><b>Settings</b> (the gear, top right) — themes, cloud sync, reminders and backups.</p>
      <p><b>Subjects</b> — the tree. Subject → chapter → topic, where you flag the last topic
      and mark a chapter finished.</p>
    </div>


    <h2>You blurt on paper, not in here</h2>
    <div class="card guide-body">
      <p>147 never asks you to type a blurt out. Writing it by hand is the exercise; retyping it
      into a box is just admin.</p>
      <p>All it wants back is <b>how each topic went, 1 to 5</b> — 1 is blank, 5 is nailed it.
      Those scores build the <b>Weak spots</b> list, so a topic you keep scoring 2 on rises to
      the top and stays there until it stops being a 2.</p>
      <p>Every topic in the class has to be rated before Done unlocks — a half-rated round tells
      you nothing later.</p>
    </div>

    <h2>Cloud sync setup — no Google sign-in</h2>
    <div class="card guide-body">
      <p>Sync runs on <b>your own</b> Firebase project, so the data stays in an account you
      control. It is free at this scale, and there is no Google account involved anywhere — every
      device signs in <b>anonymously</b> (invisible, no consent screen), and a random code is
      what actually links your devices together. One-time setup:</p>
      <p>
        1. Go to <b>console.firebase.google.com</b> and create a project.<br />
        2. Add a <b>Web app</b> (the <b>&lt;/&gt;</b> icon). Copy the <b>firebaseConfig</b> block.<br />
        3. <b>Build → Authentication → Sign-in method → Anonymous → Enable.</b><br />
        4. <b>Build → Firestore Database → Create database</b>. Production mode is fine.<br />
        5. Firestore <b>Rules</b> tab, paste this and publish:
      </p>
      <pre class="code">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /accounts/{accountKey}/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /pairs/{code} {
      allow read, write: if request.auth != null;
    }
  }
}</pre>
      <p>6. Back in 147: <b>Settings → Cloud sync → Paste Firebase config</b>, then
      <b>Turn on sync</b>.</p>
      <p class="muted small">Those rules mean any device that has signed in (anonymously — no
      account needed) can read or write, as long as it knows the right <code>accountKey</code>.
      That key is a long random string generated on your first device and never shown on
      screen — the six-digit codes you actually see are short-lived, single-use pointers to it.</p>
    </div>

    <h2>Adding a second device</h2>
    <div class="card guide-body">
      <p>On the device that is already synced: <b>Settings → Cloud sync → Get a pairing code</b>.
      That shows a six-digit code, valid for ten minutes.</p>
      <p>On the new device: <b>Settings → Cloud sync → Have a pairing code?</b>, type the six
      digits in. It adopts the same account and syncs immediately — pulling in everything from
      the first device, pushing up anything only the new device had.</p>
      <p class="muted small">The code itself is worthless once redeemed or expired. If you miss
      the window, just generate a fresh one.</p>
    </div>

    <h2>How sync resolves clashes</h2>
    <div class="card guide-body">
      <p>Every record carries the time it was last changed. When two devices disagree, the more
      recent edit wins — per record, not per device, so editing a class on the laptop and
      clearing a blurt on the phone both survive.</p>
      <p>Deletes leave a marker behind, so something you deleted on one device does not come back
      the next time the other one syncs.</p>
      <p>Sync runs on launch and a few seconds after any change. There is no manual sync button
      because there is nothing to press — logging a class or clearing a blurt is what triggers
      it. Reads and writes fire in parallel batches rather than one at a time, so a full sync is
      usually a couple of seconds, not longer.</p>
    </div>

    <h2>The 147 calendar — kept separate from your real one</h2>
    <div class="card guide-body">
      <p>On Android, <b>Settings → 147 calendar</b> keeps a dedicated calendar on the phone in
      step with the schedule — one all-day event per open blurt. It is a <b>local</b> calendar,
      not linked to your Google or Samsung account, which is what keeps it out of the way: it
      shows up as its own row in Samsung Calendar's calendar list, and you can hide the whole
      thing with one tap without touching your actual classes and events.</p>
      <p>No account, no internet, no OAuth — it only needs the Android calendar permission, the
      normal kind of permission prompt, not a sign-in page. Every write is a full replace (clear
      the 147 calendar, write the current schedule fresh), so it is always exactly right and
      there is nothing to reconcile by hand.</p>
      <p class="muted small">Web and desktop have no calendar app to write to, so this card only
      appears on the Android build.</p>
    </div>

    <h2>Getting it off this screen</h2>
    <div class="card guide-body">
      <p><b>Reminders</b> — Settings → Reminders. On the phone build these are real notifications
      at 5pm on every day something is due.</p>
      <p><b>Home screen widget</b> — on Android, long-press the home screen → Widgets → 147. It
      shows the due count and the next few topics; tapping it opens the app.</p>
      <p><b>Backup</b> — Settings → Export JSON. Worth doing before a reinstall even with cloud sync
      switched on.</p>
      <p><b>Updates</b> — checked automatically on launch and every few hours in the background;
      a <b>Restart now / Later</b> banner shows up when one is found. The desktop build restarts
      itself silently; the Android build hands off to the system installer.</p>
    </div>`;
}

export function wire(root: HTMLElement): void {
  onAct(root, (act, _el, ev) => {
    if (act === 'tour') startTour();
    if (act === 'back') {
      ev.preventDefault();
      if (history.length > 1) history.back();
      else location.hash = '#/today';
    }
  });
}
