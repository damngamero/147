import './styles.css';
import { setRenderer } from './app';
import { cloudState, initCloud, sync, syncSoon } from './cloud';
import { initPullToRefresh } from './pulltorefresh';
import { onSyscalChange, syscalSoon } from './syscal';
import { applyTheme } from './theme';
import { parseHash, type Route } from './router';
import { dueBy, syncSchedule } from './schedule';
import { boot, subscribe } from './state';
import { refreshNotifications } from './notify';
import { maybeStartTour } from './tour';
import { checkAndPrompt } from './updateBanner';
import * as blurtView from './views/blurt';
import * as chapterView from './views/chapter';
import * as helpView from './views/help';
import * as logView from './views/log';
import * as planView from './views/plan';
import * as settingsView from './views/settings';
import * as subjectView from './views/subject';
import * as subjectsView from './views/subjects';
import * as todayView from './views/today';

const TABS = [
  { name: 'today', label: 'Today', href: '#/today' },
  { name: 'log', label: 'Log class', href: '#/log' },
  { name: 'plan', label: 'Weak spots', href: '#/plan' },
  { name: 'subjects', label: 'Subjects', href: '#/subjects' },
];

const app = document.getElementById('app')!;

function shellHtml(): string {
  const tabs = TABS.map(
    (t) => `<a class="tab" data-tab="${t.name}" href="${t.href}">${t.label}</a>`,
  ).join('');
  return `
    <header class="topbar">
      <div class="brand">1<span>4</span>7</div>
      <div class="spacer"></div>
      <a class="sync-dot" data-slot="sync" href="#/settings"></a>
      <div class="small dim" data-slot="due"></div>
      <a class="help-btn" href="#/settings" title="Settings">&#9881;</a>
      <a class="help-btn" href="#/help" title="How 147 works">?</a>
    </header>
    <nav class="tabs">${tabs}</nav>`;
}

function highlightTabs(route: Route): void {
  const active =
    route.name === 'subject' || route.name === 'chapter' ? 'subjects' : route.name;
  for (const el of app.querySelectorAll<HTMLElement>('.tab')) {
    el.classList.toggle('on', el.dataset.tab === active);
  }
}

function viewFor(route: Route): { html: string; wire: (root: HTMLElement) => void } {
  switch (route.name) {
    case 'log':
      return { html: logView.render(route), wire: (r) => logView.wire(r, route) };
    case 'plan':
      return { html: planView.render(), wire: (r) => planView.wire(r) };
    case 'help':
      return { html: helpView.render(), wire: (r) => helpView.wire(r) };
    case 'settings':
      return { html: settingsView.render(), wire: (r) => settingsView.wire(r) };
    case 'blurt':
      return {
        html: blurtView.render(route.param),
        wire: (r) => blurtView.wire(r, route.param),
      };
    case 'subjects':
      return { html: subjectsView.render(), wire: (r) => subjectsView.wire(r) };
    case 'subject':
      return {
        html: subjectView.render(route.param),
        wire: (r) => subjectView.wire(r, route.param),
      };
    case 'chapter':
      return {
        html: chapterView.render(route.param),
        wire: (r) => chapterView.wire(r, route.param),
      };
    case 'today':
    default:
      return { html: todayView.render(), wire: (r) => todayView.wire(r) };
  }
}

function render(): void {
  const route = parseHash();
  const view = viewFor(route);

  // A fresh <main> each time, so the previous view's listeners die with its node.
  const main = document.createElement('main');
  main.innerHTML = view.html;

  const old = app.querySelector('main');
  if (old) old.replaceWith(main);
  else app.appendChild(main);

  highlightTabs(route);

  const slot = app.querySelector('[data-slot="due"]');
  if (slot) {
    const n = dueBy().length;
    slot.textContent = n ? `${n} due` : 'all clear';
    slot.classList.toggle('overdue', n > 0);
  }

  const syncDot = app.querySelector<HTMLElement>('[data-slot="sync"]');
  if (syncDot) {
    const c = cloudState();
    syncDot.classList.remove('on', 'syncing', 'error');
    if (!c.configured) {
      syncDot.style.display = 'none';
    } else {
      syncDot.style.display = '';
      if (c.error) {
        syncDot.classList.add('error');
        syncDot.title = `Sync error — ${c.error}`;
      } else if (c.syncing) {
        syncDot.classList.add('syncing');
        syncDot.title = 'Syncing…';
      } else if (c.linked) {
        syncDot.classList.add('on');
        syncDot.title = c.lastSync ? `Synced — last sync ${new Date(c.lastSync).toLocaleTimeString()}` : 'Synced';
      } else {
        syncDot.title = 'Cloud sync connected, not linked yet';
      }
    }
  }

  view.wire(main);
}

let syncing = false;

function syncThenRender(): void {
  render();
  if (syncing) return;
  syncing = true;
  void syncSchedule()
    .then(() => refreshNotifications())
    .then(() => {
      syncSoon();
      syscalSoon();
    })
    .finally(() => {
      syncing = false;
    });
}

/** Pull-to-refresh forces an immediate cloud sync, unlike the normal debounced one. */
async function forceRefresh(): Promise<void> {
  await syncSchedule();
  await refreshNotifications();
  if (cloudState().linked) await sync();
  syscalSoon();
  render();
}

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Runs on launch, then again every few hours in the background — entirely silent unless something is found. */
function watchForUpdates(): void {
  checkAndPrompt();
  window.setInterval(checkAndPrompt, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAndPrompt();
  });
}

/** The queue is date-based, so a tab left open overnight has to re-sort itself. */
function watchDayRollover(): void {
  let day = new Date().getDate();
  window.setInterval(() => {
    const now = new Date().getDate();
    if (now !== day) {
      day = now;
      syncThenRender();
    }
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncThenRender();
  });
}

async function start(): Promise<void> {
  applyTheme();
  app.innerHTML = shellHtml();
  await boot();
  await syncSchedule();
  setRenderer(render);
  subscribe(syncThenRender);
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/today';
  render();
  watchDayRollover();
  void refreshNotifications();
  void initCloud(render);
  onSyscalChange(render);
  initPullToRefresh(forceRefresh);
  watchForUpdates();
  maybeStartTour();
}

void start();
