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
 * without a server). A permanent six-digit sync token maps to that accountKey
 * in Firestore; any device that redeems it adopts the same accountKey. After
 * that, every device just syncs straight to `accounts/{accountKey}/...`.
 *
 * Each account tracks up to MAX_DEVICES distinct device ids (a random id
 * generated once per device, separate from the accountKey) — redeeming the
 * token past that cap is refused rather than silently letting in a fourth
 * device.
 *
 * Merge strategy is last-write-wins per record on `updatedAt`, with tombstones
 * so a delete on one device does not get resurrected by the other.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

import * as db from './db';
import { boot, store } from './state';
import { syncSchedule } from './schedule';
import type { Tombstone } from './types';

const CONFIG_KEY = '147_firebase_config';
const ACCOUNT_KEY = '147_account_key';
const DEVICE_ID_KEY = '147_device_id';
const MAX_DEVICES = 3;

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

/**
 * UI hook for cloud-state changes that don't otherwise trigger a render —
 * background syncs (the debounced auto-sync, the one on launch, pull-to-
 * refresh) flip state.syncing without any local data changing, so nothing
 * else calls back into the UI. Without this the sync dot only ever updated
 * after a sync finished, never while one was running.
 */
let onChangeCb: (() => void) | null = null;
export function onCloudChange(fn: () => void): void {
  onChangeCb = fn;
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

/** A stable id for this device, separate from the accountKey — what the device cap counts. */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = randomHex(8);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function accountKey(): string | null {
  return localStorage.getItem(ACCOUNT_KEY);
}

function setAccountKey(key: string): void {
  localStorage.setItem(ACCOUNT_KEY, key);
  state.linked = true;
}

interface DeviceEntry {
  id: string;
  linkedAt: number;
  name?: string;
  lastSeen?: number;
}

/** A device counts as "online" if it's touched lastSeen within this window — see registerDevice. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Adds this device to the account's device list, refusing past MAX_DEVICES —
 * unless it is already on the list, in which case this just bumps its
 * lastSeen (called on every launch and every sync, so it doubles as the
 * online/offline heartbeat).
 */
async function registerDevice(
  fs: Firestore,
  key: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const { doc, getDoc, setDoc } = await import('firebase/firestore');
  const ref = doc(fs, 'accounts', key, 'data', 'devices');
  const snap = await getDoc(ref);
  const items = ((snap.data() as { items?: DeviceEntry[] } | undefined)?.items ?? []).filter(
    (d) => d.id,
  );
  const id = deviceId();
  const now = Date.now();

  const idx = items.findIndex((d) => d.id === id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], lastSeen: now };
    await setDoc(ref, { items });
    return { ok: true, count: items.length };
  }
  if (items.length >= MAX_DEVICES) {
    return {
      ok: false,
      message: `This sync token already has ${MAX_DEVICES} devices linked — unlink one, or regenerate the token to start fresh.`,
    };
  }

  items.push({ id, linkedAt: now, lastSeen: now });
  await setDoc(ref, { items });
  return { ok: true, count: items.length };
}

/** Lets a device rename itself or any other device in the list — cosmetic only, no approval needed. */
export async function renameDevice(id: string, name: string): Promise<{ ok: boolean; message: string }> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Not linked.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const ref = doc(ready.fs, 'accounts', key, 'data', 'devices');
    const snap = await getDoc(ref);
    const items = ((snap.data() as { items?: DeviceEntry[] } | undefined)?.items ?? []).filter(
      (d) => d.id,
    );
    const idx = items.findIndex((d) => d.id === id);
    if (idx === -1) return { ok: false, message: 'Device not found.' };
    items[idx] = { ...items[idx], name: name.trim().slice(0, 30) };
    await setDoc(ref, { items });
    return { ok: true, message: 'Renamed.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export interface DeviceInfo {
  id: string;
  linkedAt: number;
  isThisDevice: boolean;
  name: string | null;
  online: boolean;
}

/**
 * Every device currently on this account — the whole point is being able to
 * free a slot for a device you no longer have (a laptop that got sold, say)
 * from any *other* device still linked, since the old one is gone and can
 * never call unlink() on itself.
 */
export async function listDevices(): Promise<DeviceInfo[] | null> {
  const key = accountKey();
  if (!key) return null;
  const ready = await ensureApp();
  if (!ready) return null;
  try {
    await ensureAnon(ready);
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ready.fs, 'accounts', key, 'data', 'devices'));
    const items = (snap.data() as { items?: DeviceEntry[] } | undefined)?.items ?? [];
    const self = deviceId();
    const now = Date.now();
    return [...items]
      .sort((a, b) => a.linkedAt - b.linkedAt)
      .map((d) => ({
        id: d.id,
        linkedAt: d.linkedAt,
        isThisDevice: d.id === self,
        name: d.name ?? null,
        online: now - (d.lastSeen ?? d.linkedAt) < ONLINE_WINDOW_MS,
      }));
  } catch {
    return null;
  }
}

/**
 * The actual removal primitive. Only called directly for this device
 * removing itself (unlink) or by approveDeviceRemoval below — removing a
 * *different* device always goes through the request/approve flow first, so
 * one device can never unilaterally kick another off the account.
 */
async function removeDevice(id: string): Promise<{ ok: boolean; message: string }> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Not linked.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const ref = doc(ready.fs, 'accounts', key, 'data', 'devices');
    const snap = await getDoc(ref);
    const items = ((snap.data() as { items?: DeviceEntry[] } | undefined)?.items ?? []).filter(
      (d) => d.id !== id,
    );
    await setDoc(ref, { items });

    if (id === deviceId()) {
      localStorage.removeItem(ACCOUNT_KEY);
      state.linked = false;
      return { ok: true, message: 'This device is unlinked.' };
    }
    return { ok: true, message: 'Device removed — its slot is free.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

interface RemovalRequest {
  targetId: string;
  targetLinkedAt: number;
  requestedBy: string;
  requestedAt: number;
}

/**
 * Files a request to remove a *different* device — this device cannot do it
 * alone. The next device that opens Settings and isn't the one being removed
 * gets a popup to approve or deny it.
 */
export async function requestDeviceRemoval(
  target: DeviceInfo,
): Promise<{ ok: boolean; message: string }> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Not linked.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, setDoc } = await import('firebase/firestore');
    const req: RemovalRequest = {
      targetId: target.id,
      targetLinkedAt: target.linkedAt,
      requestedBy: deviceId(),
      requestedAt: Date.now(),
    };
    await setDoc(doc(ready.fs, 'accounts', key, 'data', 'removal'), req);
    return { ok: true, message: 'Waiting on another linked device to confirm the removal.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Checked by every device that isn't the requester — null unless one is actually waiting on it. */
export async function pendingRemovalRequest(): Promise<RemovalRequest | null> {
  const key = accountKey();
  if (!key) return null;
  const ready = await ensureApp();
  if (!ready) return null;
  try {
    await ensureAnon(ready);
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ready.fs, 'accounts', key, 'data', 'removal'));
    const data = snap.data() as RemovalRequest | undefined;
    if (!data || data.requestedBy === deviceId() || data.targetId === deviceId()) return null;
    return data;
  } catch {
    return null;
  }
}

async function clearRemovalRequest(): Promise<void> {
  const key = accountKey();
  if (!key) return;
  const ready = await ensureApp();
  if (!ready) return;
  try {
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(ready.fs, 'accounts', key, 'data', 'removal'));
  } catch {
    /* best effort */
  }
}

/** Approve: actually removes the target device, then clears the request. */
export async function approveDeviceRemoval(
  targetId: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await removeDevice(targetId);
  await clearRemovalRequest();
  return res;
}

/** Deny: removes nothing, just clears the pending request. */
export async function denyDeviceRemoval(): Promise<void> {
  await clearRemovalRequest();
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
  if (state.linked) {
    // Devices linked before the device-list existed never got registered —
    // backfill on every launch so they show up instead of reading as "0 devices".
    const key = accountKey();
    if (key) void registerDevice(ready.fs, key);
    void sync();
  }
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
  const key = randomHex(16);
  setAccountKey(key);
  await registerDevice(ready.fs, key);
  const res = await sync();
  return res.ok
    ? { ok: true, message: 'Sync is on. Your sync token is in this card — use it on another device.' }
    : res;
}

/**
 * Stops syncing on this device. Local data stays; the cloud copy is
 * untouched. Best-effort removes this device from the account's device list
 * so its slot frees up for the cap — a failed removal (offline, say) just
 * leaves a stale entry, which is harmless.
 */
export async function unlink(): Promise<void> {
  const key = accountKey();
  localStorage.removeItem(ACCOUNT_KEY);
  state.linked = false;
  if (!key) return;

  try {
    const ready = await ensureApp();
    if (!ready) return;
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const ref = doc(ready.fs, 'accounts', key, 'data', 'devices');
    const snap = await getDoc(ref);
    const items = ((snap.data() as { items?: DeviceEntry[] } | undefined)?.items ?? []).filter(
      (d) => d.id !== deviceId(),
    );
    await setDoc(ref, { items });
  } catch {
    /* best effort — the local unlink already happened either way */
  }
}

/**
 * A permanent six-digit token, one per account, that resolves to this
 * account's accountKey — unlike the old pairing code, it never expires, so
 * it only needs generating once and can be reused on any future device.
 * Regenerating replaces it outright (see regenerateSyncToken).
 */
export async function getSyncToken(): Promise<
  { ok: true; code: string } | { ok: false; message: string }
> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Turn sync on first.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');
    const tokenRef = doc(ready.fs, 'accounts', key, 'data', 'token');
    const snap = await getDoc(tokenRef);
    const existing = (snap.data() as { code?: string } | undefined)?.code;
    if (existing) return { ok: true, code: existing };

    const code = randomDigits(6);
    await Promise.all([
      setDoc(doc(ready.fs, 'pairs', code), { accountKey: key }),
      setDoc(tokenRef, { code }),
    ]);
    return { ok: true, code };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Replaces the token outright — the old one stops resolving immediately. Only touches the token/pairs docs, never accountKey, devices, or synced data. */
export async function regenerateSyncToken(): Promise<
  { ok: true; code: string } | { ok: false; message: string }
> {
  const key = accountKey();
  if (!key) return { ok: false, message: 'Turn sync on first.' };
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc, deleteDoc } = await import('firebase/firestore');
    const tokenRef = doc(ready.fs, 'accounts', key, 'data', 'token');
    const snap = await getDoc(tokenRef);
    const oldCode = (snap.data() as { code?: string } | undefined)?.code;

    const code = randomDigits(6);
    await Promise.all([
      setDoc(doc(ready.fs, 'pairs', code), { accountKey: key }),
      setDoc(tokenRef, { code }),
      oldCode ? deleteDoc(doc(ready.fs, 'pairs', oldCode)) : Promise.resolve(),
    ]);
    return { ok: true, code };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Second device: reads the token, adopts whatever accountKey it points at,
 * then syncs — which pulls in everything already on the account and pushes
 * up anything only this device had.
 */
export async function redeemSyncToken(code: string): Promise<{ ok: boolean; message: string }> {
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Add your Firebase config first.' };
  const digits = code.trim();
  if (!/^\d{6}$/.test(digits)) return { ok: false, message: 'That is not a six-digit token.' };

  try {
    await ensureAnon(ready);
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ready.fs, 'pairs', digits));
    const data = snap.data() as { accountKey?: string } | undefined;
    if (!data?.accountKey) return { ok: false, message: 'No such token — check the digits.' };

    const reg = await registerDevice(ready.fs, data.accountKey);
    if (!reg.ok) return { ok: false, message: reg.message };

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

/**
 * Firestore's setDoc rejects any field valued `undefined` outright — IndexedDB
 * (structured clone) happily stores it, so a record saved locally with an
 * undefined optional field only ever explodes the moment it tries to sync.
 * Stripping those keys here both fixes the write and self-heals the local
 * copy (it gets written back below via putMany), so this clears up on its
 * own the next time each device syncs — no per-device manual fix needed.
 */
function stripUndefined<T extends Record_>(obj: T): T {
  const out = {} as T;
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

interface RemoteShape {
  items?: Record_[];
}

/**
 * Every read and every write happens in one Promise.all batch each, rather
 * than one store at a time — with six synced stores plus tombstones, going
 * store-by-store meant ~12 sequential network round trips. Firestore has no
 * cross-document transaction needed here (each store is its own document,
 * merges happen locally), so there is nothing to lose by firing them all at
 * once.
 */
export async function sync(): Promise<{ ok: boolean; message: string }> {
  const ready = await ensureApp();
  if (!ready) return { ok: false, message: 'Not configured.' };
  const key = accountKey();
  if (!key) return { ok: false, message: 'Not linked.' };
  if (state.syncing) return { ok: true, message: 'Already syncing.' };

  state.syncing = true;
  state.error = null;
  onChangeCb?.();
  try {
    await ensureAnon(ready);
    const { doc, getDoc, setDoc } = await import('firebase/firestore');

    // Fire-and-forget — bumps this device's lastSeen so the online dot in
    // Settings stays fresh without slowing the actual data sync down.
    void registerDevice(ready.fs, key);

    const tombRef = doc(ready.fs, 'accounts', key, 'data', 'deletes');
    const storeRefs = SYNCED.map(({ name }) => doc(ready.fs, 'accounts', key, 'data', name));

    const [tombSnap, ...storeSnaps] = await Promise.all([
      getDoc(tombRef),
      ...storeRefs.map((ref) => getDoc(ref)),
    ]);

    // Tombstones go first — a delete has to beat any stale copy of the record.
    const remoteTombs = ((tombSnap.data() as RemoteShape | undefined)?.items ??
      []) as unknown as Tombstone[];
    const tombs = new Map<string, Tombstone>();
    for (const t of [...store.deletes, ...remoteTombs]) {
      const seen = tombs.get(t.key);
      if (!seen || t.at > seen.at) tombs.set(t.key, t);
    }

    let pulled = 0;
    let pushed = 0;
    const reads: Promise<unknown>[] = [];
    const writes: Promise<unknown>[] = [];

    SYNCED.forEach(({ name, key: idKey }, i) => {
      const remote = ((storeSnaps[i].data() as RemoteShape | undefined)?.items ?? []) as Record_[];
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

      const items = [...merged.values()].map(stripUndefined);
      pushed += items.length;

      // Local mirror — touch=false so a pull does not read as a fresh local edit.
      reads.push(db.putMany(name, items, false));
      const goneLocally = local
        .map((r) => String(r[idKey]))
        .filter((id) => !merged.has(id));
      reads.push(db.delMany(name, goneLocally, false));

      writes.push(setDoc(storeRefs[i], { items, syncedAt: Date.now() }));
    });

    writes.push(setDoc(tombRef, { items: [...tombs.values()], syncedAt: Date.now() }));
    reads.push(db.putMany('deletes', [...tombs.values()], false));

    await Promise.all([...reads, ...writes]);

    await boot();
    await syncSchedule();
    state.lastSync = Date.now();
    // Not emit() here — that's the "local data changed" signal main.ts uses to
    // schedule another debounced sync, and firing it from inside sync() itself
    // re-armed a new sync every few seconds forever. onChangeCb (below, in
    // finally) already re-renders with the pulled data; that's all this needs.
    return { ok: true, message: `Synced — ${pulled} pulled, ${pushed} records in the cloud.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = message;
    return { ok: false, message };
  } finally {
    state.syncing = false;
    onChangeCb?.();
  }
}

/** Debounced background sync, fired after local changes. */
let timer: number | undefined;
export function syncSoon(): void {
  if (!state.linked) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void sync(), 4000);
}
