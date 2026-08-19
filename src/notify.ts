import { openBlurts } from './schedule';
import { labelFor } from './views/parts';
import { addDays, todayISO } from './util';

/** Hour of the day the phone reminder fires. */
const REMIND_HOUR = 17;
const DAYS_AHEAD = 30;

interface NativeNotification {
  id: number;
  title: string;
  body: string;
  schedule: { at: Date; allowWhileIdle: boolean };
}

interface LocalNotificationsPlugin {
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
  schedule(opts: { notifications: NativeNotification[] }): Promise<unknown>;
  getPending(): Promise<{ notifications: Array<{ id: number }> }>;
  cancel(opts: { notifications: Array<{ id: number }> }): Promise<unknown>;
}

interface PreferencesPlugin {
  set(opts: { key: string; value: string }): Promise<void>;
}

interface WidgetPlugin {
  refresh(): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    LocalNotifications?: LocalNotificationsPlugin;
    Preferences?: PreferencesPlugin;
    Widget147?: WidgetPlugin;
  };
}

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

/* ---------- what to say ---------- */

interface DayBucket {
  date: string;
  titles: string[];
}

function buckets(): DayBucket[] {
  const today = todayISO();
  const limit = addDays(today, DAYS_AHEAD);
  const map = new Map<string, string[]>();
  for (const b of openBlurts()) {
    // Anything already overdue rides along with today's reminder.
    const key = b.dueDate < today ? today : b.dueDate;
    if (key > limit) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(labelFor(b).title);
  }
  return [...map.entries()].sort().map(([date, titles]) => ({ date, titles }));
}

function bodyFor(titles: string[]): string {
  const shown = titles.slice(0, 4).join(', ');
  const more = titles.length > 4 ? ` +${titles.length - 4} more` : '';
  return `${shown}${more}`;
}

/* ---------- native (Android) ---------- */

async function refreshNative(plugin: LocalNotificationsPlugin): Promise<void> {
  const perm = await plugin.checkPermissions();
  if (perm.display !== 'granted') return;

  const pending = await plugin.getPending();
  if (pending.notifications.length) await plugin.cancel({ notifications: pending.notifications });

  const now = new Date();
  const notifications: NativeNotification[] = [];
  for (const [i, b] of buckets().entries()) {
    const [y, m, d] = b.date.split('-').map(Number);
    const at = new Date(y, m - 1, d, REMIND_HOUR, 0, 0, 0);
    if (at <= now) continue;
    notifications.push({
      id: i + 1,
      title: `${b.titles.length} blurt${b.titles.length === 1 ? '' : 's'} due`,
      body: bodyFor(b.titles),
      schedule: { at, allowWhileIdle: true },
    });
  }
  if (notifications.length) await plugin.schedule({ notifications });
}

/* ---------- web / Electron ---------- */

function refreshWeb(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = todayISO();
  const key = `147_notified_${today}`;
  if (localStorage.getItem(key)) return;

  const due = openBlurts().filter((b) => b.dueDate <= today);
  if (!due.length) return;

  localStorage.setItem(key, '1');
  new Notification(`${due.length} blurt${due.length === 1 ? '' : 's'} due today`, {
    body: bodyFor(due.map((b) => labelFor(b).title)),
    tag: '147-due',
  });
}

/* ---------- home screen widget bridge ---------- */

/**
 * The Android widget cannot run JS, so the app parks a small JSON payload in
 * SharedPreferences (Capacitor's own store) for the widget provider to read.
 */
async function syncWidget(): Promise<void> {
  const prefs = cap()?.Plugins?.Preferences;
  if (!prefs) return;
  const today = todayISO();
  const due = openBlurts().filter((b) => b.dueDate <= today);
  const payload = {
    updatedAt: Date.now(),
    dueCount: due.length,
    overdue: due.filter((b) => b.dueDate < today).length,
    items: due.slice(0, 6).map((b) => {
      const l = labelFor(b);
      return { id: b.id, title: l.title, sub: l.sub, cycle: b.cycle };
    }),
  };
  await prefs.set({ key: 'widget_payload', value: JSON.stringify(payload) });
  await cap()?.Plugins?.Widget147?.refresh();
}

/* ---------- entry points ---------- */

export async function refreshNotifications(): Promise<void> {
  try {
    const plugin = cap()?.Plugins?.LocalNotifications;
    if (isNative() && plugin) await refreshNative(plugin);
    else refreshWeb();
    await syncWidget();
  } catch {
    // Reminders are a nicety — never let them break the app.
  }
}

export async function enableNotifications(): Promise<boolean> {
  const plugin = cap()?.Plugins?.LocalNotifications;
  if (isNative() && plugin) {
    const res = await plugin.requestPermissions();
    if (res.display !== 'granted') return false;
    await refreshNotifications();
    return true;
  }
  if (typeof Notification === 'undefined') return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  await refreshNotifications();
  return true;
}

export function notificationState(): 'on' | 'off' | 'unsupported' {
  if (isNative()) return 'on';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'granted' ? 'on' : 'off';
}
