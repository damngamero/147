import type { ISODate } from './types';

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Local-time yyyy-mm-dd (never UTC — a class logged at 11pm must stay on today). */
export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): ISODate {
  return toISO(new Date());
}

export function fromISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: ISODate): string {
  const d = fromISO(iso);
  return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
}

/** A class's display name — its custom name if it has one, else its date. Classes
 *  logged before names existed just keep showing the date they always have. */
export function classLabel(l: { name?: string; date: ISODate }): string {
  return l.name?.trim() ? l.name.trim() : fmtDate(l.date);
}

export function relDay(iso: ISODate): string {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n}d ago`;
  return `in ${n}d`;
}

/**
 * The 1-4-7 ladder, as gaps chained off the PREVIOUS step's actual resolution —
 * not fixed offsets from the class date. Blurt 1 is +1 day from the class;
 * blurt 2 is +4 days from whenever blurt 1 actually got done (late or not);
 * blurt 3 is +7 days from whenever blurt 2 actually got done. Doing a step
 * late slides everything after it, which is the whole point of chaining.
 */
export const R147_GAPS = { r1: 1, r4: 4, r7: 7 } as const;
/**
 * Once a class has cleared its 1-4-7 it repeats on this gap, and a graduated
 * chapter repeats on the longer one. Both counted from the last time that
 * blurt was actually resolved, not from a fixed calendar slot — the cycle
 * ids are still called 'weekly'/'fortnightly' in stored data for continuity.
 */
export const CLASS_REPEAT_GAP = 14;
export const CHAPTER_REPEAT_GAP = 21;

/**
 * A chapter blurt never asks for more than this many sub topics at once (a
 * topic with no sub topics counts as one). A bigger chapter is split into
 * parts of whole topics — a topic is never cut in half, so a part stops at
 * the last topic that still fits rather than spilling over. Each part comes
 * up PART_GAP days after the one before it was resolved. Blurting 60 things
 * in one sitting is not recall, it's endurance.
 */
export const CHAPTER_PART_MAX_SUBTOPICS = 20;
export const CHAPTER_PART_GAP = 1;

/** Sub topics are new: the chapter page flags them until this date, then the badge goes away. */
export const SUBTOPICS_NEW_UNTIL = '2026-11-21';

/**
 * A class does not stay on the two-week repeat forever. Once this many of them
 * have been resolved — two, so a month of holding it — the class drops to a
 * monthly repeat instead. Material you have recalled five separate times over
 * a month does not need fortnightly attention, and keeping it there is what
 * makes the daily load creep back up.
 */
export const CLASS_REPEATS_BEFORE_MONTHLY = 2;
export const MONTHLY_GAP = 30;

/**
 * A drill subject (maths) puts this many separate topics in front of you every
 * day, and won't offer a topic again for COOLDOWN days unless there aren't
 * enough others to fill the slots. Small on purpose: three questions a day is
 * a habit that survives, thirty is one that doesn't.
 */
export const DRILL_PER_DAY = 3;
export const DRILL_COOLDOWN_DAYS = 2;

/** Attempts (1-4, 4 meaning 4+, 0 meaning never got it) -> the same 1-5 scale everything else uses. */
export function attemptsToScore(attempts: number): number {
  if (attempts <= 0) return 1;
  if (attempts === 1) return 5;
  if (attempts === 2) return 4;
  if (attempts === 3) return 3;
  return 2;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export const PALETTE = [
  '#7c9cff', '#5ecfa8', '#f2a65a', '#e8c05a', '#c07cff', '#57c7e8', '#f2778c',
];

/** A subject's colour, checked — it syncs in from other devices, so it never goes into a style attribute raw. */
export function subjColor(c: string | undefined): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : '#8a94a8';
}

/** The style that colour-codes a `.row.coded` with its subject: a stripe down the left edge. */
export const codedStyle = (color: string | undefined) => `style="--subj:${subjColor(color)}"`;

/** The subject's name as a small tag tinted in its colour — tinted, not coloured text, so pale colours stay readable on Paper. */
export function subjTag(name: string | undefined, color: string | undefined): string {
  const c = subjColor(color);
  return `<span class="subj-tag" style="background:${c}2e;border-color:${c}80">${esc(name ?? '?')}</span>`;
}

/** What the subject colour picker offers up front — the auto palette plus a few more. Anything else via the free picker. */
export const SUBJECT_COLORS = [...PALETTE, '#ff5fa2', '#9bd65a', '#e86a4a', '#a3aab8'];
