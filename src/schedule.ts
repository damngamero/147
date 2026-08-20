import * as db from './db';
import { chapterById, emit, logsOf, store, topicsOf } from './state';
import type { Blurt, BlurtCycle, Chapter, ClassLog, ID, ISODate, Topic } from './types';
import { FORTNIGHTLY_GAP, R147_OFFSETS, WEEKLY_GAP, addDays, todayISO } from './util';

const LADDER: Array<{ cycle: Extract<BlurtCycle, 'r1' | 'r4' | 'r7'>; offset: number }> = [
  { cycle: 'r1', offset: R147_OFFSETS.r1 },
  { cycle: 'r4', offset: R147_OFFSETS.r4 },
  { cycle: 'r7', offset: R147_OFFSETS.r7 },
];

export const CYCLE_LABEL: Record<BlurtCycle, string> = {
  r1: 'blurt 1',
  r4: 'blurt 2',
  r7: 'blurt 3',
  weekly: 'weekly',
  fortnightly: 'fortnightly',
};

export const CYCLE_SHORT: Record<BlurtCycle, string> = {
  r1: '1',
  r4: '4',
  r7: '7',
  weekly: 'wk',
  fortnightly: '2wk',
};

/* ---------- queries ---------- */

export const blurtById = (id: ID) => store.blurts.find((b) => b.id === id);

export const blurtsFor = (kind: 'class' | 'chapter', refId: ID) =>
  store.blurts.filter((b) => b.kind === kind && b.refId === refId);

const isResolved = (b: Blurt) => b.status === 'done' || b.status === 'missed';

/**
 * Everything still waiting. Note this includes future dates — use `dueBy` for
 * anything the user is allowed to act on.
 */
export function openBlurts(): Blurt[] {
  return store.blurts
    .filter((b) => b.status === 'due')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cycle.localeCompare(b.cycle));
}

/** Due today or earlier — the only blurts that can be done. */
export function dueBy(date: ISODate = todayISO()): Blurt[] {
  return openBlurts().filter((b) => b.dueDate <= date);
}

/** Blurting ahead defeats the point, so the UI refuses anything not yet due. */
export function isActionable(b: Blurt): boolean {
  return b.status === 'due' && b.dueDate <= todayISO();
}

export function doneOnDate(date: ISODate): Blurt[] {
  return store.blurts.filter((b) => b.doneOn === date && isResolved(b));
}

/* ---------- ladders, per class ---------- */

function ladderOf(logId: ID): Blurt[] {
  return LADDER.map((s) => blurtById(`b_${logId}_${s.cycle}`)).filter((b): b is Blurt => !!b);
}

export function ladderResolved(log: ClassLog): boolean {
  const l = ladderOf(log.id);
  return l.length === LADDER.length && l.every(isResolved);
}

export function ladderProgress(log: ClassLog): { done: number; total: number } {
  return { done: ladderOf(log.id).filter(isResolved).length, total: LADDER.length };
}

/** The class a topic was first taught in — what its 1-4-7 actually hangs off. */
export function classForTopic(topicId: ID): ClassLog | undefined {
  return store.logs
    .filter((l) => l.topicIds.includes(topicId))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

function lastResolvedDate(blurts: Blurt[]): ISODate | null {
  const dates = blurts.filter(isResolved).map((b) => b.doneOn ?? b.dueDate);
  return dates.length ? dates.sort().at(-1)! : null;
}

/* ---------- the graduation test ---------- */

/**
 * A chapter earns its fortnightly slot when it is marked finished AND the class
 * that taught the flagged last topic has cleared its 1-4-7. With no flag set,
 * every class in the chapter has to have cleared instead.
 */
export function chapterQualifies(ch: Chapter): boolean {
  if (!ch.finished) return false;
  const logs = logsOf(ch.id);
  if (!logs.length) return false;
  const last = topicsOf(ch.id).find((t) => t.isLast);
  const lastClass = last ? classForTopic(last.id) : undefined;
  return lastClass ? ladderResolved(lastClass) : logs.every(ladderResolved);
}

/* ---------- sync ---------- */

interface Pending {
  blurts: Map<ID, Blurt>;
  removed: Set<ID>;
  chapters: Set<Chapter>;
}

type NewBlurt = Omit<
  Blurt,
  'status' | 'doneOn' | 'score' | 'scores' | 'createdAt' | 'updatedAt'
>;

function newBlurt(part: NewBlurt): Blurt {
  return {
    ...part,
    status: 'due',
    doneOn: null,
    score: null,
    scores: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function upsert(p: Pending, b: Blurt): void {
  p.blurts.set(b.id, b);
  const i = store.blurts.findIndex((x) => x.id === b.id);
  if (i === -1) store.blurts.push(b);
  else store.blurts[i] = b;
}

function drop(p: Pending, id: ID): void {
  p.removed.add(id);
  p.blurts.delete(id);
  store.blurts = store.blurts.filter((b) => b.id !== id);
}

/**
 * Rebuilds the whole schedule from the class logs. Idempotent — ladder blurts
 * have deterministic ids, so this runs after every change without duplicating.
 */
export async function syncSchedule(): Promise<void> {
  const p: Pending = { blurts: new Map(), removed: new Set(), chapters: new Set() };
  const today = todayISO();

  // Blurts left over from the old per-topic model, or from a deleted class.
  const liveRefs = new Set([
    ...store.logs.map((l) => l.id),
    ...store.chapters.map((c) => c.id),
  ]);
  for (const b of [...store.blurts]) {
    const legacy = b.kind !== 'class' && b.kind !== 'chapter';
    if (legacy || !liveRefs.has(b.refId)) drop(p, b.id);
  }

  // Chapters first: a graduated chapter changes what its classes may schedule.
  for (const ch of store.chapters) {
    const qualifies = chapterQualifies(ch);
    if (qualifies && !ch.fortnightlyFrom) {
      const last = topicsOf(ch.id).find((t) => t.isLast);
      const lastClass = last ? classForTopic(last.id) : undefined;
      const end = lastClass ? lastResolvedDate(ladderOf(lastClass.id)) : null;
      ch.fortnightlyFrom = end && end > today ? end : today;
      p.chapters.add(ch);
    }
    if (!qualifies && ch.fortnightlyFrom) {
      ch.fortnightlyFrom = null;
      p.chapters.add(ch);
      for (const b of blurtsFor('chapter', ch.id)) if (b.status === 'due') drop(p, b.id);
    }
  }

  for (const log of store.logs) {
    const ch = chapterById(log.chapterId);
    const graduated = !!ch?.fortnightlyFrom;

    // One 1-4-7 ladder per class — every topic in it comes up together.
    //
    // A class logged well after the fact (backdated past the whole ladder
    // window) would otherwise dump all three overdue steps into Today at
    // once. If nothing in the ladder exists yet and the class is already
    // older than r7's offset, skip straight to "resolved" instead — the
    // class jumps straight onto weekly (or fortnightly, if the chapter
    // already qualifies) rather than making today re-litigate three blurts
    // for something learned weeks ago.
    const ladderIds = LADDER.map((step) => `b_${log.id}_${step.cycle}`);
    const ladderIsFresh = ladderIds.every((id) => !blurtById(id));
    const ladderWindowPassed = addDays(log.date, R147_OFFSETS.r7) < today;
    const backdatedPastLadder = ladderIsFresh && ladderWindowPassed;

    for (const step of LADDER) {
      const id = `b_${log.id}_${step.cycle}`;
      const want = addDays(log.date, step.offset);
      const existing = blurtById(id);
      if (!existing) {
        const b = newBlurt({
          id,
          kind: 'class',
          refId: log.id,
          subjectId: log.subjectId,
          chapterId: log.chapterId,
          dueDate: want,
          cycle: step.cycle,
          seq: 0,
        });
        if (backdatedPastLadder) {
          b.status = 'missed';
          b.doneOn = today;
        }
        upsert(p, b);
      } else if (existing.status === 'due' && existing.dueDate !== want) {
        existing.dueDate = want; // the class date was edited
        upsert(p, existing);
      }
    }

    const weeklies = blurtsFor('class', log.id).filter((b) => b.cycle === 'weekly');
    const cleared = ladderResolved(log);

    // Cleared the ladder and the chapter has not taken over yet -> weekly.
    if (!cleared || graduated) {
      for (const b of weeklies) if (b.status === 'due') drop(p, b.id);
      continue;
    }

    if (!weeklies.some((b) => b.status === 'due')) {
      const base = lastResolvedDate([...weeklies, ...ladderOf(log.id)]);
      if (base) {
        const seq = weeklies.length + 1;
        upsert(
          p,
          newBlurt({
            id: `b_${log.id}_w${seq}`,
            kind: 'class',
            refId: log.id,
            subjectId: log.subjectId,
            chapterId: log.chapterId,
            dueDate: addDays(base, WEEKLY_GAP),
            cycle: 'weekly',
            seq,
          }),
        );
      }
    }
  }

  // Fortnightly chapter blurts.
  for (const ch of store.chapters) {
    if (!ch.fortnightlyFrom) continue;
    const mine = blurtsFor('chapter', ch.id);
    if (mine.some((b) => b.status === 'due')) continue;
    const base = lastResolvedDate(mine) ?? ch.fortnightlyFrom;
    const seq = mine.length + 1;
    upsert(
      p,
      newBlurt({
        id: `b_${ch.id}_f${seq}`,
        kind: 'chapter',
        refId: ch.id,
        subjectId: ch.subjectId,
        chapterId: ch.id,
        dueDate: addDays(base, FORTNIGHTLY_GAP),
        cycle: 'fortnightly',
        seq,
      }),
    );
  }

  await Promise.all([
    db.putMany('blurts', [...p.blurts.values()]),
    db.delMany('blurts', [...p.removed]),
    db.putMany('chapters', [...p.chapters]),
  ]);

  if (p.blurts.size || p.removed.size || p.chapters.size) emit();
}

/* ---------- what a blurt covers ---------- */

/** The topics a blurt asks you to recall. */
export function topicsForBlurt(b: Blurt): Topic[] {
  if (b.kind === 'chapter') return topicsOf(b.refId);
  const log = store.logs.find((l) => l.id === b.refId);
  if (!log) return [];
  return log.topicIds
    .map((id) => store.topics.find((t) => t.id === id))
    .filter((t): t is Topic => !!t);
}

/* ---------- actions ---------- */

function average(scores: Record<ID, number>): number | null {
  const vals = Object.values(scores);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export async function completeBlurt(
  id: ID,
  scores: Record<ID, number> = {},
): Promise<void> {
  const b = blurtById(id);
  if (!b || !isActionable(b)) return;
  b.status = 'done';
  b.doneOn = todayISO();
  b.scores = scores;
  b.score = average(scores);
  await db.put('blurts', b);
  await syncSchedule();
  emit();
}

export async function skipBlurt(id: ID): Promise<void> {
  const b = blurtById(id);
  if (!b || !isActionable(b)) return;
  b.status = 'missed';
  b.doneOn = todayISO();
  await db.put('blurts', b);
  await syncSchedule();
  emit();
}

/** Bulk version of skipBlurt for clearing a pile of carried-over blurts at once. */
export async function skipAllLate(): Promise<void> {
  const today = todayISO();
  const late = dueBy(today).filter((b) => b.dueDate < today);
  for (const b of late) {
    b.status = 'missed';
    b.doneOn = today;
  }
  await db.putMany('blurts', late);
  await syncSchedule();
  emit();
}

export async function reopenBlurt(id: ID): Promise<void> {
  const b = blurtById(id);
  if (!b) return;
  b.status = 'due';
  b.doneOn = null;
  await db.put('blurts', b);
  await syncSchedule();
  emit();
}

export async function snoozeBlurt(id: ID, days = 1): Promise<void> {
  const b = blurtById(id);
  if (!b || b.status !== 'due') return;
  const from = b.dueDate < todayISO() ? todayISO() : b.dueDate;
  b.dueDate = addDays(from, days);
  await db.put('blurts', b);
  emit();
}

/* ---------- weak spots ---------- */

export interface TopicScore {
  topic: Topic;
  latest: number;
  average: number;
  times: number;
  lastOn: ISODate | null;
}

/**
 * Every rating you have ever given a topic, newest first. This is the whole
 * point of the ratings — it is how you find out what to go back over.
 */
export function topicScores(): TopicScore[] {
  const byTopic = new Map<ID, Array<{ score: number; on: ISODate }>>();

  for (const b of store.blurts) {
    if (b.status !== 'done') continue;
    for (const [topicId, score] of Object.entries(b.scores ?? {})) {
      if (!byTopic.has(topicId)) byTopic.set(topicId, []);
      byTopic.get(topicId)!.push({ score, on: b.doneOn ?? b.dueDate });
    }
  }

  const out: TopicScore[] = [];
  for (const [topicId, list] of byTopic) {
    const topic = store.topics.find((t) => t.id === topicId);
    if (!topic) continue;
    list.sort((a, b) => b.on.localeCompare(a.on));
    const total = list.reduce((sum, x) => sum + x.score, 0);
    out.push({
      topic,
      latest: list[0].score,
      average: Math.round((total / list.length) * 10) / 10,
      times: list.length,
      lastOn: list[0].on,
    });
  }

  // Weakest first — lowest latest score, then lowest average.
  return out.sort((a, b) => a.latest - b.latest || a.average - b.average);
}
