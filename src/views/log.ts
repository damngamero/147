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
import { askAction, askText, confirmBox, onAct, toast } from '../ui';
import { classLabel, esc, fmtDate, splitList, subjColor, todayISO } from '../util';

interface Draft {
  id: string;
  date: string;
  name: string;
  subjectId: string;
  chapterId: string;
  what: string;
  topicIds: Set<string>;
  newTopicNames: string[];
  /** Whatever is half-typed in the new-topic box, so a re-render can't eat it. */
  pendingTopic: string;
  /** Sub topics for the new topics, keyed by lower-cased name — they get created together on save. */
  newTopicSubs: Record<string, string[]>;
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
    pendingTopic: '',
    newTopicSubs: {},
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
        pendingTopic: '',
        newTopicSubs: {},
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

/** Sub topics as one quiet line under a topic name. */
function subsLine(subs: string[] | undefined): string {
  return subs?.length
    ? `<span class="topic-subs">${subs.length} sub topic${subs.length === 1 ? '' : 's'} · ${subs.map(esc).join(', ')}</span>`
    : '';
}

/** Topics typed in this time — they sit in the same list as the chapter's, always included. */
function newTopicRowsHtml(d: Draft): string {
  return d.newTopicNames
    .map(
      (name, i) => `
      <div class="topic-item on">
        <span class="topic-tick">&check;</span>
        <span class="grow">
          <span class="topic-name">${esc(name)} <span class="pill accent">new</span></span>
          ${subsLine(d.newTopicSubs[name.toLowerCase()])}
        </span>
        <button type="button" class="icon-btn" data-act="new-topic-menu" data-i="${i}" title="Sub topics, remove">&hellip;</button>
      </div>`,
    )
    .join('');
}

function topicCount(d: Draft): number {
  return d.topicIds.size + d.newTopicNames.length;
}

function saveLabel(d: Draft): string {
  const n = topicCount(d);
  return `${d.id ? 'Save changes' : 'Save class'}${n ? ` · ${n} topic${n === 1 ? '' : 's'}` : ''}`;
}

/** Sub topics, one per line — prefilled with what's there, so this both adds and edits. */
function askSubtopics(topic: string, current: string[]): Promise<string | null> {
  return askText({
    title: `Sub topics of ${topic}`,
    body: 'One per line (or separated by commas). Chapter blurts are split by sub topic count, max 20 a part.',
    label: 'Sub topics',
    value: current.join('\n'),
    multiline: true,
    okLabel: 'Save',
  });
}

function formHtml(d: Draft): string {
  normalise(d);
  const chapters = d.subjectId ? chaptersOf(d.subjectId) : [];
  const topics = d.chapterId ? topicsOf(d.chapterId) : [];

  const subjectPicks = store.subjects
    .filter((s) => !s.archived || s.id === d.subjectId)
    .map(
      (s) => `
      <button type="button" class="subj-pick ${s.id === d.subjectId ? 'on' : ''}" data-act="pick-subject"
              data-id="${s.id}" style="--subj:${subjColor(s.color)}">
        <span class="dot" style="background:var(--subj)"></span>${esc(s.name)}
      </button>`,
    )
    .join('');
  const chapterOpts = chapters
    .map((c) => `<option value="${c.id}" ${c.id === d.chapterId ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const existing = topics
    .map((t) => {
      const on = d.topicIds.has(t.id);
      return `
      <div class="topic-item ${on ? 'on' : ''}">
        <label class="grow topic-check">
          <input type="checkbox" data-topic="${t.id}" ${on ? 'checked' : ''} />
          <span class="grow">
            <span class="topic-name">${esc(t.name)} ${t.isLast ? '<span class="pill last">last</span>' : ''}</span>
            ${subsLine(t.subtopics)}
          </span>
        </label>
        <button type="button" class="icon-btn" data-act="topic-menu" data-id="${t.id}" title="Sub topics, rename, delete">&hellip;</button>
      </div>`;
    })
    .join('');

  return `
    <div class="log-form">
      <section class="card">
        <div class="sec-title">When</div>
        <div class="grid2">
          <div class="field">
            <label>Date</label>
            <input type="date" data-f="date" value="${d.date}" />
          </div>
          <div class="field">
            <label>Name <span class="dim">(optional)</span></label>
            <input type="text" data-f="name" value="${esc(d.name)}" placeholder="Uses the date if blank" />
          </div>
        </div>
      </section>

      <section class="card">
        <div class="sec-title">Subject</div>
        <div class="subj-picks">${subjectPicks}</div>
        <div class="sec-title" style="margin-top:14px">Chapter</div>
        <div class="inline">
          ${
            chapters.length
              ? `<select data-f="chapterId">${chapterOpts}</select>`
              : '<div class="dim small grow">No chapters in this subject yet.</div>'
          }
          <button class="btn sm" data-act="new-chapter" ${d.subjectId ? '' : 'disabled'}>+ New</button>
        </div>
      </section>

      <section class="card">
        <div class="sec-head">
          <div class="sec-title">Topics covered</div>
          <span class="pill" data-count>${topicCount(d)} ticked</span>
        </div>
        <div class="topic-list">
          ${existing}
          <div data-new-topics>${newTopicRowsHtml(d)}</div>
          ${topics.length || d.newTopicNames.length ? '' : '<div class="dim small" data-no-topics style="padding:6px 2px">No topics on this chapter yet — add the ones from this class below.</div>'}
        </div>
        <div class="inline" style="margin-top:10px">
          <input type="text" data-f="new-topic-input" value="${esc(d.pendingTopic)}" placeholder="New topic…" />
          <button type="button" class="btn sm" data-act="add-new-topic">Add</button>
        </div>
        <div class="dim small" style="margin-top:6px">Tap &hellip; on a topic for its sub topics.</div>
      </section>

      <section class="card">
        <div class="sec-title">Notes</div>
        <div class="dim small" style="margin-bottom:8px">What you did in class — your blurts get checked against this.</div>
        <textarea data-f="what">${esc(d.what)}</textarea>
      </section>

      <div class="save-bar">
        <button class="btn primary grow" data-act="save" ${d.chapterId ? '' : 'disabled'}>${saveLabel(d)}</button>
        ${d.id ? '<button class="btn ghost danger" data-act="delete" title="Unlog this class">Unlog</button>' : ''}
        ${d.id ? '<a class="btn ghost" href="#/log">New</a>' : ''}
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
  const s = subjectById(l.subjectId);
  const names = l.topicIds
    .map((id) => topicById(id)?.name)
    .filter(Boolean)
    .map((n) => `<span class="pill">${esc(n!)}</span>`)
    .join('');
  return `
    <a class="row coded" href="#/log/${l.id}" style="align-items:flex-start;--subj:${subjColor(s?.color)}">
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
        <span class="dim">${open ? '&#9662;' : '&#9656;'}</span>
        <span class="dot" style="background:${subjColor(s.color)};display:inline-block;margin:0 4px"></span>${esc(s.name)}
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
    if (f === 'new-topic-input') d.pendingTopic = t.value;
    if (f === 'history-search') {
      historySearch = t.value;
      const box = root.querySelector<HTMLElement>('[data-history]');
      if (box) box.innerHTML = historyHtml(historySearch);
    }
    if (t.dataset.topic) {
      const on = (t as HTMLInputElement).checked;
      if (on) d.topicIds.add(t.dataset.topic);
      else d.topicIds.delete(t.dataset.topic);
      t.closest('.topic-item')?.classList.toggle('on', on);
      syncCounts();
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.f === 'chapterId') {
      d.chapterId = t.value;
      d.topicIds.clear();
      rerender();
    }
  });

  // New topics update just their own rows and the counts, not a full
  // rerender, so the input never loses focus while typing several in a row.
  const newTopicInput = root.querySelector<HTMLInputElement>('[data-f="new-topic-input"]');
  const newList = root.querySelector<HTMLElement>('[data-new-topics]');
  function syncCounts(): void {
    const count = root.querySelector<HTMLElement>('[data-count]');
    if (count) count.textContent = `${topicCount(d)} ticked`;
    const save = root.querySelector<HTMLButtonElement>('[data-act="save"]');
    if (save) save.textContent = saveLabel(d);
  }
  const syncChips = () => {
    if (newList) newList.innerHTML = newTopicRowsHtml(d);
    if (d.newTopicNames.length) root.querySelector('[data-no-topics]')?.remove();
    syncCounts();
  };
  const addFromInput = () => {
    if (!newTopicInput) return;
    const parts = newTopicInput.value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    // A name the chapter already has just ticks that topic instead of making a twin.
    const have = new Map(
      (d.chapterId ? topicsOf(d.chapterId) : []).map((t) => [t.name.trim().toLowerCase(), t]),
    );
    let ticked = false;
    for (const name of parts) {
      const match = have.get(name.toLowerCase());
      if (match) {
        if (!d.topicIds.has(match.id)) ticked = true;
        d.topicIds.add(match.id);
      } else if (!d.newTopicNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
        d.newTopicNames.push(name);
      }
    }
    newTopicInput.value = '';
    d.pendingTopic = '';
    if (ticked) {
      toast('Already in this chapter — ticked it');
      rerender();
      return;
    }
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

    if (act === 'pick-subject') {
      if (el.dataset.id === d.subjectId) return;
      d.subjectId = el.dataset.id!;
      d.chapterId = '';
      d.topicIds.clear();
      rerender();
      return;
    }

    if (act === 'add-new-topic') {
      addFromInput();
      newTopicInput?.focus();
      return;
    }

    if (act === 'topic-menu') {
      ev.preventDefault();
      const t = topicById(el.dataset.id!);
      if (!t) return;
      const pick = await askAction({
        title: t.name,
        actions: [
          { value: 'subs', label: t.subtopics?.length ? `Sub topics (${t.subtopics.length})` : 'Add sub topics' },
          { value: 'rename', label: 'Rename' },
          { value: 'delete', label: 'Delete topic', danger: true },
        ],
      });
      if (pick === 'subs') {
        const text = await askSubtopics(t.name, t.subtopics ?? []);
        if (text === null) return;
        await updateTopic(t.id, { subtopics: splitList(text) });
        rerender();
      }
      if (pick === 'rename') {
        const name = await askText({ title: 'Rename topic', label: 'Name', value: t.name, okLabel: 'Save' });
        if (name) {
          await updateTopic(t.id, { name });
          rerender();
        }
      }
      if (pick === 'delete') {
        const yes = await confirmBox({
          title: `Delete ${t.name}?`,
          body: 'Its blurts go too, and it comes off any class it was ticked on.',
          okLabel: 'Delete',
          danger: true,
        });
        if (yes) {
          d.topicIds.delete(t.id);
          await deleteTopic(t.id);
          toast('Topic deleted');
          rerender();
        }
      }
      return;
    }

    if (act === 'new-topic-menu') {
      ev.preventDefault();
      const i = Number(el.dataset.i);
      const name = d.newTopicNames[i];
      if (!name) return;
      const key = name.toLowerCase();
      const subs = d.newTopicSubs[key] ?? [];
      const pick = await askAction({
        title: name,
        body: 'New — gets created when you save the class.',
        actions: [
          { value: 'subs', label: subs.length ? `Sub topics (${subs.length})` : 'Add sub topics' },
          { value: 'remove', label: 'Remove', danger: true },
        ],
      });
      if (pick === 'subs') {
        const text = await askSubtopics(name, subs);
        if (text === null) return;
        d.newTopicSubs[key] = splitList(text);
      }
      if (pick === 'remove') {
        d.newTopicNames.splice(i, 1);
        delete d.newTopicSubs[key];
      }
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
        newTopicSubtopics: d.newTopicSubs,
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
