import {
  addChapter,
  chaptersOf,
  deleteSubject,
  logsOf,
  subjectById,
  topicsOf,
  updateSubject,
} from '../state';
import { askText, confirmBox, onAct, toast } from '../ui';
import { esc } from '../util';

export function render(id: string): string {
  const s = subjectById(id);
  if (!s) return '<div class="empty">Subject not found.</div>';

  const chapters = chaptersOf(s.id);
  const rows = chapters
    .map((c) => {
      const tops = topicsOf(c.id);
      const last = tops.find((t) => t.isLast);
      const logs = logsOf(c.id).length;
      return `
      <a class="row" href="#/chapter/${c.id}">
        <span class="grow">
          <div class="title">${esc(c.name)}</div>
          <div class="sub">
            ${tops.length} topic${tops.length === 1 ? '' : 's'} &middot; ${logs} class${logs === 1 ? '' : 'es'}
            ${last ? ` &middot; last: ${esc(last.name)}` : ''}
          </div>
        </span>
        ${c.finished ? '<span class="pill good">finished</span>' : ''}
        <span class="chev">&rsaquo;</span>
      </a>`;
    })
    .join('');

  return `
    <div class="crumb"><a href="#/subjects">Subjects</a> / ${esc(s.name)}</div>
    <h1><span class="dot" style="background:${s.color};display:inline-block;margin-right:8px"></span>${esc(s.name)}</h1>

    <h2>Chapters</h2>
    ${chapters.length ? rows : '<div class="empty">No chapters yet.</div>'}

    <div class="actions" style="margin-top:14px">
      <button class="btn primary" data-act="add-chapter">+ New chapter</button>
      <button class="btn ghost" data-act="rename-subject">Rename subject</button>
      <span class="spacer"></span>
      <button class="btn ghost danger" data-act="delete-subject">Delete subject</button>
    </div>`;
}

export function wire(root: HTMLElement, id: string): void {
  onAct(root, async (act) => {
    if (act === 'add-chapter') {
      const name = await askText({ title: 'New chapter', label: 'Name', okLabel: 'Add' });
      if (name) {
        await addChapter(id, name);
        toast('Chapter added');
      }
    }
    if (act === 'rename-subject') {
      const s = subjectById(id);
      if (!s) return;
      const name = await askText({
        title: 'Rename subject',
        label: 'Name',
        value: s.name,
        okLabel: 'Save',
      });
      if (name) await updateSubject(id, { name });
    }
    if (act === 'delete-subject') {
      const s = subjectById(id);
      if (!s) return;
      const yes = await confirmBox({
        title: `Delete ${s.name}?`,
        body: 'Its chapters, topics, class logs and blurts go too. This cannot be undone.',
        okLabel: 'Delete',
        danger: true,
      });
      if (yes) {
        await deleteSubject(id);
        location.hash = '#/subjects';
        toast('Subject deleted');
      }
    }
  });
}
