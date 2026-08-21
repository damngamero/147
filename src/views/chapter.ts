import {
  addTopic,
  chapterById,
  deleteChapter,
  deleteClassLog,
  deleteTopic,
  logById,
  logsOf,
  setLastTopic,
  subjectById,
  topicsOf,
  updateChapter,
  updateTopic,
} from '../state';
import { chapterQualifies, classForTopic, ladderProgress, ladderResolved } from '../schedule';
import { askText, confirmBox, onAct, toast } from '../ui';
import type { Topic } from '../types';
import { esc, fmtDate } from '../util';

export function render(id: string): string {
  const c = chapterById(id);
  if (!c) return '<div class="empty">Chapter not found.</div>';
  const s = subjectById(c.subjectId);
  const topics = topicsOf(c.id);
  const lastTopic = topics.find((t) => t.isLast) ?? null;
  const logs = logsOf(c.id);

  const topicRows = topics
    .map((t) => {
      const log = classForTopic(t.id);
      const p = log ? ladderProgress(log) : null;
      return `
      <div class="row">
        <span class="grow">
          <div class="title">${esc(t.name)} ${t.isLast ? '<span class="pill last">last topic</span>' : ''}</div>
          <div class="sub">
            ${t.taughtOn ? `taught ${fmtDate(t.taughtOn)}` : 'not taught in any logged class yet'}
            ${p ? `&middot; its class is ${p.done}/${p.total} through the 1-4-7` : ''}
          </div>
        </span>
        <button class="btn sm ghost" data-act="mark-last" data-id="${t.id}">${t.isLast ? 'Unmark' : 'Mark last'}</button>
        <button class="btn sm ghost" data-act="rename-topic" data-id="${t.id}">Edit</button>
        <button class="btn sm ghost danger" data-act="del-topic" data-id="${t.id}">&times;</button>
      </div>`;
    })
    .join('');

  const logRows = logs
    .map((l) => {
      const p = ladderProgress(l);
      return `
      <a class="row" href="#/log/${l.id}">
        <span class="grow">
          <div class="title">${fmtDate(l.date)}</div>
          <div class="sub">${l.what ? esc(l.what.slice(0, 90)) : '<span class="dim">no notes</span>'}</div>
        </span>
        <span class="pill ${p.done === p.total ? 'good' : ''}">1-4-7 ${p.done}/${p.total}</span>
        <span class="pill">${l.topicIds.length} topic${l.topicIds.length === 1 ? '' : 's'}</span>
        <button class="btn sm ghost danger" data-act="del-log" data-id="${l.id}"
                title="Unlog this class">Unlog</button>
        <span class="chev">&rsaquo;</span>
      </a>`;
    })
    .join('');

  return `
    <div class="crumb">
      <a href="#/subjects">Subjects</a> /
      <a href="#/subject/${c.subjectId}">${esc(s?.name ?? '?')}</a> / ${esc(c.name)}
    </div>
    <h1>${esc(c.name)}</h1>

    <div class="card">
      <div class="actions">
        <span class="grow">
          <div class="title">Revision method</div>
          <div class="sub muted small">
            <b>Blurt</b> — write out everything you remember from scratch.
            <b>Questions</b> — work practice questions on paper instead. Same 1-4-7 schedule
            either way, only the instructions change.
          </div>
        </span>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn ${c.method === 'blurt' ? 'primary' : ''}" data-act="set-method" data-method="blurt">Blurt</button>
        <button class="btn ${c.method === 'questions' ? 'primary' : ''}" data-act="set-method" data-method="questions">Questions</button>
      </div>
    </div>

    <div class="card">
      <div class="actions">
        <span class="grow">
          <div class="title">Chapter finished?</div>
          <div class="sub muted small">
            Turn this on when the chapter is fully taught. Once it is on <em>and</em> the class
            that taught the last topic has cleared its 1-4-7, the chapter moves to a fortnightly
            blurt and the weekly per-class blurts stop.
          </div>
        </span>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn ${c.finished ? 'primary' : ''}" data-act="toggle-finished">
          ${c.finished ? 'Finished' : 'Mark finished'}
        </button>
        ${
          c.fortnightlyFrom
            ? `<span class="pill last">fortnightly since ${fmtDate(c.fortnightlyFrom)}</span>`
            : `<span class="pill">${gateText(c.finished, lastTopic, chapterQualifies(c))}</span>`
        }
      </div>
    </div>

    <h2>Topics</h2>
    ${topics.length ? topicRows : '<div class="empty">No topics yet. They appear here as you log classes, or add them by hand.</div>'}
    <div class="actions" style="margin-top:10px">
      <button class="btn" data-act="add-topic">+ Add topic</button>
    </div>

    <h2>Classes logged</h2>
    ${logs.length ? logRows : '<div class="empty">No classes logged for this chapter.</div>'}
    <div class="actions" style="margin-top:10px">
      <a class="btn primary" href="#/log?chapter=${c.id}">+ Log a class</a>
      <span class="spacer"></span>
      <button class="btn ghost danger" data-act="del-chapter">Delete chapter</button>
    </div>`;
}

function gateText(finished: boolean, last: Topic | null, qualifies: boolean): string {
  if (qualifies) return 'ready — syncing';
  if (!finished && !last) return 'needs: finished + last topic flagged';
  if (!finished) return 'needs: mark finished';
  if (!last) return 'needs: flag the last topic (or clear every class)';
  const log = classForTopic(last.id);
  if (!log) return `waiting on ${esc(last.name)} to be logged in a class`;
  return ladderResolved(log)
    ? 'ready — syncing'
    : `waiting on the ${esc(last.name)} class to clear its 1-4-7`;
}

export function wire(root: HTMLElement, id: string): void {
  onAct(root, async (act, el, ev) => {
    const c = chapterById(id);
    if (!c) return;

    if (act === 'del-log') {
      ev.preventDefault();
      ev.stopPropagation();
      const logId = el.dataset.id!;
      const log = logById(logId);
      const yes = await confirmBox({
        title: `Unlog the class of ${log ? fmtDate(log.date) : 'this day'}?`,
        body: 'Its blurts go with it — including any still due. The topics stay on the chapter.',
        okLabel: 'Unlog it',
        danger: true,
      });
      if (yes) {
        await deleteClassLog(logId);
        toast('Class unlogged');
      }
      return;
    }

    if (act === 'add-topic') {
      const name = await askText({
        title: 'Add topic',
        label: 'Topic name',
        body: 'Its 1-4-7 starts from the class you log it in.',
        okLabel: 'Add',
      });
      if (name) {
        await addTopic(id, name);
        toast('Topic added');
      }
    }

    if (act === 'rename-topic') {
      const tid = el.dataset.id!;
      const t = topicsOf(id).find((x) => x.id === tid);
      if (!t) return;
      const name = await askText({ title: 'Rename topic', label: 'Name', value: t.name, okLabel: 'Save' });
      if (name) await updateTopic(tid, { name });
    }

    if (act === 'mark-last') {
      const tid = el.dataset.id!;
      const t = topicsOf(id).find((x) => x.id === tid);
      if (!t) return;
      await setLastTopic(id, t.isLast ? null : tid);
      toast(t.isLast ? 'Last-topic flag cleared' : 'Marked as last topic');
    }

    if (act === 'del-topic') {
      const tid = el.dataset.id!;
      const t = topicsOf(id).find((x) => x.id === tid);
      if (!t) return;
      const yes = await confirmBox({
        title: `Delete ${t.name}?`,
        body: 'Its blurts go too.',
        okLabel: 'Delete',
        danger: true,
      });
      if (yes) await deleteTopic(tid);
    }

    if (act === 'set-method') {
      const method = el.dataset.method as 'blurt' | 'questions';
      if (method !== c.method) await updateChapter(id, { method });
    }

    if (act === 'toggle-finished') {
      await updateChapter(id, {
        finished: !c.finished,
        finishedAt: c.finished ? null : Date.now(),
      });
    }

    if (act === 'del-chapter') {
      const yes = await confirmBox({
        title: `Delete ${c.name}?`,
        body: 'Its topics, class logs and blurts go too.',
        okLabel: 'Delete',
        danger: true,
      });
      if (yes) {
        const back = c.subjectId;
        await deleteChapter(id);
        location.hash = `#/subject/${back}`;
      }
    }
  });
}
