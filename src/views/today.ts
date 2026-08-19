import { doneOnDate, dueBy, reopenBlurt, skipBlurt, snoozeBlurt } from '../schedule';
import { dayLog, saveDayLog, store } from '../state';
import { confirmBox, onAct, toast } from '../ui';
import { esc, fmtDate, todayISO } from '../util';
import { blurtRow, labelFor, section } from './parts';

export function render(): string {
  const today = todayISO();

  // Only ever today's work. Nothing scheduled for a future date is shown or
  // reachable — blurting early throws away the gap that makes 1-4-7 work.
  const due = dueBy(today);
  const late = due.filter((b) => b.dueDate < today);
  const doneToday = doneOnDate(today);
  const note = dayLog(today)?.note ?? '';
  const doneNames = doneToday.map((b) => labelFor(b).title);

  return `
    <h1>${fmtDate(today)}</h1>

    <div class="stat-grid">
      <div class="stat ${due.length ? '' : 'good'}"><div class="n">${due.length}</div><div class="k">To blurt</div></div>
      <div class="stat ${late.length ? 'bad' : ''}"><div class="n">${late.length}</div><div class="k">Carried over</div></div>
      <div class="stat ${doneToday.length ? 'good' : ''}"><div class="n">${doneToday.length}</div><div class="k">Cleared</div></div>
    </div>

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
        ? section('Cleared today', doneToday.length, doneToday.map((b) => blurtRow(b, 'done')).join(''))
        : ''
    }

    <h2>What I got done today</h2>
    <div class="card">
      <div class="field" style="margin-bottom:10px">
        <label>Anything worth remembering about today</label>
        <textarea data-f="daynote">${esc(note)}</textarea>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="save-day">Save note</button>
        ${doneNames.length ? '<button class="btn ghost" data-act="fill-day">Fill from what I cleared</button>' : ''}
        <span class="spacer"></span>
        <a class="btn" href="#/log">+ Log a class</a>
      </div>
      ${
        doneNames.length
          ? `<div class="chips">${doneNames.map((n) => `<span class="pill good">${esc(n)}</span>`).join('')}</div>`
          : ''
      }
    </div>`;
}

export function wire(root: HTMLElement): void {
  const area = root.querySelector<HTMLTextAreaElement>('[data-f="daynote"]');
  const today = todayISO();

  onAct(root, async (act, el) => {
    const id = el.dataset.id ?? '';

    if (act === 'open') location.hash = `#/blurt/${id}`;
    if (act === 'reopen') await reopenBlurt(id);
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

    if (act === 'save-day' && area) {
      await saveDayLog(today, area.value);
      toast('Saved');
    }
    if (act === 'fill-day' && area) {
      const line = `Blurted: ${doneOnDate(today).map((b) => labelFor(b).title).join('; ')}`;
      area.value = area.value.trim() ? `${area.value.trim()}\n${line}` : line;
      await saveDayLog(today, area.value);
    }
  });

  area?.addEventListener('blur', () => {
    const current = dayLog(today)?.note ?? '';
    if (area.value !== current) void saveDayLog(today, area.value);
  });
}
