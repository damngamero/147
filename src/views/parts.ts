import { CYCLE_SHORT, topicsForBlurt } from '../schedule';
import { chapterById, store, subjectById } from '../state';
import type { RevisionMethod } from '../types';
import type { Blurt } from '../types';
import { esc, fmtDate, relDay, todayISO } from '../util';

export interface BlurtLabel {
  title: string;
  sub: string;
  color: string;
}

export function labelFor(b: Blurt): BlurtLabel {
  const s = subjectById(b.subjectId);
  const c = chapterById(b.chapterId);
  if (b.kind === 'chapter') {
    return {
      title: c?.name ?? '(deleted chapter)',
      sub: `${s?.name ?? '?'} · whole chapter`,
      color: s?.color ?? '#666',
    };
  }
  // A class blurt is named by what it asks you to recall, not by its own id.
  const log = store.logs.find((l) => l.id === b.refId);
  const names = topicsForBlurt(b).map((t) => t.name);
  const title = names.length
    ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
    : 'Class with no topics';
  return {
    title,
    sub: `${s?.name ?? '?'} · ${c?.name ?? '?'}${log ? ` · class ${fmtDate(log.date)}` : ''}`,
    color: s?.color ?? '#666',
  };
}

function cyclePill(b: Blurt): string {
  const cls = b.cycle === 'fortnightly' ? 'pill last' : b.cycle === 'weekly' ? 'pill accent' : 'pill';
  return `<span class="${cls}" title="${b.cycle}">${CYCLE_SHORT[b.cycle]}</span>`;
}

function methodOf(b: Blurt): RevisionMethod {
  return chapterById(b.chapterId)?.method ?? 'blurt';
}

function methodPill(b: Blurt): string {
  return methodOf(b) === 'questions' ? '<span class="pill accent">Q</span>' : '';
}

export function blurtRow(b: Blurt, mode: 'open' | 'done' = 'open'): string {
  const l = labelFor(b);
  const late = b.dueDate < todayISO();
  const when =
    mode === 'done'
      ? `${b.status === 'missed' ? 'skipped' : 'done'} ${fmtDate(b.doneOn ?? b.dueDate)}`
      : `${fmtDate(b.dueDate)} · ${relDay(b.dueDate)}`;

  const buttons =
    mode === 'done'
      ? `<button class="btn sm ghost" data-act="reopen" data-id="${b.id}">Undo</button>`
      : `
        <button class="btn sm primary" data-act="open" data-id="${b.id}">${
          methodOf(b) === 'questions' ? 'Do it' : 'Blurt it'
        }</button>
        <button class="btn sm ghost" data-act="menu" data-id="${b.id}" title="More">&hellip;</button>`;

  return `
    <div class="row blurt ${late && mode === 'open' ? 'late' : ''}">
      <span class="dot" style="background:${l.color}"></span>
      <span class="grow">
        <div class="title">${esc(l.title)} ${cyclePill(b)} ${methodPill(b)}</div>
        <div class="sub">${esc(l.sub)} · <span class="${late && mode === 'open' ? 'overdue' : ''}">${when}</span>
          ${b.score ? ` · <span class="dim">${b.score}/5</span>` : ''}
        </div>
      </span>
      ${buttons}
    </div>`;
}

export function section(title: string, count: number, body: string): string {
  return `<h2>${title} ${count ? `<span class="pill">${count}</span>` : ''}</h2>${body}`;
}
