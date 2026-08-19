import { rerender } from '../app';
import {
  CYCLE_LABEL,
  blurtById,
  blurtsFor,
  completeBlurt,
  isActionable,
  skipBlurt,
  snoozeBlurt,
  topicsForBlurt,
} from '../schedule';
import { chapterById, store, subjectById } from '../state';
import type { ID } from '../types';
import { onAct, toast } from '../ui';
import { esc, fmtDate, relDay } from '../util';

/** Ratings for the session in progress, per topic. */
let sessionId = '';
let scores: Record<ID, number> = {};
let revealed = false;

function reset(id: string): void {
  if (sessionId === id) return;
  sessionId = id;
  scores = { ...(blurtById(id)?.scores ?? {}) };
  revealed = false;
}

const SCORE_WORDS: Record<number, string> = {
  1: 'blank',
  2: 'shaky',
  3: 'patchy',
  4: 'solid',
  5: 'nailed it',
};

/** What was written down in class, for checking the paper blurt against. */
function classNotes(refKind: 'class' | 'chapter', refId: string): string {
  const logs =
    refKind === 'chapter'
      ? store.logs.filter((l) => l.chapterId === refId)
      : store.logs.filter((l) => l.id === refId);

  const body = logs
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => `<div class="daygroup">${fmtDate(l.date)}</div><div>${esc(l.what || '—')}</div>`)
    .join('');
  return body || '<div class="dim">No class notes saved.</div>';
}

function historyHtml(kind: 'class' | 'chapter', refId: string, currentId: string): string {
  const past = blurtsFor(kind, refId)
    .filter((b) => b.id !== currentId && b.status !== 'due')
    .sort((a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? ''));
  if (!past.length) return '<div class="empty small">First time round.</div>';
  return past
    .map(
      (b) => `
      <div class="row">
        <span class="grow">
          <div class="title">${CYCLE_LABEL[b.cycle]}
            <span class="pill ${b.status === 'missed' ? 'warn' : 'good'}">${b.status}</span>
          </div>
          <div class="sub">${b.doneOn ? fmtDate(b.doneOn) : ''}${
            b.score ? ` · averaged ${b.score}/5` : ''
          }</div>
        </span>
      </div>`,
    )
    .join('');
}

export function render(id: string): string {
  const b = blurtById(id);
  if (!b) return '<div class="empty">Blurt not found. <a href="#/today">Back to today</a></div>';

  if (!isActionable(b)) {
    return `
      <div class="empty">
        This one is not due until <b>${fmtDate(b.dueDate)}</b> (${relDay(b.dueDate)}).<br /><br />
        Doing it early wastes the gap that makes spacing work — come back on the day.<br /><br />
        <a class="btn primary" href="#/today">Back to today</a>
      </div>`;
  }

  reset(id);

  const s = subjectById(b.subjectId);
  const c = chapterById(b.chapterId);
  const topics = topicsForBlurt(b);
  const log = b.kind === 'class' ? store.logs.find((l) => l.id === b.refId) : undefined;
  const rated = Object.keys(scores).length;
  const questions = c?.method === 'questions';
  const verb = questions ? 'Work practice questions' : 'Blurt these';

  const rows = topics
    .map(
      (t) => `
      <div class="rate-row">
        <div class="rate-name">${esc(t.name)}</div>
        <div class="score">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `
            <button class="btn sm ${scores[t.id] === n ? 'on' : ''}"
                    data-act="score" data-topic="${t.id}" data-n="${n}"
                    title="${SCORE_WORDS[n]}">${n}</button>`,
            )
            .join('')}
        </div>
      </div>`,
    )
    .join('');

  return `
    <div class="crumb">
      <a href="#/today">Today</a> /
      <a href="#/chapter/${b.chapterId}">${esc(c?.name ?? '?')}</a>
    </div>

    <h1>
      <span class="dot" style="background:${s?.color ?? '#666'};display:inline-block;margin-right:8px"></span>
      ${b.kind === 'chapter' ? esc(c?.name ?? 'Chapter') : `Class of ${log ? fmtDate(log.date) : '?'}`}
    </h1>

    <div class="chips" style="margin-bottom:14px">
      <span class="pill accent">${CYCLE_LABEL[b.cycle]}</span>
      <span class="pill">${b.kind === 'chapter' ? 'whole chapter' : 'whole class'}</span>
      <span class="pill">${esc(s?.name ?? '')} · ${esc(c?.name ?? '')}</span>
    </div>

    <div class="card">
      <div class="title">${verb} on paper, all together</div>
      <p class="muted small" style="margin-top:6px">
        ${topics.length} topic${topics.length === 1 ? '' : 's'} from this
        ${b.kind === 'chapter' ? 'chapter' : 'class'}.
        ${
          questions
            ? 'Work through practice questions for each, then come back and say how each one went.'
            : 'Write out everything you remember, then come back and say how each one went.'
        }
      </p>
      <div class="chips">
        ${
          topics.length
            ? topics.map((t) => `<span class="pill">${esc(t.name)}</span>`).join('')
            : '<span class="dim small">No topics recorded for this one.</span>'
        }
      </div>
    </div>

    <div class="card">
      <div class="title">How did each go?</div>
      <p class="muted small" style="margin-top:6px">1 = blank, 5 = nailed it. This is what builds
      your weak-spot list — it is the only thing the app needs from you.</p>
      ${topics.length ? `<div class="rate-list">${rows}</div>` : ''}

      <div class="actions" style="margin-top:16px">
        <button class="btn primary" data-act="save" ${
          topics.length && rated < topics.length ? 'disabled' : ''
        }>
          ${
            topics.length && rated < topics.length
              ? `Rate all ${topics.length} to finish (${rated}/${topics.length})`
              : 'Done'
          }
        </button>
        <button class="btn" data-act="reveal">${revealed ? 'Hide notes' : questions ? 'Check answers / class notes' : 'Check class notes'}</button>
        <span class="spacer"></span>
        <button class="btn ghost" data-act="snooze">Tomorrow</button>
        <button class="btn ghost danger" data-act="skip">Skip</button>
      </div>

      ${revealed ? `<div class="divider"></div><div class="reveal">${classNotes(b.kind, b.refId)}</div>` : ''}
    </div>

    <h2>Past rounds</h2>
    ${historyHtml(b.kind, b.refId, b.id)}`;
}

export function wire(root: HTMLElement, id: string): void {
  onAct(root, async (act, el) => {
    if (act === 'score') {
      const topic = el.dataset.topic!;
      const n = Number(el.dataset.n);
      if (scores[topic] === n) delete scores[topic];
      else scores[topic] = n;
      rerender();
    }
    if (act === 'reveal') {
      revealed = !revealed;
      rerender();
    }
    if (act === 'save') {
      await completeBlurt(id, scores);
      sessionId = '';
      toast('Logged');
      location.hash = '#/today';
    }
    if (act === 'skip') {
      await skipBlurt(id);
      sessionId = '';
      location.hash = '#/today';
    }
    if (act === 'snooze') {
      await snoozeBlurt(id, 1);
      sessionId = '';
      toast('Pushed to tomorrow');
      location.hash = '#/today';
    }
  });
}
