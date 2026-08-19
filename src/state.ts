import * as db from './db';
import type {
  Blurt,
  Chapter,
  ClassLog,
  DayLog,
  ID,
  ISODate,
  Subject,
  Tombstone,
  Topic,
} from './types';
import { PALETTE, uid } from './util';

export const store = {
  subjects: [] as Subject[],
  chapters: [] as Chapter[],
  topics: [] as Topic[],
  logs: [] as ClassLog[],
  blurts: [] as Blurt[],
  days: [] as DayLog[],
  deletes: [] as Tombstone[],
  ready: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): void {
  listeners.add(fn);
}

export function emit(): void {
  for (const fn of listeners) fn();
}

export async function boot(): Promise<void> {
  const data = await db.loadAll();
  store.subjects = data.subjects;
  store.chapters = data.chapters;
  store.topics = data.topics;
  store.logs = data.logs;
  store.blurts = data.blurts;
  store.days = data.days;
  store.deletes = data.deletes;
  store.ready = true;
}

/* ---------- lookups ---------- */

export const subjectById = (id: ID) => store.subjects.find((s) => s.id === id);
export const chapterById = (id: ID) => store.chapters.find((c) => c.id === id);
export const topicById = (id: ID) => store.topics.find((t) => t.id === id);
export const logById = (id: ID) => store.logs.find((l) => l.id === id);

export const chaptersOf = (subjectId: ID) =>
  store.chapters.filter((c) => c.subjectId === subjectId).sort((a, b) => a.order - b.order);

export const topicsOf = (chapterId: ID) =>
  store.topics.filter((t) => t.chapterId === chapterId).sort((a, b) => a.createdAt - b.createdAt);

export const logsOf = (chapterId: ID) =>
  store.logs.filter((l) => l.chapterId === chapterId).sort((a, b) => b.date.localeCompare(a.date));

export const recentLogs = (limit = 60) =>
  [...store.logs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, limit);

export const dayLog = (date: ISODate) => store.days.find((d) => d.date === date);

/* ---------- subjects ---------- */

export async function addSubject(name: string): Promise<Subject> {
  const s: Subject = {
    id: uid('s_'),
    name: name.trim(),
    color: PALETTE[store.subjects.length % PALETTE.length],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  };
  store.subjects.push(s);
  await db.put('subjects', s);
  emit();
  return s;
}

export async function updateSubject(id: ID, patch: Partial<Subject>): Promise<void> {
  const s = subjectById(id);
  if (!s) return;
  Object.assign(s, patch);
  await db.put('subjects', s);
  emit();
}

export async function deleteSubject(id: ID): Promise<void> {
  const chapters = store.chapters.filter((c) => c.subjectId === id);
  for (const c of chapters) await deleteChapter(c.id, false);
  store.subjects = store.subjects.filter((s) => s.id !== id);
  await db.del('subjects', id);
  emit();
}

/* ---------- chapters ---------- */

export async function addChapter(subjectId: ID, name: string): Promise<Chapter> {
  const c: Chapter = {
    id: uid('c_'),
    subjectId,
    name: name.trim(),
    order: chaptersOf(subjectId).length,
    method: 'blurt',
    finished: false,
    finishedAt: null,
    fortnightlyFrom: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.chapters.push(c);
  await db.put('chapters', c);
  emit();
  return c;
}

export async function updateChapter(id: ID, patch: Partial<Chapter>): Promise<void> {
  const c = chapterById(id);
  if (!c) return;
  Object.assign(c, patch);
  await db.put('chapters', c);
  emit();
}

export async function deleteChapter(id: ID, notify = true): Promise<void> {
  const topicIds = store.topics.filter((t) => t.chapterId === id).map((t) => t.id);
  const logIds = store.logs.filter((l) => l.chapterId === id).map((l) => l.id);
  const blurtIds = store.blurts.filter((b) => b.chapterId === id).map((b) => b.id);

  store.topics = store.topics.filter((t) => t.chapterId !== id);
  store.logs = store.logs.filter((l) => l.chapterId !== id);
  store.blurts = store.blurts.filter((b) => b.chapterId !== id);
  store.chapters = store.chapters.filter((c) => c.id !== id);

  await Promise.all([
    db.delMany('topics', topicIds),
    db.delMany('logs', logIds),
    db.delMany('blurts', blurtIds),
    db.del('chapters', id),
  ]);
  if (notify) emit();
}

/* ---------- topics ---------- */

export async function addTopic(
  chapterId: ID,
  name: string,
  taughtOn: ISODate | null = null,
): Promise<Topic> {
  const ch = chapterById(chapterId);
  if (!ch) throw new Error('no such chapter');
  const t: Topic = {
    id: uid('t_'),
    chapterId,
    subjectId: ch.subjectId,
    name: name.trim(),
    isLast: false,
    taughtOn,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.topics.push(t);
  await db.put('topics', t);
  emit();
  return t;
}

export async function updateTopic(id: ID, patch: Partial<Topic>): Promise<void> {
  const t = topicById(id);
  if (!t) return;
  Object.assign(t, patch);
  await db.put('topics', t);
  emit();
}

/** Only one topic per chapter may carry the "last topic" flag. */
export async function setLastTopic(chapterId: ID, topicId: ID | null): Promise<void> {
  const changed: Topic[] = [];
  for (const t of topicsOf(chapterId)) {
    const should = t.id === topicId;
    if (t.isLast !== should) {
      t.isLast = should;
      changed.push(t);
    }
  }
  await db.putMany('topics', changed);
  emit();
}

export async function deleteTopic(id: ID): Promise<void> {
  // Blurts hang off classes now, so removing a topic only edits the logs.
  const blurtIds: ID[] = [];
  store.topics = store.topics.filter((t) => t.id !== id);
  for (const l of store.logs) {
    if (l.topicIds.includes(id)) {
      l.topicIds = l.topicIds.filter((x) => x !== id);
      await db.put('logs', l);
    }
  }
  await Promise.all([db.delMany('blurts', blurtIds), db.del('topics', id)]);
  emit();
}

/* ---------- class logs ---------- */

export interface ClassLogInput {
  id?: ID;
  date: ISODate;
  subjectId: ID;
  chapterId: ID;
  what: string;
  topicIds: ID[];
  /** names typed into the "topics covered" box that do not exist yet */
  newTopicNames: string[];
}

export async function saveClassLog(input: ClassLogInput): Promise<ClassLog> {
  const created: Topic[] = [];
  for (const name of input.newTopicNames) {
    if (name.trim()) created.push(await addTopic(input.chapterId, name, input.date));
  }
  const topicIds = [...input.topicIds, ...created.map((t) => t.id)];

  // The earliest class covering a topic is what the 1-4-7 ladder counts from.
  for (const id of topicIds) {
    const t = topicById(id);
    if (t && (!t.taughtOn || input.date < t.taughtOn)) {
      t.taughtOn = input.date;
      await db.put('topics', t);
    }
  }

  const existing = input.id ? logById(input.id) : undefined;
  if (existing) {
    existing.date = input.date;
    existing.subjectId = input.subjectId;
    existing.chapterId = input.chapterId;
    existing.what = input.what;
    existing.topicIds = topicIds;
    await db.put('logs', existing);
    emit();
    return existing;
  }

  const log: ClassLog = {
    id: uid('l_'),
    date: input.date,
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    what: input.what,
    topicIds,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.logs.push(log);
  await db.put('logs', log);
  emit();
  return log;
}

export async function deleteClassLog(id: ID): Promise<void> {
  store.logs = store.logs.filter((l) => l.id !== id);
  await db.del('logs', id);
  emit();
}

/* ---------- day log ---------- */

export async function saveDayLog(date: ISODate, note: string): Promise<void> {
  const existing = dayLog(date);
  if (existing) {
    existing.note = note;
    existing.updatedAt = Date.now();
    await db.put('days', existing);
  } else {
    const d: DayLog = { date, note, updatedAt: Date.now() };
    store.days.push(d);
    await db.put('days', d);
  }
  emit();
}
