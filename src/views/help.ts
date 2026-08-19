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
      <p><b>Settings</b> (the gear, top right) — themes, cloud sync, 147 Tasks, reminders and
      backups.</p>
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

    <h2>Cloud sync setup</h2>
    <div class="card guide-body">
      <p>Sync runs on <b>your own</b> Firebase project, so the data stays in an account you
      control. It is free at this scale. One-time setup:</p>
      <p>
        1. Go to <b>console.firebase.google.com</b> and create a project.<br />
        2. Add a <b>Web app</b> (the <b>&lt;/&gt;</b> icon). Copy the <b>firebaseConfig</b> block.<br />
        3. <b>Build → Authentication → Get started → Google</b>, enable it, save.<br />
        4. <b>Build → Firestore Database → Create database</b>. Production mode is fine.<br />
        5. Firestore <b>Rules</b> tab, paste this and publish:
      </p>
      <pre class="code">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         &amp;&amp; request.auth.uid == uid;
    }
  }
}</pre>
      <p>6. Back in 147: <b>Settings → Cloud sync → Paste Firebase config</b>, then
      <b>Sign in with Google</b>.</p>
      <p class="muted small">Those rules mean only you, signed in, can read or write your own
      documents. Nobody else can touch them, and the config values are safe to paste into the
      app — they identify the project, they do not grant access.</p>
    </div>

    <h2>147 Tasks — semi-automated, no calendar</h2>
    <div class="card guide-body">
      <p>Signing in also asks for tasks permission. Switch <b>Settings → 147 Tasks</b> on and the
      app creates a Google Task the moment something is due, in its own list called
      <b>147 Tasks</b> — tick it off from your phone's task widget, or just leave it to the app.</p>
      <p>It is one-way: 147 is always the source of truth. Clear a blurt in 147 and its task gets
      marked complete on the next push (a few seconds later, not instantly — that is the
      "semi-automated" part, it settles rather than firing on every keystroke). Ticking the task
      complete in Google Tasks itself does <em>not</em> mark it done back here.</p>
      <p>It reconciles rather than appends, so it stays correct as the schedule changes: finish a
      chapter and the weekly per-class tasks get marked complete or removed, replaced by whatever
      the chapter-level schedule produces next. Unlog a class and its task is deleted outright.</p>
      <p>Only what is actually due gets a task — nothing appears for a blurt that is not due yet,
      matching what Today shows.</p>
      <p>For this to work the <b>Google Tasks API</b> has to be enabled in the Google Cloud
      project behind your Firebase project (console.cloud.google.com → APIs &amp; Services →
      Library → Google Tasks API → Enable). Firebase makes that project for you.</p>
      <p class="muted small">The tasks permission expires about an hour after sign-in. If a push
      says the token expired, sign out and back in.</p>
    </div>

    <h2>How sync resolves clashes</h2>
    <div class="card guide-body">
      <p>Every record carries the time it was last changed. When two devices disagree, the more
      recent edit wins — per record, not per device, so editing a class on the laptop and
      clearing a blurt on the phone both survive.</p>
      <p>Deletes leave a marker behind, so something you deleted on one device does not come back
      the next time the other one syncs.</p>
      <p>Sync runs on sign-in, when the app opens, and a few seconds after any change. There is
      no manual sync button because there is nothing to press — logging a class or clearing a
      blurt is what triggers it.</p>
    </div>

    <h2>Getting it off this screen</h2>
    <div class="card guide-body">
      <p><b>Reminders</b> — Settings → Reminders. On the phone build these are real notifications
      at 5pm on every day something is due.</p>
      <p><b>Home screen widget</b> — on Android, long-press the home screen → Widgets → 147. It
      shows the due count and the next few topics; tapping it opens the app.</p>
      <p><b>Backup</b> — Settings → Export JSON. Worth doing before a reinstall even with cloud sync
      switched on.</p>
    </div>`;
}

export function wire(root: HTMLElement): void {
  onAct(root, (act) => {
    if (act === 'tour') startTour();
  });
}
