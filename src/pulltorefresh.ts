/** Pull-to-refresh, phone-style — drag down from the top of the page to sync. */

const THRESHOLD = 68;
const MAX_PULL = 100;

function anyModalOpen(): boolean {
  return !!document.querySelector('.modal-back, .tour-back');
}

export function initPullToRefresh(onRefresh: () => Promise<unknown>): void {
  const el = document.createElement('div');
  el.className = 'ptr-indicator';
  el.innerHTML = '<span class="spinner"></span>';
  document.body.appendChild(el);

  let startY = 0;
  let pulling = false;
  let refreshing = false;

  const reset = () => {
    el.style.transform = 'translate(-50%, -40px)';
    el.style.opacity = '0';
    el.classList.remove('ready');
  };

  window.addEventListener(
    'touchstart',
    (e) => {
      if (refreshing || anyModalOpen()) return;
      const top = document.scrollingElement?.scrollTop ?? 0;
      if (top > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true },
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      const top = document.scrollingElement?.scrollTop ?? 0;
      if (dy <= 0 || top > 0) {
        pulling = false;
        reset();
        return;
      }
      e.preventDefault();
      const pull = Math.min(dy * 0.5, MAX_PULL);
      el.style.transition = 'none';
      el.style.opacity = String(Math.min(pull / THRESHOLD, 1));
      el.style.transform = `translate(-50%, ${pull - 40}px)`;
      el.classList.toggle('ready', pull >= THRESHOLD);
    },
    { passive: false },
  );

  window.addEventListener('touchend', () => {
    if (!pulling || refreshing) {
      pulling = false;
      return;
    }
    pulling = false;
    el.style.transition = '';
    if (!el.classList.contains('ready')) {
      reset();
      return;
    }

    refreshing = true;
    el.classList.add('spin');
    el.style.transform = 'translate(-50%, 16px)';
    el.style.opacity = '1';
    void Promise.resolve(onRefresh()).finally(() => {
      refreshing = false;
      el.classList.remove('spin');
      reset();
    });
  });
}
