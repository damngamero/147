import { rerender } from '../app';
import { doneOnDate, dueBy, reopenBlurt, skipAllLate, skipBlurt, snoozeBlurt } from '../schedule';
import { store } from '../state';
import { confirmBox, onAct, toast } from '../ui';
import { fmtDate, todayISO } from '../util';
import { blurtRow, section } from './parts';

/** Only relevant once a pile of overdue stuff shows up — a fresh backdated class or two. */
const SKIP_ALL_THRESHOLD = 10;

/** Persists only for this tab session — not worth saving, it's a "get it out of my face" toggle. */
let hideCleared = false;

export function render(): string {
  const today = todayISO();

  // Only ever today's work. Nothing scheduled for a future date is shown or
  // reachable — blurting early throws away the gap that makes 1-4-7 work.
  const due = dueBy(today);
  const late = due.filter((b) => b.dueDate < today);
  const doneToday = doneOnDate(today);

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
      due.length,
      due.length
        ? due.map((b) => blurtRow(b)).join('')
        : `<div class="empty">${
            store.blurts.length
              ? 'Nothing to blurt today. Enjoy it.'
              : 'Log a class and the 1-4-7 blurts appear here.'
          }</div>`,
    )}

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
      const skip = await confirmBox({
        title: 'Not doing this one?',
        body: 'OK skips it for good — it still counts as cleared so the ladder keeps moving. Cancel pushes it to tomorrow instead.',
        okLabel: 'Skip it',
        danger: true,
      });
      if (skip) await skipBlurt(id);
      else await snoozeBlurt(id, 1);
    }
  });
}
