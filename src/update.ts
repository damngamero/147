/**
 * Self-update. There is no app store for either shipped build, so this is
 * the only way an already-installed copy finds out a newer build exists —
 * GitHub Releases is the public source of truth, checked with a plain
 * unauthenticated fetch (the repo has to be public for this to work at all;
 * a private repo would need a token baked into the build, which is not
 * something to ship).
 *
 * Android and desktop take different paths under the same interface:
 *  - Android: the version check runs here in plain JS; only writing the
 *    downloaded APK and launching the package installer need the native
 *    Updater147 Capacitor plugin.
 *  - Desktop (Electron): both the check and the install happen in the main
 *    process (see electron/main.cjs) over IPC, because installing needs to
 *    spawn a process and relaunch the app — not something a sandboxed
 *    renderer can do. window.desktopUpdater is the bridge, exposed by
 *    electron/preload.cjs.
 */
const REPO = 'damngamero/147';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

export const APP_VERSION = __APP_VERSION__;

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

interface UpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  requestInstallPermission(): Promise<{ allowed: boolean }>;
  downloadAndInstall(opts: { url: string }): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { Updater147?: UpdaterPlugin };
}

interface DesktopUpdater {
  check(): Promise<CheckResult>;
  install(url: string): Promise<{ ok: boolean; message?: string }>;
}

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function desktop(): DesktopUpdater | null {
  return (window as unknown as { desktopUpdater?: DesktopUpdater }).desktopUpdater ?? null;
}

function androidSupported(): boolean {
  const c = cap();
  return !!c?.isNativePlatform?.() && c.getPlatform?.() === 'android' && !!c.Plugins?.Updater147;
}

/** Self-update is wired up for the sideloaded Android build and the desktop exe. */
export function updateSupported(): boolean {
  return androidSupported() || !!desktop();
}

function plugin(): UpdaterPlugin | null {
  return cap()?.Plugins?.Updater147 ?? null;
}

/** "0.2.0" -> [0, 2, 0], comparing numerically part by part. */
function isNewer(latest: string, current: string): boolean {
  // Tolerates a stray dot after the v (e.g. a tag typed as "v.0.3.8") — a typo
  // is an easy way to end up here, and this shouldn't have to be re-tagged to fix.
  const a = latest.replace(/^v\.?/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.replace(/^v\.?/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface GhRelease {
  tag_name: string;
  body?: string;
  assets?: GhAsset[];
}

export interface CheckResult {
  ok: boolean;
  update: UpdateInfo | null;
  message: string;
}

export async function checkForUpdate(): Promise<CheckResult> {
  const d = desktop();
  if (d) return d.check();

  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) {
      return { ok: false, update: null, message: `GitHub said ${res.status} — no release found yet?` };
    }
    const rel = (await res.json()) as GhRelease;
    const version = rel.tag_name.replace(/^v\.?/i, '');
    const apk = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));

    if (!isNewer(version, APP_VERSION)) {
      return { ok: true, update: null, message: `Up to date (${APP_VERSION}).` };
    }
    if (!apk) {
      return { ok: false, update: null, message: `${version} is out but has no .apk attached yet.` };
    }
    return {
      ok: true,
      update: { version, url: apk.browser_download_url, notes: rel.body ?? '' },
      message: `${version} is available.`,
    };
  } catch (err) {
    return { ok: false, update: null, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Desktop never needs OS permission to run its own installer. */
export async function canInstallUpdates(): Promise<boolean> {
  if (desktop()) return true;
  const p = plugin();
  if (!p) return false;
  return (await p.canInstall()).allowed;
}

/** Sends the user to the per-app "install unknown apps" toggle. Android only. */
export async function requestInstallPermission(): Promise<boolean> {
  if (desktop()) return true;
  const p = plugin();
  if (!p) return false;
  return (await p.requestInstallPermission()).allowed;
}

/**
 * Desktop: downloads the installer, runs it silently, and relaunches into
 * the new build automatically. Android: downloads the APK and hands it to
 * the system installer, which needs the user to tap through it.
 */
export async function installUpdate(update: UpdateInfo): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (d) {
    const res = await d.install(update.url);
    return res.ok
      ? { ok: true, message: 'Restarting to finish the update…' }
      : { ok: false, message: res.message ?? 'Install failed.' };
  }

  const p = plugin();
  if (!p) return { ok: false, message: 'Not available on this platform.' };
  try {
    await p.downloadAndInstall({ url: update.url });
    return { ok: true, message: 'Installer opened — follow the prompt to finish updating.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
