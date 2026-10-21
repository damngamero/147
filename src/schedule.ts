import * as db from './db';
import { chapterById, emit, logsOf, store, subjectById, topicById, topicsOf } from './state';
import type { Blurt, BlurtCycle, Chapter, ClassLog, ID, ISODate, Topic } from './types';
import {
  CHAPTER_PART_GAP,
  CHAPTER_PART_MAX_SUBTOPICS,
  CHAPTER_REPEAT_GAP,
  CLASS_REPEAT_GAP,
  CLASS_REPEATS_BEFORE_MONTHLY,
  DRILL_COOLDOWN_DAYS,
  DRILL_PER_DAY,
  MONTHLY_GAP,
  R147_GAPS,
  addDays,
  attemptsToScore,
  daysBetween,
  todayISO,
} from './util';

const LADDER_CYCLES: Array<Extract<BlurtCycle, 'r1' | 'r4' | 'r7'>> = ['r1', 'r4', 'r7'];

export const CYCLE_LABEL: Record<BlurtCycle, string> = {
  r1: 'blurt 1',
  r4: 'blurt 2',
  r7: 'blurt 3',
  weekly: 'every 2 weeks',
  monthly: 'monthly',
  fortnightly: 'every 3 weeks',
  daily: 'daily practice',
};

export const CYCLE_SHORT: Record<BlurtCycle, string> = {
  r1: '1',
  r4: '4',
  r7: '7',
  weekly: '2wk',
  monthly: 'mth',
  fortnightly: '3wk',
  daily: 'day',
};

/* ---------- queries ---------- */

export const blurtById = (id: ID) => store.blurts.find((b) => b.id === id);

export const blurtsFor = (kind: Blurt['kind'], refId: ID) =>
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

/**
 * Due tomorrow but fine to do today. Blurting ahead defeats the 1-4-7 gap, so
 * this is narrow: a chapter blurt (the next part of a split chapter opens the
 * moment the previous one is done — tomorrow is the fallback, not a lock — and
 * a day early on a three-week gap costs nothing), or anything that was only
 * pushed to tomorrow from a day that has already come.
 */
export function canDoEarly(b: Blurt, today: ISODate = todayISO()): boolean {
  if (b.status !== 'due' || b.dueDate <= today || b.dueDate > addDays(today, 1)) return false;
  return b.kind === 'chapter' || (!!b.snoozedFrom && b.snoozedFrom <= today);
}

/** What Today offers as "ready now, or tomorrow". */
export function readyEarly(today: ISODate = todayISO()): Blurt[] {
  return openBlurts().filter((b) => canDoEarly(b, today));
}

/** Blurting ahead defeats the point, so the UI refuses anything not yet due — bar canDoEarly. */
export function isActionable(b: Blurt): boolean {
  return b.status === 'due' && (b.dueDate <= todayISO() || canDoEarly(b));
}

export function doneOnDate(date: ISODate): Blurt[] {
  return store.blurts.filter((b) => b.doneOn === date && isResolved(b));
}

/* ---------- ladders, per class ---------- */

function ladderOf(logId: ID): Blurt[] {
  return LADDER_CYCLES.map((c) => blurtById(`b_${logId}_${c}`)).filter((b): b is Blurt => !!b);
}

export function ladderResolved(log: ClassLog): boolean {
  const l = ladderOf(log.id);
  return l.length === LADDER_CYCLES.length && l.every(isResolved);
}

export function ladderProgress(log: ClassLog): { done: number; total: number } {
  return { done: ladderOf(log.id).filter(isResolved).length, total: LADDER_CYCLES.length };
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

/* ---------- daily drill (practice subjects) ---------- */

/** True for a subject that practises daily instead of blurting — maths, typically. */
export function isDrillSubject(subjectId: ID): boolean {
  return subjectById(subjectId)?.drill === true;
}

/** Today's drill items, as rows for the Today page. */
export function drillsToday(): Blurt[] {
  const today = todayISO();
  return store.blurts.filter((b) => b.kind === 'topic' && b.dueDate === today);
}

/** The last day a topic was actually drilled, so the picker can rotate off it. */
function lastDrilledOn(topicId: ID): ISODate | null {
  const days = store.blurts
    .filter((b) => b.kind === 'topic' && b.refId === topicId && isResolved(b))
    .map((b) => b.doneOn ?? b.dueDate);
  return days.length ? days.sort().at(-1)! : null;
}

/**
 * Picks topics to fill out one day's drill: weakest first, but rotating off
 * anything practised in the last couple of days so the same three don't lock
 * in forever. An unrated topic counts as the weakest there is — it has never
 * been shown to be solid. Only topics actually taught in a logged class are
 * eligible; a topic nobody has covered yet has nothing to practise.
 *
 * `want` is however many slots are still empty today, and `taken` is what
 * already has a row — finishing one must never conjure a replacement, or the
 * day never ends.
 */
function pickDrillTopics(today: ISODate, want: number, taken: Set<ID>): Topic[] {
  if (want <= 0) return [];
  const eligible = store.topics.filter(
    (t) => isDrillSubject(t.subjectId) && !taken.has(t.id) && !!classForTopic(t.id),
  );
  if (!eligible.length) return [];

  const latest = new Map(topicScores().map((s) => [s.topic.id, s.latest]));
  const rank = (t: Topic) => {
    const drilled = lastDrilledOn(t.id);
    return {
      weakness: latest.get(t.id) ?? 0,
      staleness: drilled ? daysBetween(drilled, today) : Number.MAX_SAFE_INTEGER,
      drilled,
    };
  };

  // Prefer topics off cooldown; fall back to the whole set when there aren't enough.
  const fresh = eligible.filter((t) => {
    const d = lastDrilledOn(t.id);
    return !d || daysBetween(d, today) >= DRILL_COOLDOWN_DAYS;
  });
  const pool = fresh.length >= want ? fresh : eligible;

  return [...pool]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra.weakness - rb.weakness || rb.staleness - ra.staleness;
    })
    .slice(0, want);
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

/* ---------- chapter parts ---------- */

/** How much of a part a topic takes up: its sub topics, or one if it has none. */
export const topicLoad = (t: Topic) => Math.max(1, t.subtopics?.length ?? 0);

/**
 * Packs what is left of a chapter, in order, into parts of whole topics, each
 * holding at most CHAPTER_PART_MAX_SUBTOPICS. A topic that would push a part
 * over goes to the next one instead — rounding down, never splitting a topic.
 * One topic bigger than the limit on its own still gets a part to itself.
 * Hands back the first part and how many parts the rest works out to.
 */
function planParts(remaining: Topic[]): { next: ID[]; parts: number } {
  const chunks: ID[][] = [];
  let load = CHAPTER_PART_MAX_SUBTOPICS;
  for (const t of remaining) {
    const w = topicLoad(t);
    if (load + w > CHAPTER_PART_MAX_SUBTOPICS) {
      chunks.push([]);
      load = 0;
    }
    chunks.at(-1)!.push(t.id);
    load += w;
  }
  return { next: chunks[0] ?? [], parts: Math.max(1, chunks.length) };
}

/** Every part of the round this chapter blurt belongs to, in order. */
export function roundOf(b: Blurt): Blurt[] {
  if (b.kind !== 'chapter') return [b];
  return blurtsFor('chapter', b.refId)
    .filter((x) => x.seq === b.seq)
    .sort((x, y) => (x.part ?? 1) - (y.part ?? 1));
}

/** "part 2 of 3" for a split chapter blurt, empty for anything else. */
export function partLabel(b: Blurt): string {
  return b.kind === 'chapter' && (b.parts ?? 1) > 1 ? `part ${b.part ?? 1} of ${b.parts}` : '';
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

  // Blurts whose class, chapter or topic no longer exists.
  const liveRefs = new Set([
    ...store.logs.map((l) => l.id),
    ...store.chapters.map((c) => c.id),
    ...store.topics.map((t) => t.id),
  ]);
  for (const b of [...store.blurts]) {
    const legacy = b.kind !== 'class' && b.kind !== 'chapter' && b.kind !== 'topic';
    if (legacy || !liveRefs.has(b.refId)) drop(p, b.id);
  }

  // A drill subject schedules no class or chapter blurts at all — practice
  // replaces them outright. Anything still open from before the toggle went on
  // is cleared out; anything already done or skipped stays as history.
  for (const b of [...store.blurts]) {
    if (b.kind === 'topic' || b.status !== 'due') continue;
    if (isDrillSubject(b.subjectId)) drop(p, b.id);
  }

  // Yesterday's unfinished drill does not carry over. Daily practice is a habit,
  // not a debt — letting misses pile up recreates exactly the backlog this is
  // meant to avoid.
  for (const b of [...store.blurts]) {
    if (b.kind === 'topic' && b.status === 'due' && b.dueDate !== today) drop(p, b.id);
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
    if (isDrillSubject(log.subjectId)) continue;
    const ch = chapterById(log.chapterId);
    const graduated = !!ch?.fortnightlyFrom;

    // One 1-4-7 ladder per class — every topic in it comes up together.
    // Each step chains off the ACTUAL resolution of the one before it, not a
    // fixed offset from the class date: blurt 1 is class+1, blurt 2 is
    // whenever-blurt-1-got-done+4, blurt 3 is whenever-blurt-2-got-done+7.
    // Doing a step late slides everything after it — that's the point of a
    // chained ladder instead of three independent deadlines.
    const r1Id = `b_${log.id}_r1`;
    const r4Id = `b_${log.id}_r4`;
    const r7Id = `b_${log.id}_r7`;

    // A class logged well after the fact (backdated past the whole ladder's
    // total span) would otherwise dump all three overdue steps into Today at
    // once. If nothing in the ladder exists yet and the class is already
    // older than the full 1+4+7 span, skip straight to "resolved" instead —
    // the class jumps straight onto weekly (or fortnightly, if the chapter
    // already qualifies) rather than making today re-litigate three blurts
    // for something learned weeks ago.
    const ladderIsFresh = !blurtById(r1Id) && !blurtById(r4Id) && !blurtById(r7Id);
    const totalSpan = R147_GAPS.r1 + R147_GAPS.r4 + R147_GAPS.r7;
    const backdatedPastLadder = ladderIsFresh && addDays(log.date, totalSpan) < today;

    function chainStep(
      id: string,
      cycle: Extract<BlurtCycle, 'r1' | 'r4' | 'r7'>,
      base: ISODate,
      gap: number,
    ): void {
      const existing = blurtById(id);
      if (existing) return;
      const b = newBlurt({
        id,
        kind: 'class',
        refId: log.id,
        subjectId: log.subjectId,
        chapterId: log.chapterId,
        dueDate: addDays(base, gap),
        cycle,
        seq: 0,
      });
      if (backdatedPastLadder) {
        b.status = 'missed';
        b.doneOn = today;
        b.dueDate = today;
      }
      upsert(p, b);
    }

    // r1 anchors to the class date — edited class dates still move it while it's open.
    if (!blurtById(r1Id)) {
      chainStep(r1Id, 'r1', log.date, R147_GAPS.r1);
    } else {
      const r1 = blurtById(r1Id)!;
      const want = addDays(log.date, R147_GAPS.r1);
      if (r1.status === 'due' && r1.dueDate !== want) {
        r1.dueDate = want;
        upsert(p, r1);
      }
    }

    const r1 = blurtById(r1Id);
    if (r1 && isResolved(r1)) chainStep(r4Id, 'r4', r1.doneOn ?? r1.dueDate, R147_GAPS.r4);

    const r4 = blurtById(r4Id);
    if (r4 && isResolved(r4)) chainStep(r7Id, 'r7', r4.doneOn ?? r4.dueDate, R147_GAPS.r7);

    // The long tail of a class: a two-week repeat first, then — once two of
    // those have been resolved, so roughly a month of holding onto it — a
    // monthly one. Both are the same "one open repeat at a time" cycle, just
    // on a longer gap, so they are generated together and counted together.
    const repeats = blurtsFor('class', log.id).filter(
      (b) => b.cycle === 'weekly' || b.cycle === 'monthly',
    );
    const cleared = ladderResolved(log);

    // Cleared the ladder and the chapter has not taken over yet -> repeats.
    if (!cleared || graduated) {
      for (const b of repeats) if (b.status === 'due') drop(p, b.id);
      continue;
    }

    if (!repeats.some((b) => b.status === 'due')) {
      const base = lastResolvedDate([...repeats, ...ladderOf(log.id)]);
      if (base) {
        // Skipping counts as resolving everywhere else in the app, so it counts
        // here too — two cleared two-week repeats graduate the class either way.
        const twoWeekly = repeats.filter((b) => b.cycle === 'weekly');
        const graduatedToMonthly =
          twoWeekly.filter(isResolved).length >= CLASS_REPEATS_BEFORE_MONTHLY;
        const monthly = repeats.filter((b) => b.cycle === 'monthly');
        const seq = (graduatedToMonthly ? monthly.length : twoWeekly.length) + 1;
        upsert(
          p,
          newBlurt({
            id: `b_${log.id}_${graduatedToMonthly ? 'm' : 'w'}${seq}`,
            kind: 'class',
            refId: log.id,
            subjectId: log.subjectId,
            chapterId: log.chapterId,
            dueDate: addDays(base, graduatedToMonthly ? MONTHLY_GAP : CLASS_REPEAT_GAP),
            cycle: graduatedToMonthly ? 'monthly' : 'weekly',
            seq,
          }),
        );
      }
    }
  }

  // Fortnightly chapter blurts, split into parts of at most
  // CHAPTER_PART_MAX_SUBTOPICS. One round of a big chapter is several parts on
  // consecutive days, each chained off the previous part's resolution; the
  // next round's three-week gap counts from whenever the LAST part was done.
  for (const ch of store.chapters) {
    if (!ch.fortnightlyFrom || isDrillSubject(ch.subjectId)) continue;
    const mine = blurtsFor('chapter', ch.id);
    const topics = topicsOf(ch.id);

    // An open part nobody has started rating yet is re-packed against the
    // chapter as it stands now — so adding sub topics, or a row from before
    // parts existed that still covers the whole chapter, gets cut to size.
    // Once a rating is in, the part is frozen so the progress keeps its topics.
    for (const b of mine) {
      if (b.status !== 'due' || Object.keys(b.scores ?? {}).length) continue;
      const part = b.part ?? 1;
      const earlier = new Set(
        mine
          .filter((x) => x.seq === b.seq && (x.part ?? 1) < part)
          .flatMap((x) => x.topicIds ?? []),
      );
      const plan = planParts(topics.filter((t) => !earlier.has(t.id)));
      const parts = part - 1 + plan.parts;
      if (
        b.part === part &&
        b.parts === parts &&
        b.topicIds?.length === plan.next.length &&
        b.topicIds.every((id, i) => id === plan.next[i])
      ) {
        continue;
      }
      b.topicIds = plan.next;
      b.part = part;
      b.parts = parts;
      upsert(p, b);
    }

    if (mine.some((b) => b.status === 'due')) continue;

    const round = Math.max(0, ...mine.map((b) => b.seq));
    const current = mine.filter((b) => b.seq === round);
    const last = current.sort((a, b) => (a.part ?? 1) - (b.part ?? 1)).at(-1);

    // Mid-round: whatever earlier parts have not covered yet, including any
    // topic added since the round started.
    if (last && (last.part ?? 1) < (last.parts ?? 1)) {
      const covered = new Set(current.flatMap((b) => b.topicIds ?? []));
      const plan = planParts(topics.filter((t) => !covered.has(t.id)));
      if (plan.next.length) {
        const part = (last.part ?? 1) + 1;
        upsert(
          p,
          newBlurt({
            id: `b_${ch.id}_f${round}_p${part}`,
            kind: 'chapter',
            refId: ch.id,
            subjectId: ch.subjectId,
            chapterId: ch.id,
            dueDate: addDays(lastResolvedDate(current) ?? today, CHAPTER_PART_GAP),
            cycle: 'fortnightly',
            seq: round,
            topicIds: plan.next,
            part,
            parts: part - 1 + plan.parts,
          }),
        );
        continue;
      }
    }

    const base = lastResolvedDate(mine) ?? ch.fortnightlyFrom;
    const seq = round + 1;
    const plan = planParts(topics);
    upsert(
      p,
      newBlurt({
        id: `b_${ch.id}_f${seq}`,
        kind: 'chapter',
        refId: ch.id,
        subjectId: ch.subjectId,
        chapterId: ch.id,
        dueDate: addDays(base, CHAPTER_REPEAT_GAP),
        cycle: 'fortnightly',
        seq,
        topicIds: plan.next,
        part: 1,
        parts: plan.parts,
      }),
    );
  }

  // Today's drill. The quota counts rows that ALREADY exist for today whatever
  // their status, so finishing or skipping one never pulls a replacement in
  // behind it — three a day means three, not three-at-a-time forever. The id
  // is deterministic so this stays idempotent and two devices agree on it.
  const drillsForToday = store.blurts.filter((b) => b.kind === 'topic' && b.dueDate === today);
  const doneToday = drillsForToday.filter(isResolved);
  const openToday = drillsForToday
    .filter((b) => b.status === 'due')
    .sort((a, b) => a.createdAt - b.createdAt);

  // Trim any surplus left over from an earlier build that topped the list back
  // up every time one was finished. Resolved rows are real work and are never
  // touched; only unstarted extras past the quota go.
  const allowedOpen = Math.max(0, DRILL_PER_DAY - doneToday.length);
  for (const b of openToday.slice(allowedOpen)) drop(p, b.id);

  const kept = doneToday.length + Math.min(openToday.length, allowedOpen);
  const alreadyDrilled = new Set(drillsForToday.map((b) => b.refId));
  for (const t of pickDrillTopics(today, DRILL_PER_DAY - kept, alreadyDrilled)) {
    const id = `b_daily_${today}_${t.id}`;
    if (blurtById(id)) continue;
    upsert(
      p,
      newBlurt({
        id,
        kind: 'topic',
        refId: t.id,
        subjectId: t.subjectId,
        chapterId: t.chapterId,
        dueDate: today,
        cycle: 'daily',
        seq: 0,
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

/**
 * Drops every still-open (not yet resolved) blurt that gets *derived* from an
 * earlier one — the chained r4/r7 steps and the recurring class/chapter
 * repeats — and reruns the sync so they regenerate under the current gaps and
 * chaining rules. This is the manual fix-up for blurts that were scheduled
 * before a timing change: without it, anything already on the calendar keeps
 * its old date forever and only new ones pick up the new spacing. Nothing
 * already resolved is touched, so history and scores stay put.
 */
export async function refreshLadders(): Promise<void> {
  const stale = store.blurts.filter(
    (b) => b.status === 'due' && b.cycle !== 'r1',
  );
  const ids = stale.map((b) => b.id);
  store.blurts = store.blurts.filter((b) => !ids.includes(b.id));
  await db.delMany('blurts', ids);
  await syncSchedule();
  emit();
}

/* ---------- what a blurt covers ---------- */

/** The topics a blurt asks you to recall. */
export function topicsForBlurt(b: Blurt): Topic[] {
  if (b.kind === 'topic') {
    const t = topicById(b.refId);
    return t ? [t] : [];
  }
  if (b.kind === 'chapter') {
    const all = topicsOf(b.refId);
    if (!b.topicIds) return all;
    const mine = new Set(b.topicIds);
    return all.filter((t) => mine.has(t.id));
  }
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

/**
 * Keeps ratings given so far on an unfinished blurt, so walking away halfway
 * through a part doesn't lose them. Each part is its own row, so P1, P2 and P3
 * hold their progress separately. Nothing reads scores off an open blurt for
 * weak spots, so a draft never counts until the part is actually finished.
 */
export async function saveDraftScores(id: ID, scores: Record<ID, number>): Promise<void> {
  const b = blurtById(id);
  if (!b || b.status !== 'due') return;
  b.scores = { ...scores };
  await db.put('blurts', b);
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

/**
 * Finishes a drill: how many questions were worked, and how many attempts they
 * generally took. The attempts land on the same 1-5 scale everything else uses
 * so maths topics rank in the one Weak spots list, while the raw count is kept
 * for the topic's own history.
 */
export async function completeDrill(
  id: ID,
  questionsDone: number,
  attempts: number,
): Promise<void> {
  const b = blurtById(id);
  if (!b || !isActionable(b)) return;
  const score = attemptsToScore(attempts);
  b.status = 'done';
  b.doneOn = todayISO();
  b.questionsDone = questionsDone;
  b.attempts = attempts;
  b.scores = { [b.refId]: score };
  b.score = score;
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
  if (!b.snoozedFrom) b.snoozedFrom = b.dueDate;
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
