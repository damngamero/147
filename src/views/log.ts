import { rerender } from '../app';
import type { Route } from '../router';
import {
  addChapter,
  chapterById,
  chaptersOf,
  deleteClassLog,
  deleteTopic,
  logById,
  recentLogs,
  saveClassLog,
  store,
  subjectById,
  topicById,
  topicsOf,
  updateTopic,
} from '../state';
import type { ClassLog } from '../types';
import { askText, confirmBox, onAct, toast } from '../ui';
import { classLabel, esc, fmtDate, todayISO } from '../util';

interface Draft {
  id: string;
  date: string;
  name: string;
  subjectId: string;
  chapterId: string;
  what: string;
  topicIds: Set<string>;
  newTopicNames: string[];
}

/** Session-only, not persisted — searches by class name, topic name, or notes. */
let historySearch = '';

/** Collapsed by default — subject groups can get long. A search auto-expands everything. */
let expandedSubjects = new Set<string>();

let draft: Draft | null = null;
let draftKey = '';

function blankDraft(chapterId: string): Draft {
  const ch = chapterId ? chapterById(chapterId) : undefined;
  const lastLog = recentLogs(1)[0];
  const subjectId = ch?.subjectId ?? lastLog?.subjectId ?? store.subjects[0]?.id ?? '';
  return {
    id: '',
    date: todayISO(),
    name: '',
    subjectId,
    chapterId: ch?.id ?? (subjectId ? (chaptersOf(subjectId)[0]?.id ?? '') : ''),
    what: '',
    topicIds: new Set(),
    newTopicNames: [],
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
        name: l.name ?? '',
        subjectId: l.subjectId,
        chapterId: l.chapterId,
        what: l.what,
        topicIds: new Set(l.topicIds),
        newTopicNames: [],
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

function newTopicChipsHtml(d: Draft): string {
  return d.newTopicNames
    .map(
      (name, i) => `
      <span class="chip-tag">
        ${esc(name)}
        <button type="button" class="chip-x" data-act="rm-new-topic" data-i="${i}" title="Remove">&times;</button>
      </span>`,
    )
    .join('');
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
      <div class="check-row">
        <label class="check ${d.topicIds.has(t.id) ? 'on' : ''}">
          <input type="checkbox" data-topic="${t.id}" ${d.topicIds.has(t.id) ? 'checked' : ''} />
          <span class="grow">${esc(t.name)}</span>
          ${t.isLast ? '<span class="pill last">last</span>' : ''}
        </label>
        <button type="button" class="icon-btn" data-act="rename-topic" data-id="${t.id}" title="Rename topic">&#9662;</button>
        <button type="button" class="icon-btn danger" data-act="del-topic" data-id="${t.id}" title="Delete topic">&times;</button>
      </div>`,
    )
    .join('');

  return `
    <div class="card">
      <div class="field">
        <label>Date of class</label>
        <input type="date" data-f="date" value="${d.date}" />
      </div>

      <div class="field">
        <label>Class name (optional)</label>
        <input type="text" data-f="name" value="${esc(d.name)}" placeholder="Leave blank to just use the date" />
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
        <label>New topics</label>
        <div class="chip-input">
          <div class="chip-list" data-chips="new-topics">${newTopicChipsHtml(d)}</div>
          <input type="text" data-f="new-topic-input" placeholder="Type a topic, press Enter to add" />
        </div>
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

/** Class name, its topics, and its notes — whatever you'd actually remember it by. */
function matchesSearch(l: ClassLog, q: string): boolean {
  if (!q) return true;
  const hay = [
    classLabel(l),
    l.what,
    ...l.topicIds.map((id) => topicById(id)?.name ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function logRowHtml(l: ClassLog): string {
  const c = chapterById(l.chapterId);
  const names = l.topicIds
    .map((id) => topicById(id)?.name)
    .filter(Boolean)
    .map((n) => `<span class="pill">${esc(n!)}</span>`)
    .join('');
  return `
    <a class="row" href="#/log/${l.id}" style="align-items:flex-start">
      <span class="grow">
        <div class="title">${esc(classLabel(l))} <span class="dim">&middot; ${fmtDate(l.date)}</span></div>
        <div class="sub">
          ${esc(c?.name ?? '?')}${l.what ? ` &middot; ${esc(l.what.slice(0, 90))}` : ''}
        </div>
        ${names ? `<div class="chips">${names}</div>` : ''}
      </span>
      <button class="btn sm ghost danger" data-act="del-log" data-id="${l.id}"
              title="Unlog this class">Unlog</button>
      <span class="chev">&rsaquo;</span>
    </a>`;
}

/** Grouped by subject, most-recent class first within each group — searches by name/topic/notes.
 *  Collapsed by default so a subject with a long history doesn't push everything else down the
 *  page; a search forces every matching group open so results are never hidden. */
function historyHtml(query: string): string {
  const q = query.trim().toLowerCase();
  const logs = store.logs.filter((l) => matchesSearch(l, q));
  if (!logs.length) {
    return `<div class="empty">${q ? 'No classes match that search.' : 'Nothing logged yet.'}</div>`;
  }

  const bySubject = new Map<string, ClassLog[]>();
  for (const l of logs) {
    if (!bySubject.has(l.subjectId)) bySubject.set(l.subjectId, []);
    bySubject.get(l.subjectId)!.push(l);
  }
  for (const arr of bySubject.values()) {
    arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  return store.subjects
    .filter((s) => bySubject.has(s.id))
    .map((s) => {
      const group = bySubject.get(s.id)!;
      const open = !!q || expandedSubjects.has(s.id);
      return `
      <div class="daygroup" data-act="toggle-subject" data-id="${s.id}" style="cursor:pointer">
        <span class="dim">${open ? '&#9662;' : '&#9656;'}</span> ${esc(s.name)}
        <span class="dim">(${group.length})</span>
      </div>
      ${open ? group.map(logRowHtml).join('') : ''}`;
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
    <div class="field">
      <input type="text" data-f="history-search" value="${esc(historySearch)}"
             placeholder="Search by class name, topic, or notes" />
    </div>
    <div data-history>${historyHtml(historySearch)}</div>`;
}

export function wire(root: HTMLElement, route: Route): void {
  if (!store.subjects.length) return;
  const d = ensureDraft(route);

  // Keep the draft in sync on every keystroke so a re-render never loses input.
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    const f = t.dataset.f;
    if (f === 'date') d.date = t.value;
    if (f === 'name') d.name = t.value;
    if (f === 'what') d.what = t.value;
    if (f === 'history-search') {
      historySearch = t.value;
      const box = root.querySelector<HTMLElement>('[data-history]');
      if (box) box.innerHTML = historyHtml(historySearch);
    }
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

  // Chip-style new-topic adder — updates just the chip list, not a full
  // rerender, so the input never loses focus while typing several in a row.
  const newTopicInput = root.querySelector<HTMLInputElement>('[data-f="new-topic-input"]');
  const chipList = root.querySelector<HTMLElement>('[data-chips="new-topics"]');
  const syncChips = () => {
    if (chipList) chipList.innerHTML = newTopicChipsHtml(d);
  };
  const addFromInput = () => {
    if (!newTopicInput) return;
    const parts = newTopicInput.value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const name of parts) {
      if (!d.newTopicNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
        d.newTopicNames.push(name);
      }
    }
    newTopicInput.value = '';
    syncChips();
  };
  newTopicInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    } else if (e.key === 'Backspace' && newTopicInput.value === '' && d.newTopicNames.length) {
      d.newTopicNames.pop();
      syncChips();
    }
  });
  newTopicInput?.addEventListener('blur', () => {
    if (newTopicInput.value.trim()) addFromInput();
  });

  onAct(root, async (act, el, ev) => {
    if (act === 'toggle-subject') {
      const sid = el.dataset.id!;
      if (expandedSubjects.has(sid)) expandedSubjects.delete(sid);
      else expandedSubjects.add(sid);
      const box = root.querySelector<HTMLElement>('[data-history]');
      if (box) box.innerHTML = historyHtml(historySearch);
      return;
    }

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

    if (act === 'rename-topic') {
      ev.preventDefault();
      const tid = el.dataset.id!;
      const t = topicById(tid);
      if (!t) return;
      const name = await askText({ title: 'Rename topic', label: 'Name', value: t.name, okLabel: 'Save' });
      if (name) {
        await updateTopic(tid, { name });
        rerender();
      }
      return;
    }

    if (act === 'del-topic') {
      ev.preventDefault();
      const tid = el.dataset.id!;
      const t = topicById(tid);
      if (!t) return;
      const yes = await confirmBox({
        title: `Delete ${t.name}?`,
        body: 'Its blurts go too, and it comes off any class it was ticked on.',
        okLabel: 'Delete',
        danger: true,
      });
      if (yes) {
        d.topicIds.delete(tid);
        await deleteTopic(tid);
        toast('Topic deleted');
        rerender();
      }
      return;
    }

    if (act === 'rm-new-topic') {
      ev.preventDefault();
      const i = Number(el.dataset.i);
      d.newTopicNames.splice(i, 1);
      syncChips();
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
      addFromInput();
      const newTopicNames = d.newTopicNames;
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
        name: d.name,
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
