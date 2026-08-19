import type { Blurt, Chapter, ClassLog, DayLog, DB, Subject, Tombstone, Topic } from './types';

const DB_NAME = 'app147';
const DB_VERSION = 2;

export const STORES = [
  'subjects',
  'chapters',
  'topics',
  'logs',
  'blurts',
  'days',
  'deletes',
] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chapters')) {
        const s = db.createObjectStore('chapters', { keyPath: 'id' });
        s.createIndex('subjectId', 'subjectId');
      }
      if (!db.objectStoreNames.contains('topics')) {
        const s = db.createObjectStore('topics', { keyPath: 'id' });
        s.createIndex('chapterId', 'chapterId');
      }
      if (!db.objectStoreNames.contains('logs')) {
        const s = db.createObjectStore('logs', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('blurts')) {
        const s = db.createObjectStore('blurts', { keyPath: 'id' });
        s.createIndex('dueDate', 'dueDate');
        s.createIndex('refId', 'refId');
      }
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('deletes')) db.createObjectStore('deletes', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

/**
 * Every write stamps `updatedAt`, which is what makes last-write-wins sync work.
 * Pass touch=false when writing records that came *from* the cloud, otherwise
 * pulling would look like a local edit and bounce straight back.
 */
function stamp(value: unknown, touch: boolean): unknown {
  if (touch && value && typeof value === 'object') {
    (value as { updatedAt?: number }).updatedAt = Date.now();
  }
  return value;
}

export function put(store: StoreName, value: unknown, touch = true): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(stamp(value, touch)));
}

export function putMany(store: StoreName, values: unknown[], touch = true): Promise<void> {
  if (values.length === 0) return Promise.resolve();
  for (const v of values) stamp(v, touch);
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const os = t.objectStore(store);
        for (const v of values) os.put(v);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

async function tombstone(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (store === 'deletes') return;
  const rows: Tombstone[] = keys.map((k) => ({
    key: `${store}:${String(k)}`,
    store,
    id: String(k),
    at: Date.now(),
  }));
  await putMany('deletes', rows, false);
}

export async function del(store: StoreName, key: IDBValidKey, mark = true): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
  if (mark) await tombstone(store, [key]);
}

export async function delMany(store: StoreName, keys: IDBValidKey[], mark = true): Promise<void> {
  if (keys.length === 0) return;
  if (mark) await tombstone(store, keys);
  await open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const os = t.objectStore(store);
        for (const k of keys) os.delete(k);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

/** Chapters saved before the method field existed default to 'blurt'. */
function withDefaults(chapters: Chapter[]): Chapter[] {
  for (const c of chapters) if (!c.method) c.method = 'blurt';
  return chapters;
}

export async function loadAll(): Promise<DB> {
  const [subjects, chapters, topics, logs, blurts, days, deletes] = await Promise.all([
    getAll<Subject>('subjects'),
    getAll<Chapter>('chapters').then(withDefaults),
    getAll<Topic>('topics'),
    getAll<ClassLog>('logs'),
    getAll<Blurt>('blurts'),
    getAll<DayLog>('days'),
    getAll<Tombstone>('deletes'),
  ]);
  return { subjects, chapters, topics, logs, blurts, days, deletes };
}

/** Wipes every store — used by backup restore. */
export async function clearAll(): Promise<void> {
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const t = database.transaction(STORES as unknown as string[], 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
