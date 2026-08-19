import { rerender } from '../app';
import { classForTopic, ladderProgress, topicScores } from '../schedule';
import { chapterById, store, subjectById } from '../state';
import { onAct } from '../ui';
import { esc, fmtDate } from '../util';

let query = '';

const BAND = (n: number) => (n <= 2 ? 'bad' : n === 3 ? 'warn' : 'good');
const WORD: Record<number, string> = {
  1: 'blank',
  2: 'shaky',
  3: 'patchy',
  4: 'solid',
  5: 'nailed it',
};

function matches(text: string): boolean {
  return !query || text.toLowerCase().includes(query.toLowerCase());
}

function weakHtml(): string {
  const scores = topicScores().filter((s) => {
    const c = chapterById(s.topic.chapterId);
    const sub = subjectById(s.topic.subjectId);
    return matches(`${s.topic.name} ${c?.name ?? ''} ${sub?.name ?? ''}`);
  });

  if (!scores.length) {
    return `<div class="empty">${
      query
        ? 'Nothing matches.'
        : 'Rate a blurt and your weak spots show up here, worst first.'
    }</div>`;
  }

  return scores
    .map((s) => {
      const sub = subjectById(s.topic.subjectId);
      const c = chapterById(s.topic.chapterId);
      return `
      <a class="row" href="#/chapter/${s.topic.chapterId}">
        <span class="dot" style="background:${sub?.color ?? '#666'}"></span>
        <span class="grow">
          <div class="title">${esc(s.topic.name)}</div>
          <div class="sub">
            ${esc(sub?.name ?? '?')} · ${esc(c?.name ?? '?')} ·
            rated ${s.times}&times;, average ${s.average}/5${
              s.lastOn ? ` · last ${fmtDate(s.lastOn)}` : ''
            }
          </div>
        </span>
        <span class="pill ${BAND(s.latest)}">${s.latest}/5 ${WORD[s.latest] ?? ''}</span>
      </a>`;
    })
    .join('');
}

function untestedHtml(): string {
  const rated = new Set(topicScores().map((s) => s.topic.id));
  const rest = store.topics.filter((t) => !rated.has(t.id));
  if (!rest.length) return '';

  const rows = rest
    .filter((t) => {
      const c = chapterById(t.chapterId);
      const sub = subjectById(t.subjectId);
      return matches(`${t.name} ${c?.name ?? ''} ${sub?.name ?? ''}`);
    })
    .map((t) => {
      const sub = subjectById(t.subjectId);
      const c = chapterById(t.chapterId);
      const log = classForTopic(t.id);
      const p = log ? ladderProgress(log) : { done: 0, total: 3 };
      return `
      <a class="row" href="#/chapter/${t.chapterId}">
        <span class="dot" style="background:${sub?.color ?? '#666'}"></span>
        <span class="grow">
          <div class="title">${esc(t.name)}</div>
          <div class="sub">${esc(sub?.name ?? '?')} · ${esc(c?.name ?? '?')} · class 1-4-7 ${p.done}/${p.total}</div>
        </span>
        <span class="pill">not rated yet</span>
      </a>`;
    })
    .join('');

  return rows ? `<h2>Not rated yet</h2>${rows}` : '';
}

export function render(): string {
  const scores = topicScores();
  const weak = scores.filter((s) => s.latest <= 2).length;

  return `
    <h1>Weak spots</h1>
    <p class="muted small">
      Built from the ratings you give after each blurt, worst first. This is the whole reason the
      app asks for a score — it is your revision list.
    </p>

    ${
      scores.length
        ? `<div class="stat-grid">
             <div class="stat ${weak ? 'bad' : 'good'}"><div class="n">${weak}</div><div class="k">Shaky or blank</div></div>
             <div class="stat"><div class="n">${scores.length}</div><div class="k">Topics rated</div></div>
           </div>`
        : ''
    }

    <div class="field">
      <label>Search topics, chapters and subjects</label>
      <input type="text" data-f="q" value="${esc(query)}" />
    </div>

    ${weakHtml()}
    ${untestedHtml()}`;
}

export function wire(root: HTMLElement): void {
  const q = root.querySelector<HTMLInputElement>('[data-f="q"]');
  let timer: number | undefined;
  q?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = q.value;
      rerender();
      const again = document.querySelector<HTMLInputElement>('[data-f="q"]');
      again?.focus();
      again?.setSelectionRange(again.value.length, again.value.length);
    }, 250);
  });

  onAct(root, () => {
    /* rows are plain links */
  });
}
