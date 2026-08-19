/** First-run walkthrough. Replayable from the Help page. */

const KEY = '147_tour_v1';

interface Step {
  title: string;
  body: string;
  /** where to send the user when they finish on this step */
  go?: string;
}

const STEPS: Step[] = [
  {
    title: 'This is 147',
    body: `You log what happened in each class. 147 turns <b>each class</b> into a blurt —
      every topic from that class, together, on the same day. You blurt on <b>paper</b>; the app
      only decides <i>when</i>, and asks how each topic went afterwards.`,
  },
  {
    title: '1. Log the class',
    body: `<b>Log class</b> tab. Pick the date, the subject and the chapter, tick or type the
      topics covered, then write what you actually did. That last box is what your blurts get
      checked against later, so write it like you are leaving a note for yourself in a week.`,
    go: '#/log',
  },
  {
    title: '2. The 1-4-7 ladder',
    body: `Each <b>class</b> gets three blurts, counted from the day it happened:
      <b>+1 day</b>, then <b>+4 more</b>, then <b>+7 more</b>.
      <br /><br />
      Class on the 14th → blurt 1 on the <b>15th</b>, blurt 2 on the <b>19th</b>,
      blurt 3 on the <b>26th</b>. Every topic taught in that class comes up together.`,
  },
  {
    title: '3. Today, and only today',
    body: `The <b>Today</b> tab shows what is due today and nothing else — no list of what is
      coming, and you cannot blurt ahead. Blurt it on paper, then hit <b>Rate it</b> and score
      each topic 1-5. <b>&hellip;</b> skips it or pushes it to tomorrow.`,
    go: '#/today',
  },
  {
    title: '4. The ratings are the point',
    body: `You never type a blurt into the app — you write it out by hand. The 1-5 score per
      topic is all it wants, and <b>Weak spots</b> ranks every topic worst-first from those
      scores. That is your revision list.
      <br /><br />
      Once a class has been through all three blurts it drops to <b>one blurt a week</b>.`,
  },
  {
    title: '5. Finished the chapter? Fortnightly',
    body: `Open the chapter, hit <b>Mark last</b> on its final topic, and turn on
      <b>Chapter finished</b>. The moment the class that taught it clears its 1-4-7, the whole
      chapter goes onto a <b>fortnightly</b> blurt and the weekly per-class blurts stop — one
      chapter blurt replaces them. Untick <i>finished</i> and it all comes back.`,
  },
  {
    title: '6. Weak spots and Settings',
    body: `<b>Weak spots</b> ranks your topics worst-first from the ratings, so you always know
      what to go back over. Everything else — themes, cloud sync, <b>147 Tasks</b>,
      reminders and backups — lives behind the <b>gear</b> in the top bar.
      <br /><br />
      Want this walkthrough again? Hit <b>?</b> next to it.`,
    go: '#/plan',
  },
];

export function tourSeen(): boolean {
  return localStorage.getItem(KEY) === 'done';
}

function markSeen(): void {
  localStorage.setItem(KEY, 'done');
}

export function startTour(): void {
  let i = 0;

  const back = document.createElement('div');
  back.className = 'tour-back';
  document.body.appendChild(back);

  const close = (go?: string) => {
    markSeen();
    back.remove();
    if (go) location.hash = go;
  };

  const draw = () => {
    const s = STEPS[i];
    const dots = STEPS.map(
      (_, n) => `<span class="tour-dot ${n === i ? 'on' : ''}"></span>`,
    ).join('');
    back.innerHTML = `
      <div class="tour-card" role="dialog" aria-modal="true">
        <div class="tour-step">Step ${i + 1} of ${STEPS.length}</div>
        <div class="tour-title">${s.title}</div>
        <div class="tour-body">${s.body}</div>
        <div class="tour-dots">${dots}</div>
        <div class="actions">
          <button class="btn ghost" data-t="skip">Skip</button>
          <span class="spacer"></span>
          ${i > 0 ? '<button class="btn" data-t="back">Back</button>' : ''}
          <button class="btn primary" data-t="next">
            ${i === STEPS.length - 1 ? 'Start using it' : 'Next'}
          </button>
        </div>
      </div>`;
  };

  back.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!t) return;
    if (t.dataset.t === 'skip') return close();
    if (t.dataset.t === 'back') {
      i = Math.max(0, i - 1);
      return draw();
    }
    if (i === STEPS.length - 1) return close(STEPS[i].go ?? '#/today');
    i += 1;
    draw();
  });

  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(back)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && i < STEPS.length - 1) {
      i += 1;
      draw();
    }
    if (e.key === 'ArrowLeft' && i > 0) {
      i -= 1;
      draw();
    }
  });

  draw();
}

export function maybeStartTour(): void {
  if (!tourSeen()) startTour();
}
