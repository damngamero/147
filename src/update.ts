/**
 * Self-update for the sideloaded APK. There is no Play Store here, so this is
 * the only way a phone that already has 147 installed finds out a newer
 * build exists — GitHub Releases is the public source of truth, checked with
 * a plain unauthenticated fetch (the repo has to be public for this to work
 * at all; a private repo would need a token baked into the APK, which is not
 * something to ship).
 *
 * The check itself is plain JS. Only the two steps that need OS access —
 * writing the downloaded file, and launching the package installer — go
 * through the native Updater147 plugin.
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

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Self-update only makes sense for the sideloaded Android build. */
export function updateSupported(): boolean {
  const c = cap();
  return !!c?.isNativePlatform?.() && c.getPlatform?.() === 'android' && !!c.Plugins?.Updater147;
}

function plugin(): UpdaterPlugin | null {
  return cap()?.Plugins?.Updater147 ?? null;
}

/** "0.2.0" -> [0, 2, 0], comparing numerically part by part. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
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
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) {
      return { ok: false, update: null, message: `GitHub said ${res.status} — no release found yet?` };
    }
    const rel = (await res.json()) as GhRelease;
    const version = rel.tag_name.replace(/^v/i, '');
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

export async function canInstallUpdates(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  return (await p.canInstall()).allowed;
}

/** Sends the user to the per-app "install unknown apps" toggle. */
export async function requestInstallPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  return (await p.requestInstallPermission()).allowed;
}

/** Downloads the release APK and hands it to the system installer. */
export async function installUpdate(update: UpdateInfo): Promise<{ ok: boolean; message: string }> {
  const p = plugin();
  if (!p) return { ok: false, message: 'Not available on this platform.' };
  try {
    await p.downloadAndInstall({ url: update.url });
    return { ok: true, message: 'Installer opened — follow the prompt to finish updating.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
