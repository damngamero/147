import { rerender } from '../app';
import { buildBackup, restoreBackup, saveFile, stamp } from '../backup';
import {
  cloudState,
  clearConfig,
  getSyncToken,
  readConfig,
  redeemSyncToken,
  regenerateSyncToken,
  saveConfig,
  startSync,
  sync,
  unlink,
  usingBuiltInConfig,
} from '../cloud';
import { enableNotifications, notificationState } from '../notify';
import { store } from '../state';
import {
  pushSyscal,
  setSyscalEnabled,
  syscalEnabled,
  syscalHasPermission,
  syscalRequestPermission,
  syscalStatus,
  syscalSupported,
} from '../syscal';
import { THEMES, currentTheme, setTheme } from '../theme';
import { startTour } from '../tour';
import {
  APP_VERSION,
  canInstallUpdates,
  checkForUpdate,
  installUpdate,
  requestInstallPermission,
  updateSupported,
  type UpdateInfo,
} from '../update';
import { askText, confirmBox, onAct, toast } from '../ui';
import { esc } from '../util';

/** The account's permanent sync token, lazily loaded once per Settings visit. */
let syncToken: string | null = null;
let syncTokenLoading = false;

/** null = not checked yet. Checked once per Settings visit, native side only. */
let syscalPermission: boolean | null = null;

/** Update check/install state — none of it persists across a reload, deliberately. */
let updateState: 'idle' | 'checking' | 'none' | 'available' | 'installing' = 'idle';
let updateInfo: UpdateInfo | null = null;
let updateError: string | null = null;

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/* ---------- appearance ---------- */

function themeCards(): string {
  const active = currentTheme();
  return `
    <div class="themes">
      ${THEMES.map(
        (t) => `
        <button class="theme-card ${t.id === active ? 'on' : ''}" data-act="theme" data-id="${t.id}">
          <div class="name">${esc(t.name)}${t.id === active ? ' &check;' : ''}</div>
          <div class="swatches">
            ${t.swatch.map((c) => `<span class="swatch" style="background:${c}"></span>`).join('')}
          </div>
          <div class="sub dim small" style="margin-top:8px">${esc(t.note)}</div>
        </button>`,
      ).join('')}
    </div>`;
}

/* ---------- cloud ---------- */

function cloudCard(): string {
  const c = cloudState();

  if (!c.configured) {
    return `
      <div class="card">
        <p class="muted small">
          Sync every subject, class and blurt between your devices through your own Firebase
          project. No Google sign-in — just a code. Nothing leaves the device until you set this
          up.
        </p>
        <div class="actions">
          <button class="btn primary" data-act="cloud-config">Paste Firebase config</button>
          <a class="btn ghost" href="#/help">Full steps</a>
        </div>
      </div>`;
  }

  if (!c.linked) {
    const project = readConfig()?.projectId ?? '';
    return `
      <div class="card">
        <p class="muted small">
          Connected to <b>${esc(project)}</b>${usingBuiltInConfig() ? ' (built into this app)' : ''}.
        </p>
        <div class="actions">
          <button class="btn primary" data-act="cloud-start">Turn on sync</button>
          <button class="btn" data-act="cloud-redeem">Have a sync token?</button>
        </div>
        <p class="muted small" style="margin-top:10px">
          <b>Turn on sync</b> if this is the first device — everything here becomes the seed.
          <b>Have a sync token?</b> if another device already has one to give you.
        </p>
        <div class="actions" style="margin-top:12px">
          <button class="btn ghost danger" data-act="cloud-forget">Disconnect Firebase</button>
        </div>
        ${c.error ? `<p class="small" style="color:var(--bad);margin-top:10px">${esc(c.error)}</p>` : ''}
      </div>`;
  }

  return `
    <div class="card">
      <div class="setting-row" style="padding-top:0">
        <span class="grow">
          <div class="title">Synced</div>
          <div class="sub">Syncs on launch and a few seconds after any change. Last sync ${ago(c.lastSync)}.</div>
        </span>
        <span class="pill ${c.syncing ? 'warn' : 'good'}">${c.syncing ? 'syncing' : 'on'}</span>
      </div>

      <div class="actions" style="margin-top:12px">
        <span class="spacer"></span>
        <button class="btn ghost danger" data-act="cloud-unlink">Unlink this device</button>
      </div>

      <div class="pairing-code">
        <div class="pairing-digits">${syncToken ? esc(syncToken) : syncTokenLoading ? '······' : '——————'}</div>
        <div class="dim small">
          Your permanent sync token. Enter it on any other device under Settings → Cloud sync →
          Have a sync token? — it never expires, so there's no rush and no regenerating it each
          time.
        </div>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn ghost danger sm" data-act="regen-token" ${syncToken ? '' : 'disabled'}>Regenerate token</button>
      </div>

      ${c.error ? `<p class="small" style="color:var(--bad);margin-top:10px">${esc(c.error)}</p>` : ''}
    </div>`;
}

/* ---------- 147 calendar (Android, local, separate) ---------- */

function syscalCard(): string {
  const on = syscalEnabled();
  const st = syscalStatus();
  const granted = syscalPermission === true;

  return `
    <div class="card">
      <div class="setting-row" style="padding-top:0">
        <span class="grow">
          <div class="title">Keep a separate "147" calendar</div>
          <div class="sub">
            A local calendar on this phone, not tied to your Google or Samsung account. It shows
            up as its own row in Samsung Calendar's calendar list — hide it with one tap without
            touching your real classes and events. No account, no internet.
          </div>
        </span>
        <button class="btn ${on ? 'primary' : ''}" data-act="syscal-toggle">${on ? 'On' : 'Off'}</button>
      </div>

      ${
        on
          ? `
        <div class="setting-row">
          <span class="grow">
            <div class="title">Status</div>
            <div class="sub">
              ${
                st.pushing
                  ? 'Writing now…'
                  : !granted
                    ? 'Waiting on calendar permission.'
                    : `Last write ${ago(st.lastPush)}`
              }
            </div>
          </span>
          ${
            granted
              ? '<button class="btn ghost" data-act="syscal-push">Write now</button>'
              : '<button class="btn primary" data-act="syscal-grant">Grant calendar access</button>'
          }
        </div>`
          : ''
      }

      ${
        st.error
          ? `<p class="small" style="color:var(--warn);margin-top:10px">${esc(st.error)}</p>`
          : ''
      }
    </div>`;
}

/* ---------- updates ---------- */

function updateCard(): string {
  const busy = updateState === 'checking' || updateState === 'installing';

  return `
    <div class="card">
      <div class="setting-row" style="padding-top:0">
        <span class="grow">
          <div class="title">147 version ${esc(APP_VERSION)}</div>
          <div class="sub">
            There is no app store here, so 147 checks GitHub directly, on launch and every few
            hours in the background. If it finds something you get a Restart now / Later banner —
            this card is only for checking by hand.
          </div>
        </span>
      </div>

      <div class="actions" style="margin-top:12px">
        ${
          updateState === 'available' && updateInfo
            ? `<button class="btn primary" data-act="update-install" ${busy ? 'disabled' : ''}>
                 ${busy ? 'Installing…' : `Install ${esc(updateInfo.version)}`}
               </button>`
            : `<button class="btn ${updateState === 'idle' ? 'primary' : ''}" data-act="update-check" ${busy ? 'disabled' : ''}>
                 ${busy ? 'Checking…' : 'Check for updates'}
               </button>`
        }
      </div>

      ${
        updateState === 'available' && updateInfo?.notes
          ? `<div class="reveal" style="margin-top:12px">${esc(updateInfo.notes).slice(0, 600)}</div>`
          : ''
      }

      ${updateState === 'none' ? '<p class="muted small" style="margin-top:10px">Already up to date.</p>' : ''}

      ${
        updateError
          ? `<p class="small" style="color:var(--warn);margin-top:10px">${esc(updateError)}</p>`
          : ''
      }
    </div>`;
}

/* ---------- page ---------- */

export function render(): string {
  return `
    <a class="back-link" href="#" data-act="back">&lsaquo; Back</a>
    <h1>Settings</h1>

    <h2>Appearance</h2>
    ${themeCards()}

    <h2>Cloud sync</h2>
    ${cloudCard()}

    ${
      syscalSupported()
        ? `<h2>147 calendar</h2>
           ${syscalCard()}`
        : ''
    }

    <h2>Reminders</h2>
    <div class="card">
      <div class="setting-row" style="padding:0">
        <span class="grow">
          <div class="title">Daily nudge</div>
          <div class="sub">
            Real scheduled notifications at 5pm on the phone build; in the browser and desktop app
            you get one while 147 is open.
          </div>
        </span>
        ${
          notificationState() === 'on'
            ? '<span class="pill good">on</span>'
            : notificationState() === 'off'
              ? '<button class="btn primary" data-act="notify">Turn on</button>'
              : '<span class="pill">n/a here</span>'
        }
      </div>
    </div>

    <h2>Backup</h2>
    <div class="card">
      <p class="muted small">
        A full copy of the database as one file. Worth doing before a reinstall even with sync on.
      </p>
      <div class="actions">
        <button class="btn" data-act="export">Export JSON</button>
        <button class="btn" data-act="import">Import JSON</button>
        <input type="file" accept="application/json,.json" data-f="file" style="display:none" />
      </div>
      <div class="chips">
        <span class="pill">${store.subjects.length} subjects</span>
        <span class="pill">${store.topics.length} topics</span>
        <span class="pill">${store.logs.length} classes</span>
        <span class="pill">${store.blurts.length} blurts</span>
      </div>
    </div>

    <h2>Help</h2>
    <div class="card">
      <div class="actions">
        <a class="btn" href="#/help">How 147 works</a>
        <button class="btn ghost" data-act="tour">Replay the walkthrough</button>
      </div>
    </div>

    ${
      updateSupported()
        ? `<h2>Updates</h2>
           ${updateCard()}`
        : ''
    }`;
}

export function wire(root: HTMLElement): void {
  if (syscalSupported() && syscalPermission === null) {
    void syscalHasPermission().then((granted) => {
      syscalPermission = granted;
      rerender();
    });
  }

  if (cloudState().linked && !syncToken && !syncTokenLoading) {
    syncTokenLoading = true;
    void getSyncToken().then((res) => {
      syncTokenLoading = false;
      if (res.ok) syncToken = res.code;
      rerender();
    });
  }

  const file = root.querySelector<HTMLInputElement>('[data-f="file"]');
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const yes = await confirmBox({
      title: 'Replace everything?',
      body: 'Importing wipes the data on this device and puts the backup in its place.',
      okLabel: 'Import',
      danger: true,
    });
    if (!yes) {
      file.value = '';
      return;
    }
    const res = await restoreBackup(await f.text());
    toast(res.message);
    file.value = '';
  });

  onAct(root, async (act, el, ev) => {
    if (act === 'back') {
      ev.preventDefault();
      if (history.length > 1) history.back();
      else location.hash = '#/today';
      return;
    }

    if (act === 'theme') {
      setTheme(el.dataset.id!);
      rerender();
    }

    if (act === 'cloud-config') {
      const text = await askText({
        title: 'Firebase config',
        label: 'Paste the whole firebaseConfig block',
        body: 'Firebase console → Project settings → Your apps → Web app → Config.',
        okLabel: 'Connect',
        multiline: true,
      });
      if (!text) return;
      const res = saveConfig(text);
      toast(res.message);
      if (res.ok) location.reload();
    }

    if (act === 'cloud-forget') {
      const yes = await confirmBox({
        title: 'Disconnect Firebase?',
        body: 'Local data stays put. Nothing more gets pushed or pulled.',
        okLabel: 'Disconnect',
        danger: true,
      });
      if (yes) {
        clearConfig();
        syncToken = null;
        rerender();
      }
    }

    if (act === 'cloud-start') {
      const res = await startSync();
      toast(res.message);
      rerender();
    }

    if (act === 'cloud-redeem') {
      const code = await askText({
        title: 'Enter the sync token',
        label: 'The 6-digit token shown on your other device',
        okLabel: 'Link',
      });
      if (!code) return;
      const res = await redeemSyncToken(code);
      toast(res.message);
      rerender();
    }

    if (act === 'regen-token') {
      const yes = await confirmBox({
        title: 'Regenerate your sync token?',
        body: 'Are you sure? The old token stops working the moment you do this — any device that hasn’t linked with it yet will need the new one instead.',
        okLabel: 'Regenerate',
        danger: true,
      });
      if (!yes) return;
      const res = await regenerateSyncToken();
      if (res.ok) {
        syncToken = res.code;
        toast('Token regenerated');
      } else {
        toast(res.message);
      }
      rerender();
    }

    if (act === 'cloud-unlink') {
      const yes = await confirmBox({
        title: 'Unlink this device?',
        body: 'Local data stays put. This device stops syncing until you turn it on again or redeem your sync token.',
        okLabel: 'Unlink',
        danger: true,
      });
      if (yes) {
        unlink();
        syncToken = null;
        rerender();
      }
    }

    if (act === 'syscal-toggle') {
      setSyscalEnabled(!syscalEnabled());
      rerender();
    }

    if (act === 'syscal-grant') {
      const granted = await syscalRequestPermission();
      syscalPermission = granted;
      if (granted) {
        toast('Calendar access granted');
        const res = await pushSyscal();
        toast(res.message);
      } else {
        toast('Permission refused');
      }
      rerender();
    }

    if (act === 'syscal-push') {
      toast('Writing to the 147 calendar…');
      const res = await pushSyscal();
      toast(res.message);
      rerender();
    }

    if (act === 'update-check') {
      updateState = 'checking';
      updateError = null;
      rerender();
      const res = await checkForUpdate();
      if (!res.ok) {
        updateState = 'idle';
        updateError = res.message;
      } else if (res.update) {
        updateState = 'available';
        updateInfo = res.update;
      } else {
        updateState = 'none';
        updateInfo = null;
      }
      rerender();
    }

    if (act === 'update-install' && updateInfo) {
      const backupFirst = await confirmBox({
        title: 'Back up before updating?',
        body: 'Updating never touches your data, but exporting a backup first is one tap of insurance.',
        okLabel: 'Back up, then update',
      });
      if (backupFirst) {
        await saveFile(
          `147-backup-${stamp()}.json`,
          'application/json',
          JSON.stringify(buildBackup(), null, 2),
        );
        toast('Backup saved');
      }

      if (cloudState().linked) await sync().catch(() => undefined);

      const allowed = await canInstallUpdates();
      if (!allowed) {
        const grant = await confirmBox({
          title: 'Allow installs from 147?',
          body: 'Android needs this app switched on as an install source once. You will be sent to a system settings screen — flip the toggle, then come back.',
          okLabel: 'Continue',
        });
        if (!grant) return;
        const got = await requestInstallPermission();
        if (!got) {
          updateError = 'Permission was not granted.';
          rerender();
          return;
        }
      }

      updateState = 'installing';
      updateError = null;
      rerender();
      const res = await installUpdate(updateInfo);
      if (!res.ok) {
        updateState = 'available';
        updateError = res.message;
      } else {
        toast(res.message);
        updateState = 'idle';
        updateInfo = null;
      }
      rerender();
    }

    if (act === 'notify') {
      const ok = await enableNotifications();
      toast(ok ? 'Reminders on' : 'Permission refused');
      rerender();
    }

    if (act === 'export') {
      await saveFile(
        `147-backup-${stamp()}.json`,
        'application/json',
        JSON.stringify(buildBackup(), null, 2),
      );
      toast('Backup saved');
    }

    if (act === 'import') root.querySelector<HTMLInputElement>('[data-f="file"]')?.click();

    if (act === 'tour') startTour();
  });
}
