import { rerender } from '../app';
import { doneOnDate, dueBy, reopenBlurt, skipAllLate, skipBlurt } from '../schedule';
import { store } from '../state';
import { confirmBox, onAct, toast } from '../ui';
import { fmtDate, todayISO } from '../util';
import { blurtRow, section } from './parts';

/** Only relevant once a pile of overdue stuff shows up — a fresh backdated class or two. */
const SKIP_ALL_THRESHOLD = 10;

/**
 * Most blurts to put in front of you in one day. Everything still due stays
 * due — this only caps how much the page asks of you at once, so a backlog
 * doesn't turn into an unbounded wall. Clear the batch and it offers you the
 * next one rather than silently topping the list back up to ten.
 */
const DAILY_CAP = 10;

/** Extra batches unlocked by hand today, keyed by date so tomorrow starts clean. */
function extraKey(date: string): string {
  return `147_extra_${date}`;
}
function extraToday(date: string): number {
  return Number(localStorage.getItem(extraKey(date)) ?? 0) || 0;
}
function unlockMore(date: string): void {
  localStorage.setItem(extraKey(date), String(extraToday(date) + DAILY_CAP));
}

/** Persists only for this tab session — not worth saving, it's a "get it out of my face" toggle. */
let hideCleared = false;

export function render(): string {
  const today = todayISO();

  // Only ever today's work. Nothing scheduled for a future date is shown or
  // reachable — blurting early throws away the gap that makes 1-4-7 work.
  const due = dueBy(today);
  const late = due.filter((b) => b.dueDate < today);
  const doneToday = doneOnDate(today);

  // Everything cleared today counts against the cap, so the list shrinks as you
  // work rather than refilling itself back up to ten from the backlog.
  const allowance = Math.max(0, DAILY_CAP + extraToday(today) - doneToday.length);
  const visible = due.slice(0, allowance);
  const heldBack = due.length - visible.length;

  return `
    <h1>${fmtDate(today)}</h1>

    <div class="stat-grid">
      <div class="stat ${due.length ? '' : 'good'}"><div class="n">${due.length}</div><div class="k">To blurt</div></div>
      <div class="stat ${late.length ? 'bad' : ''}"><div class="n">${late.length}</div><div class="k">Carried over</div></div>
      <div class="stat ${doneToday.length ? 'good' : ''}"><div class="n">${doneToday.length}</div><div class="k">Cleared</div></div>
    </div>

    ${
      late.length > SKIP_ALL_THRESHOLD
        ? `<div class="actions" style="margin-bottom:10px">
             <button class="btn ghost danger sm" data-act="skip-all-late">Skip all ${late.length} carried-over</button>
           </div>`
        : ''
    }

    ${section(
      'Today',
      visible.length,
      visible.length
        ? visible.map((b) => blurtRow(b)).join('')
        : `<div class="empty">${
            !store.blurts.length
              ? 'Log a class and the 1-4-7 blurts appear here.'
              : heldBack
                ? `That's ${doneToday.length} done today — the cap for one sitting.`
                : 'Nothing to blurt today. Enjoy it.'
          }</div>`,
    )}

    ${
      heldBack
        ? `<div class="card">
             <div class="setting-row" style="padding-top:0">
               <span class="grow">
                 <div class="title">${heldBack} more still due today</div>
                 <div class="sub">
                   Held back so today stays finishable. They keep until you want them — nothing is lost.
                 </div>
               </span>
               <button class="btn ${visible.length ? 'ghost' : 'primary'}" data-act="unlock-more">
                 Show ${Math.min(DAILY_CAP, heldBack)} more
               </button>
             </div>
           </div>`
        : ''
    }

    ${
      doneToday.length
        ? `<h2>Cleared today <span class="pill">${doneToday.length}</span>
             <button class="btn ghost sm" style="margin-left:8px" data-act="toggle-cleared">${hideCleared ? 'Show' : 'Hide'}</button>
           </h2>
           ${hideCleared ? '' : doneToday.map((b) => blurtRow(b, 'done')).join('')}`
        : ''
    }

    <div class="actions" style="margin-top:10px">
      <a class="btn" href="#/log">+ Log a class</a>
    </div>`;
}

export function wire(root: HTMLElement): void {
  const today = todayISO();

  onAct(root, async (act, el) => {
    const id = el.dataset.id ?? '';

    if (act === 'open') location.hash = `#/blurt/${id}`;
    if (act === 'reopen') await reopenBlurt(id);
    if (act === 'toggle-cleared') {
      hideCleared = !hideCleared;
      rerender();
    }
    if (act === 'unlock-more') {
      unlockMore(today);
      rerender();
    }
    if (act === 'skip-all-late') {
      const late = dueBy(today).filter((b) => b.dueDate < today);
      const yes = await confirmBox({
        title: `Skip all ${late.length} carried-over blurts?`,
        body: 'Every one of them counts as cleared and moves on to its next stage — this does not undo.',
        okLabel: 'Skip all',
        danger: true,
      });
      if (yes) {
        await skipAllLate();
        toast('Skipped.');
      }
    }
    if (act === 'menu') {
      // Dismissing this any way (Cancel, tapping outside, back gesture) does
      // nothing and leaves the blurt exactly as it was — it used to silently
      // push it to tomorrow on anything but an explicit "Skip it", which read
      // as blurts vanishing off Today for no reason.
      const skip = await confirmBox({
        title: 'Skip this one?',
        body: 'Counts it as cleared so the ladder keeps moving. Closing this without picking Skip leaves it untouched, still due today.',
        okLabel: 'Skip it',
        danger: true,
      });
      if (skip) await skipBlurt(id);
    }
  });
}
