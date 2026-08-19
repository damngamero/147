import { rerender } from '../app';
import type { Route } from '../router';
import {
  addChapter,
  chapterById,
  chaptersOf,
  deleteClassLog,
  logById,
  recentLogs,
  saveClassLog,
  store,
  subjectById,
  topicById,
  topicsOf,
} from '../state';
import { askText, confirmBox, onAct, toast } from '../ui';
import { esc, fmtDate, todayISO } from '../util';

interface Draft {
  id: string;
  date: string;
  subjectId: string;
  chapterId: string;
  what: string;
  topicIds: Set<string>;
  newTopics: string;
}

let draft: Draft | null = null;
let draftKey = '';

function blankDraft(chapterId: string): Draft {
  const ch = chapterId ? chapterById(chapterId) : undefined;
  const lastLog = recentLogs(1)[0];
  const subjectId = ch?.subjectId ?? lastLog?.subjectId ?? store.subjects[0]?.id ?? '';
  return {
    id: '',
    date: todayISO(),
    subjectId,
    chapterId: ch?.id ?? (subjectId ? (chaptersOf(subjectId)[0]?.id ?? '') : ''),
    what: '',
    topicIds: new Set(),
    newTopics: '',
  };
}

function ensureDraft(route: Route): Draft {
  const key = `${route.param}|${route.query.chapter ?? ''}`;
  if (draft && draftKey === key) return draft;
  draftKey = key;

  if (route.param) {
    const l = logById(route.param);
    if (l) {
      draft = {
        id: l.id,
        date: l.date,
        subjectId: l.subjectId,
        chapterId: l.chapterId,
        what: l.what,
        topicIds: new Set(l.topicIds),
        newTopics: '',
      };
      return draft;
    }
  }
  draft = blankDraft(route.query.chapter ?? '');
  return draft;
}

/** Keeps the draft in step with a chapter/subject swap. */
function normalise(d: Draft): void {
  if (d.subjectId && !subjectById(d.subjectId)) d.subjectId = store.subjects[0]?.id ?? '';
  const chapters = d.subjectId ? chaptersOf(d.subjectId) : [];
  if (!chapters.some((c) => c.id === d.chapterId)) d.chapterId = chapters[0]?.id ?? '';
}

function formHtml(d: Draft): string {
  normalise(d);
  const chapters = d.subjectId ? chaptersOf(d.subjectId) : [];
  const topics = d.chapterId ? topicsOf(d.chapterId) : [];

  const subjectOpts = store.subjects
    .map((s) => `<option value="${s.id}" ${s.id === d.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');
  const chapterOpts = chapters
    .map((c) => `<option value="${c.id}" ${c.id === d.chapterId ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const checks = topics
    .map(
      (t) => `
      <label class="check ${d.topicIds.has(t.id) ? 'on' : ''}">
        <input type="checkbox" data-topic="${t.id}" ${d.topicIds.has(t.id) ? 'checked' : ''} />
        <span class="grow">${esc(t.name)}</span>
        ${t.isLast ? '<span class="pill last">last</span>' : ''}
      </label>`,
    )
    .join('');

  return `
    <div class="card">
      <div class="field">
        <label>Date of class</label>
        <input type="date" data-f="date" value="${d.date}" />
      </div>

      <div class="field">
        <label>Subject</label>
        <select data-f="subjectId">${subjectOpts}</select>
      </div>

      <div class="field">
        <label>Chapter</label>
        ${
          chapters.length
            ? `<select data-f="chapterId">${chapterOpts}</select>`
            : '<div class="empty small">This subject has no chapters yet.</div>'
        }
        <div class="actions" style="margin-top:8px">
          <button class="btn sm ghost" data-act="new-chapter" ${d.subjectId ? '' : 'disabled'}>+ New chapter</button>
        </div>
      </div>

      <div class="field">
        <label>Topics covered</label>
        ${topics.length ? `<div class="checklist">${checks}</div>` : '<div class="dim small">No topics on this chapter yet — type new ones below.</div>'}
      </div>

      <div class="field">
        <label>New topics — separate them with a comma</label>
        <input type="text" data-f="newTopics" value="${esc(d.newTopics)}" />
      </div>

      <div class="field">
        <label>What I did in this class — this is what your blurts get checked against</label>
        <textarea data-f="what">${esc(d.what)}</textarea>
      </div>

      <div class="actions">
        <button class="btn primary" data-act="save" ${d.chapterId ? '' : 'disabled'}>
          ${d.id ? 'Save changes' : 'Save class'}
        </button>
        ${d.id ? '<button class="btn ghost danger" data-act="delete">Unlog this class</button>' : ''}
        <span class="spacer"></span>
        ${d.id ? '<a class="btn ghost" href="#/log">New class</a>' : ''}
      </div>
    </div>`;
}

function historyHtml(): string {
  const logs = recentLogs(40);
  if (!logs.length) return '<div class="empty">Nothing logged yet.</div>';
  return logs
    .map((l) => {
      const s = subjectById(l.subjectId);
      const c = chapterById(l.chapterId);
      const names = l.topicIds
        .map((id) => topicById(id)?.name)
        .filter(Boolean)
        .map((n) => `<span class="pill">${esc(n!)}</span>`)
        .join('');
      return `
      <a class="row" href="#/log/${l.id}" style="align-items:flex-start">
        <span class="dot" style="background:${s?.color ?? '#666'};margin-top:6px"></span>
        <span class="grow">
          <div class="title">${fmtDate(l.date)} &middot; ${esc(s?.name ?? '?')} <span class="dim">/ ${esc(c?.name ?? '?')}</span></div>
          <div class="sub">${l.what ? esc(l.what.slice(0, 120)) : '<span class="dim">no notes</span>'}</div>
          ${names ? `<div class="chips">${names}</div>` : ''}
        </span>
        <button class="btn sm ghost danger" data-act="del-log" data-id="${l.id}"
                title="Unlog this class">Unlog</button>
        <span class="chev">&rsaquo;</span>
      </a>`;
    })
    .join('');
}

export function render(route: Route): string {
  if (!store.subjects.length) {
    return `
      <h1>Log a class</h1>
      <div class="empty">Add a subject first, then a chapter.<br /><br />
        <a class="btn primary" href="#/subjects">Go to Subjects</a>
      </div>`;
  }
  const d = ensureDraft(route);
  return `
    <h1>${d.id ? 'Edit class' : 'Log a class'}</h1>
    ${formHtml(d)}
    <h2>History</h2>
    ${historyHtml()}`;
}

export function wire(root: HTMLElement, route: Route): void {
  if (!store.subjects.length) return;
  const d = ensureDraft(route);

  // Keep the draft in sync on every keystroke so a re-render never loses input.
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    const f = t.dataset.f;
    if (f === 'date') d.date = t.value;
    if (f === 'what') d.what = t.value;
    if (f === 'newTopics') d.newTopics = t.value;
    if (t.dataset.topic) {
      const on = (t as HTMLInputElement).checked;
      if (on) d.topicIds.add(t.dataset.topic);
      else d.topicIds.delete(t.dataset.topic);
      t.closest('.check')?.classList.toggle('on', on);
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.f === 'subjectId') {
      d.subjectId = t.value;
      d.chapterId = '';
      d.topicIds.clear();
      rerender();
    }
    if (t.dataset.f === 'chapterId') {
      d.chapterId = t.value;
      d.topicIds.clear();
      rerender();
    }
  });

  onAct(root, async (act, el, ev) => {
    if (act === 'del-log') {
      ev.preventDefault();
      ev.stopPropagation();
      const id = el.dataset.id!;
      const log = logById(id);
      const yes = await confirmBox({
        title: `Unlog the class of ${log ? fmtDate(log.date) : 'this day'}?`,
        body: 'Its blurts go with it — including any still due. The topics stay on the chapter.',
        okLabel: 'Unlog it',
        danger: true,
      });
      if (yes) {
        if (d.id === id) {
          draft = null;
          draftKey = '';
          location.hash = '#/log';
        }
        await deleteClassLog(id);
        toast('Class unlogged');
      }
      return;
    }

    if (act === 'new-chapter') {
      const name = await askText({ title: 'New chapter', label: 'Name', okLabel: 'Add' });
      if (!name) return;
      const c = await addChapter(d.subjectId, name);
      d.chapterId = c.id;
      d.topicIds.clear();
    }

    if (act === 'save') {
      const newTopicNames = d.newTopics
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!d.topicIds.size && !newTopicNames.length) {
        const ok = await confirmBox({
          title: 'No topics ticked',
          body: 'Without a topic there is nothing to blurt. Save anyway?',
          okLabel: 'Save anyway',
        });
        if (!ok) return;
      }
      await saveClassLog({
        id: d.id || undefined,
        date: d.date,
        subjectId: d.subjectId,
        chapterId: d.chapterId,
        what: d.what,
        topicIds: [...d.topicIds],
        newTopicNames,
      });
      draft = null;
      draftKey = '';
      toast('Class saved');
      location.hash = '#/log';
    }

    if (act === 'delete') {
      const yes = await confirmBox({
        title: 'Unlog this class?',
        body: 'Its blurts go with it — including any still due. The topics stay on the chapter.',
        okLabel: 'Unlog it',
        danger: true,
      });
      if (yes) {
        await deleteClassLog(d.id);
        draft = null;
        draftKey = '';
        location.hash = '#/log';
      }
    }
  });
}
