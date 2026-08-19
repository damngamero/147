/**
 * Cloud sync over Firebase (Auth + Firestore) — no Google sign-in.
 *
 * Every device authenticates *anonymously*. Firebase requires some signed-in
 * session before Firestore will talk to it, but anonymous auth needs no
 * consent screen and never opens a web page, so there is nothing for Google
 * to block inside a WebView (which is exactly what broke real Google sign-in
 * on Android — Google refuses its OAuth page inside an embedded browser).
 *
 * Data is partitioned by a random `accountKey` generated locally on the first
 * device, not by the Firebase uid (every anonymous session gets its own,
 * unrelated uid — there is no way to make two anonymous sessions share one
 * without a server). To add a second device, the first one mints a six-digit
 * pairing code that maps to its accountKey in Firestore for ten minutes; the
 * second device reads that mapping once and adopts the same accountKey.
 * After that, both devices just sync straight to `accounts/{accountKey}/...`.
 *
 * Merge strategy is last-write-wins per record on `updatedAt`, with tombstones
 * so a delete on one device does not get resurrected by the other.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

import * as db from './db';
import { boot, emit, store } from './state';
import { syncSchedule } from './schedule';
import type { Tombstone } from './types';

const CONFIG_KEY = '147_firebase_config';
const ACCOUNT_KEY = '147_account_key';
const PAIR_TTL_MS = 10 * 60 * 1000;

/** Stores that take part in sync, and the field each is keyed by. */
const SYNCED = [
  { name: 'subjects', key: 'id' },
  { name: 'chapters', key: 'id' },
  { name: 'topics', key: 'id' },
  { name: 'logs', key: 'id' },
  { name: 'blurts', key: 'id' },
  { name: 'days', key: 'date' },
] as const;

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

interface Record_ {
  updatedAt?: number;
  [k: string]: unknown;
}

export interface CloudState {
  configured: boolean;
  /** This device has an accountKey and is syncing. */
  linked: boolean;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
}

const state: CloudState = {
  configured: false,
  linked: false,
  syncing: false,
  lastSync: null,
  error: null,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let store_: Firestore | null = null;

export function cloudState(): CloudState {
  return { ...state };
}

/* ---------- config ---------- */

function valid(c: FirebaseConfig | null): FirebaseConfig | null {
  return c && c.apiKey && c.projectId && c.appId ? c : null;
}

/** Config compiled in at build time from VITE_FIREBASE_CONFIG, if there was one. */
function builtInConfig(): FirebaseConfig | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return null;
  try {
    return valid(JSON.parse(raw) as FirebaseConfig);
  } catch {
    return null;
  }
}

/** Pasted config wins over the built-in one, so a build can always be repointed. */
export function readConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return valid(JSON.parse(raw) as FirebaseConfig) ?? builtInConfig();
  } catch {
    /* fall through to the built-in one */
  }
  return builtInConfig();
}

/** True when the active config came from the build rather than a paste. */
export function usingBuiltInConfig(): boolean {
  return !localStorage.getItem(CONFIG_KEY) && !!builtInConfig();
}

/**
 * Accepts either raw JSON or the whole `const firebaseConfig = {...};` snippet
 * the Firebase console hands you, because pasting that verbatim is what people
 * actually do.
 */
export function saveConfig(text: string): { ok: boolean; message: string } {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!body) return { ok: false, message: 'Could not find a { ... } block in that.' };

  let parsed: FirebaseConfig;
  try {
    // The console snippet uses unquoted keys and single quotes, so JSON.parse alone will not do.
    parsed = JSON.parse(
      body
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*})/g, '$1'),
    ) as FirebaseConfig;
  } catch {
    return { ok: false, message: 'That is not valid config — copy the whole firebaseConfig block.' };
  }

  if (!parsed.apiKey || !parsed.projectId || !parsed.appId) {
    return { ok: false, message: 'Missing apiKey, projectId or appId.' };
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
  state.configured = true;
  state.error = null;
  return { ok: true, message: `Connected to ${parsed.projectId}.` };
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  state.configured = false;
  state.linked = false;
  app = null;
  auth = null;
  store_ = null;
}

/* ---------- firebase boot ---------- */

async function ensureApp(): Promise<{ auth: Auth; fs: Firestore } | null> {
  const config = readConfig();
  if (!config) return null;
  if (auth && store_) return { auth, fs: store_ };

  const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);

  app = getApps()[0] ?? initializeApp(config);
  auth = authMod.getAuth(app);
  store_ = fsMod.getFirestore(app);
  return { auth, fs: store_ };
}

/** Silent — no UI, no consent screen. Reuses the same session across launches. */
async function ensureAnon(ready: { auth: Auth }): Promise<void> {
  if (ready.auth.currentUser) return;
  const { signInAnonymously } = await import('firebase/auth');
  try {
    await signInAnonymously(ready.auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('admin-restricted-operation')) {
      throw new Error(
        'Anonymous sign-in is off for this Firebase project. Turn it on: Firebase console → Authentication → Sign-in method → Anonymous → Enable.',
      );
    }
    throw err;
  }
}

/* ---------- account key ---------- */

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomDigits(n: number): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 10 ** n).padStart(n, '0');
}

export function accountKey(): string | null {
  return localStorage.getItem(ACCOUNT_KEY);
}

function setAccountKey(key: string): void {
  localStorage.setItem(ACCOUNT_KEY, key);
  state.linked = true;
}

/** Restores state on launch — no prompting, no network wait. */
export async function initCloud(onChange: () => void): Promise<void> {
  state.configured = !!readConfig();
  state.linked = !!accountKey();
  if (!state.configured) return;

  const ready = await ensureApp();
  if (!ready) return;
  await ensureAnon(ready);
  onChange();
  if (state.linked) void sync();
}

/**
 * First device: mints a fresh accountKey and starts syncing immediately —
 * this is the "log in" that needs no code, because there is nothing to join
 * yet. Whatever is already on this device becomes the seed.
 */
export async function startSync(): Promise<{ ok: boolean; message: string }> {
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Add your Firebase config first.' };
  try {
    await ensureAnon(ready);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = message;
    return { ok: false, message };
  }
  setAccountKey(randomHex(16));
  const res = await sync();
  return res.ok
    ? { ok: true, message: 'Sync is on. Get a pairing code to add another device.' }
    : res;
}

/** Stops syncing on this device. Local data stays; the cloud copy is untouched. */
export function unlink(): void {
  localStorage.removeItem(ACCOUNT_KEY);
  state.linked = false;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
}

/**
 * Mints a six-digit code that resolves to this device's accountKey for ten
 * minutes, so a second device can adopt it. The code itself grants nothing
 * lasting — once redeemed (or once it expires) it is worthless.
 */
export async function createPairingCode(): Promise<
  { ok: true; pairing: PairingCode } | { ok: false; message: string }
> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Turn sync on first.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, setDoc } = await import('firebase/firestore');
    const code = randomDigits(6);
    const expiresAt = Date.now() + PAIR_TTL_MS;
    await setDoc(doc(ready.fs, 'pairs', code), { accountKey: key, expiresAt });
    return { ok: true, pairing: { code, expiresAt } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Second device: reads the code, adopts whatever accountKey it points at,
 * then syncs — which pulls in everything already on the account and pushes
 * up anything only this device had.
 */
export async function redeemPairingCode(
  code: string,
): Promise<{ ok: boolean; message: string }> {
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Add your Firebase config first.' };
  const digits = code.trim();
  if (!/^\d{6}$/.test(digits)) return { ok: false, message: 'That is not a six-digit code.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ready.fs, 'pairs', digits));
    const data = snap.data() as { accountKey?: string; expiresAt?: number } | undefined;
    if (!data?.accountKey) return { ok: false, message: 'No such code — check the digits.' };
    if (!data.expiresAt || data.expiresAt < Date.now()) {
      return { ok: false, message: 'That code has expired — get a fresh one from the other device.' };
    }
    setAccountKey(data.accountKey);
    const res = await sync();
    return res.ok ? { ok: true, message: 'Linked. Everything from the other device is here.' } : res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = message;
    return { ok: false, message };
  }
}

/* ---------- sync ---------- */

function newer(a: Record_ | undefined, b: Record_ | undefined): Record_ | undefined {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a;
}

interface RemoteShape {
  items?: Record_[];
}

export async function sync(): Promise<{ ok: boolean; message: string }> {
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };
  const key = accountKey();
  if (!key) return { ok: false, message: 'Not linked.' };
  if (state.syncing) return { ok: true, message: 'Already syncing.' };

  state.syncing = true;
  state.error = null;
  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');

    // Tombstones first — a delete has to beat any stale copy of the record.
    const tombRef = doc(ready.fs, 'accounts', key, 'data', 'deletes');
    const tombSnap = await getDoc(tombRef);
    const remoteTombs = ((tombSnap.data() as RemoteShape | undefined)?.items ??
      []) as unknown as Tombstone[];
    const tombs = new Map<string, Tombstone>();
    for (const t of [...store.deletes, ...remoteTombs]) {
      const seen = tombs.get(t.key);
      if (!seen || t.at > seen.at) tombs.set(t.key, t);
    }

    let pulled = 0;
    let pushed = 0;

    for (const { name, key: idKey } of SYNCED) {
      const ref = doc(ready.fs, 'accounts', key, 'data', name);
      const snap = await getDoc(ref);
      const remote = ((snap.data() as RemoteShape | undefined)?.items ?? []) as Record_[];
      const local = store[name] as unknown as Record_[];

      const merged = new Map<string, Record_>();
      for (const r of local) merged.set(String(r[idKey]), r);
      for (const r of remote) {
        const id = String(r[idKey]);
        const winner = newer(merged.get(id), r);
        if (winner === r) pulled += 1;
        merged.set(id, winner!);
      }

      // Drop anything a tombstone outranks.
      for (const [id, rec] of [...merged]) {
        const t = tombs.get(`${name}:${id}`);
        if (t && t.at >= (rec.updatedAt ?? 0)) merged.delete(id);
      }

      const items = [...merged.values()];
      pushed += items.length;

      // Local mirror — touch=false so a pull does not read as a fresh local edit.
      await db.putMany(name, items, false);
      const goneLocally = local
        .map((r) => String(r[idKey]))
        .filter((id) => !merged.has(id));
      await db.delMany(name, goneLocally, false);

      await setDoc(ref, { items, syncedAt: Date.now() });
    }

    await setDoc(tombRef, { items: [...tombs.values()], syncedAt: Date.now() });
    await db.putMany('deletes', [...tombs.values()], false);

    await boot();
    await syncSchedule();
    state.lastSync = Date.now();
    emit();
    return { ok: true, message: `Synced — ${pulled} pulled, ${pushed} records in the cloud.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = message;
    return { ok: false, message };
  } finally {
    state.syncing = false;
  }
}

/** Debounced background sync, fired after local changes. */
let timer: number | undefined;
export function syncSoon(): void {
  if (!state.linked) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void sync(), 4000);
}
