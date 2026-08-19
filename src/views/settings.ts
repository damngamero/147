import { rerender } from '../app';
import { buildBackup, restoreBackup, saveFile, stamp } from '../backup';
import {
  cloudState,
  clearConfig,
  createPairingCode,
  readConfig,
  redeemPairingCode,
  saveConfig,
  startSync,
  unlink,
  usingBuiltInConfig,
  type PairingCode,
} from '../cloud';
import { enableNotifications, notificationState } from '../notify';
import { store } from '../state';
import { THEMES, currentTheme, setTheme } from '../theme';
import { startTour } from '../tour';
import { askText, confirmBox, onAct, toast } from '../ui';
import { esc } from '../util';

/** The most recently generated pairing code, shown until replaced or navigated away from. */
let pairing: PairingCode | null = null;

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function inMinutes(ts: number): string {
  const mins = Math.round((ts - Date.now()) / 60000);
  return mins <= 0 ? 'expired' : `${mins}m`;
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
          <button class="btn" data-act="cloud-redeem">Have a pairing code?</button>
        </div>
        <p class="muted small" style="margin-top:10px">
          <b>Turn on sync</b> if this is the first device — everything here becomes the seed.
          <b>Have a pairing code?</b> if another device already generated one for you.
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
        <button class="btn primary" data-act="cloud-pair">Get a pairing code</button>
        <span class="spacer"></span>
        <button class="btn ghost danger" data-act="cloud-unlink">Unlink this device</button>
      </div>

      ${
        pairing
          ? `<div class="pairing-code">
              <div class="pairing-digits">${esc(pairing.code)}</div>
              <div class="dim small">
                Enter this on the other device, under Settings → Cloud sync → Have a pairing
                code? Expires in ${inMinutes(pairing.expiresAt)}.
              </div>
            </div>`
          : ''
      }

      ${c.error ? `<p class="small" style="color:var(--bad);margin-top:10px">${esc(c.error)}</p>` : ''}
    </div>`;
}

/* ---------- page ---------- */

export function render(): string {
  return `
    <h1>Settings</h1>

    <h2>Appearance</h2>
    ${themeCards()}

    <h2>Cloud sync</h2>
    ${cloudCard()}

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
    </div>`;
}

export function wire(root: HTMLElement): void {
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

  onAct(root, async (act, el) => {
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
        pairing = null;
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
        title: 'Enter the pairing code',
        label: 'The 6-digit code shown on your other device',
        okLabel: 'Link',
      });
      if (!code) return;
      const res = await redeemPairingCode(code);
      toast(res.message);
      rerender();
    }

    if (act === 'cloud-pair') {
      const res = await createPairingCode();
      if (res.ok) {
        pairing = res.pairing;
      } else {
        toast(res.message);
      }
      rerender();
    }

    if (act === 'cloud-unlink') {
      const yes = await confirmBox({
        title: 'Unlink this device?',
        body: 'Local data stays put. This device stops syncing until you turn it on again or redeem a fresh pairing code.',
        okLabel: 'Unlink',
        danger: true,
      });
      if (yes) {
        unlink();
        pairing = null;
        rerender();
      }
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
