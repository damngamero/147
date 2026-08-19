/**
 * Keeps a dedicated "147" calendar in the phone's own Calendar app in step
 * with the schedule — Android only, no account, no network.
 *
 * This is deliberately separate from cloud sync: it talks to the native
 * Calendar Provider plugin (CalendarPlugin.java), which maintains a LOCAL
 * calendar not tied to any Google/Samsung account. That is what keeps it out
 * of the way of real classes and events — it shows up as its own row in
 * Samsung Calendar's calendar list, hideable with one tap, and never mixes
 * with anything else on the device.
 */
import { CYCLE_LABEL, openBlurts, topicsForBlurt } from './schedule';
import { chapterById, subjectById } from './state';
import type { Blurt } from './types';

interface Calendar147Plugin {
  hasPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  sync(opts: { events: Array<{ title: string; notes: string; date: string }> }): Promise<{ written: number }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { Calendar147?: Calendar147Plugin };
}

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Only Android has a Calendar Provider to write to. */
export function syscalSupported(): boolean {
  const c = cap();
  return !!c?.isNativePlatform?.() && c.getPlatform?.() === 'android' && !!c.Plugins?.Calendar147;
}

function plugin(): Calendar147Plugin | null {
  return cap()?.Plugins?.Calendar147 ?? null;
}

export async function syscalHasPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  return (await p.hasPermission()).granted;
}

export async function syscalRequestPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  return (await p.requestPermission()).granted;
}

function methodOf(b: Blurt): 'blurt' | 'questions' {
  return chapterById(b.chapterId)?.method ?? 'blurt';
}

function titleOf(b: Blurt): string {
  const verb = methodOf(b) === 'questions' ? 'Questions' : 'Blurt';
  if (b.kind === 'chapter') return `${verb}: ${chapterById(b.refId)?.name ?? 'chapter'} (whole chapter)`;
  const names = topicsForBlurt(b).map((t) => t.name);
  if (!names.length) return `${verb}: class`;
  const shown = names.slice(0, 3).join(', ');
  return `${verb}: ${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
}

function notesOf(b: Blurt): string {
  const subject = subjectById(b.subjectId)?.name ?? '';
  const chapter = chapterById(b.chapterId)?.name ?? '';
  const names = topicsForBlurt(b).map((t) => `• ${t.name}`);
  const questions = methodOf(b) === 'questions';
  return [
    `${CYCLE_LABEL[b.cycle]}${b.kind === 'chapter' ? ' — whole chapter' : ' — whole class, all together'}`,
    [subject, chapter].filter(Boolean).join(' / '),
    '',
    ...names,
    '',
    questions
      ? 'Work through practice questions on paper, then rate each one in 147.'
      : 'Blurt these on paper, then rate each one in 147.',
  ].join('\n');
}

export interface SyscalStatus {
  lastPush: number | null;
  pushing: boolean;
  error: string | null;
}

const status: SyscalStatus = { lastPush: null, pushing: false, error: null };
let onDone: (() => void) | null = null;

export function syscalStatus(): SyscalStatus {
  return { ...status };
}

export function onSyscalChange(fn: () => void): void {
  onDone = fn;
}

/** Full replace, run natively — see CalendarPlugin.sync(). Always up to date, never stale. */
export async function pushSyscal(): Promise<{ ok: boolean; message: string }> {
  const p = plugin();
  if (!p) return { ok: false, message: 'Not available on this platform.' };
  if (!(await syscalHasPermission())) {
    return { ok: false, message: 'Calendar permission not granted.' };
  }

  status.pushing = true;
  onDone?.();
  try {
    const events = openBlurts().map((b) => ({
      title: titleOf(b),
      notes: notesOf(b),
      date: b.dueDate,
    }));
    const res = await p.sync({ events });
    status.error = null;
    status.lastPush = Date.now();
    return { ok: true, message: `147 calendar: ${res.written} event${res.written === 1 ? '' : 's'} up to date.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.error = message;
    return { ok: false, message };
  } finally {
    status.pushing = false;
    onDone?.();
  }
}

const ENABLED_KEY = '147_syscal_on';

export function syscalEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function setSyscalEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
}

let timer: number | undefined;

/** Debounced, same pattern as cloud sync — fires a few seconds after any change. */
export function syscalSoon(): void {
  if (!syscalSupported() || !syscalEnabled()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void pushSyscal(), 6000);
}
