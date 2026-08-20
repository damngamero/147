/** Swipe left/right between the four main tabs — touch only, phone-style. */
import { parseHash } from './router';

const ORDER = ['today', 'log', 'plan', 'subjects'] as const;
type TabName = (typeof ORDER)[number];

const HREF: Record<TabName, string> = {
  today: '#/today',
  log: '#/log',
  plan: '#/plan',
  subjects: '#/subjects',
};

const THRESHOLD = 70;

function anyModalOpen(): boolean {
  return !!document.querySelector('.modal-back, .tour-back');
}

export function initSwipeNav(): void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  window.addEventListener(
    'touchstart',
    (e) => {
      if (anyModalOpen()) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true },
  );

  window.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;

      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Mostly-horizontal and past the threshold — anything more vertical is a scroll, not a swipe.
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      // Only on the four main tabs — a detail/help/settings page has no "next tab" to swipe to.
      const idx = ORDER.indexOf(parseHash().name as TabName);
      if (idx === -1) return;

      const next = idx + (dx < 0 ? 1 : -1);
      if (next < 0 || next >= ORDER.length) return;
      location.hash = HREF[ORDER[next]];
    },
    { passive: true },
  );
}
