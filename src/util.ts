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
