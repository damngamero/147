/**
 * A slim bottom banner offering "Restart now" / "Later" once a background
 * check finds a newer build. Kept separate from the manual Settings → Updates
 * card, which stays for someone who wants to check on demand.
 */
import { cloudState, sync } from './cloud';
import {
  canInstallUpdates,
  checkForUpdate,
  installUpdate,
  requestInstallPermission,
  updateSupported,
  type UpdateInfo,
} from './update';
import { toast } from './ui';

let dismissedThisLaunch = false;
let banner: HTMLElement | null = null;
let checking = false;

function draw(info: UpdateInfo): void {
  banner?.remove();
  banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span class="grow small">147 ${info.version} is ready to install.</span>
    <button class="btn ghost sm" data-x="later">Later</button>
    <button class="btn primary sm" data-x="now">Restart now</button>`;
  document.body.appendChild(banner);

  banner.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-x]');
    if (!t) return;
    if (t.dataset.x === 'later') {
      dismissedThisLaunch = true;
      banner?.remove();
      banner = null;
    }
    if (t.dataset.x === 'now') void restartNow(info);
  });
}

/** Flushes any pending cloud sync first, so restarting never loses or races a write. */
async function restartNow(info: UpdateInfo): Promise<void> {
  const btn = banner?.querySelector<HTMLButtonElement>('[data-x="now"]');
  const setBusy = (label: string) => {
    if (btn) {
      btn.disabled = true;
      btn.textContent = label;
    }
  };

  try {
    setBusy('Syncing…');
    if (cloudState().linked) await sync().catch(() => undefined);

    setBusy('Updating…');
    if (!(await canInstallUpdates())) {
      const got = await requestInstallPermission();
      if (!got) {
        toast('Permission needed to install — try again from Settings → Updates.');
        setBusy('Restart now');
        if (btn) btn.disabled = false;
        return;
      }
    }

    const res = await installUpdate(info);
    if (!res.ok) {
      toast(res.message);
      setBusy('Restart now');
      if (btn) btn.disabled = false;
      return;
    }
    // Desktop quits and relaunches itself; Android hands off to the system
    // installer — either way there is nothing left for the banner to show.
    banner?.remove();
    banner = null;
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
    setBusy('Restart now');
    if (btn) btn.disabled = false;
  }
}

/** Silent unless something is actually available — safe to call often. */
export function checkAndPrompt(): void {
  if (!updateSupported() || dismissedThisLaunch || checking || banner) return;
  checking = true;
  void checkForUpdate()
    .then((res) => {
      if (res.ok && res.update) draw(res.update);
    })
    .finally(() => {
      checking = false;
    });
}
