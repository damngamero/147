import { addSubject, chaptersOf, store, subjectById, updateSubject } from '../state';
import { askText, onAct, toast } from '../ui';
import { esc } from '../util';

export function render(): string {
  const subs = [...store.subjects].sort((a, b) => a.createdAt - b.createdAt);

  const rows = subs
    .map((s) => {
      const chs = chaptersOf(s.id);
      const tops = store.topics.filter((t) => t.subjectId === s.id).length;
      const logs = store.logs.filter((l) => l.subjectId === s.id).length;
      return `
      <a class="row" href="#/subject/${s.id}">
        <span class="dot" style="background:${s.color}"></span>
        <span class="grow">
          <div class="title">${esc(s.name)}</div>
          <div class="sub">${chs.length} chapter${chs.length === 1 ? '' : 's'} &middot; ${tops} topic${tops === 1 ? '' : 's'} &middot; ${logs} class${logs === 1 ? '' : 'es'}</div>
        </span>
        <button class="btn sm ghost" data-act="rename" data-id="${s.id}">Edit</button>
        <span class="chev">&rsaquo;</span>
      </a>`;
    })
    .join('');

  return `
    <h1>Subjects</h1>
    ${subs.length ? rows : '<div class="empty">No subjects yet. Add one to start.</div>'}
    <div class="actions" style="margin-top:14px">
      <button class="btn primary" data-act="add-subject">+ New subject</button>
    </div>`;
}

export function wire(root: HTMLElement): void {
  onAct(root, async (act, el, ev) => {
    if (act === 'add-subject') {
      const name = await askText({ title: 'New subject', label: 'Name', okLabel: 'Add' });
      if (name) {
        await addSubject(name);
        toast('Subject added');
      }
    }
    if (act === 'rename') {
      ev.preventDefault();
      ev.stopPropagation();
      const id = el.dataset.id!;
      const s = subjectById(id);
      if (!s) return;
      const name = await askText({ title: 'Rename subject', label: 'Name', value: s.name, okLabel: 'Save' });
      if (name) await updateSubject(id, { name });
    }
  });
}
