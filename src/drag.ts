/**
 * Drag to reorder, for touch and mouse alike.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does nothing
 * on a phone. Markup contract:
 *   <div data-drag-list="key">               the list
 *     <div data-drag-item="id">              each item, a direct child
 *       <span data-drag-handle>⠿</span>      grab here (only here, so the
 *                                            rest of the row still scrolls)
 * Lists can nest (sub topics inside a topic): a handle belongs to its nearest
 * item, and that item's parent is the list it moves within.
 *
 * The dragged item follows the finger; whenever it passes the halfway point of
 * a neighbour it swaps places with it in the DOM, and the neighbour slides
 * into its new spot. Near the top or bottom of the screen the page scrolls on
 * its own so a long chapter can be dragged end to end. Nothing is saved until
 * the drop, and only if the order actually changed.
 */

let active = false;
let pending: (() => void) | null = null;

/** True mid-drag — tab swipes and pull-to-refresh stand down while it is. */
export const isDragging = (): boolean => active;

/** Is this touch starting on a drag handle? Gesture handlers ignore those. */
export const onDragHandle = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('[data-drag-handle]');

/**
 * A full re-render mid-drag would rip the list out from under the finger.
 * Call this first from the renderer: if a drag is on, the render is held until
 * the drop and this returns true.
 */
export function holdWhileDragging(render: () => void): boolean {
  if (!active) return false;
  pending = render;
  return true;
}

const EDGE = 90; // px from the top/bottom of the screen where auto-scroll kicks in
const MAX_SPEED = 18; // px per frame at the very edge

const itemsOf = (list: Element) =>
  [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && 'dragItem' in c.dataset);

/** Slides an element from where it was (oldTop) to where it now sits. */
function slide(el: HTMLElement, oldTop: number): void {
  const d = oldTop - el.offsetTop;
  if (!d) return;
  el.style.transition = 'none';
  el.style.transform = `translateY(${d}px)`;
  requestAnimationFrame(() => {
    el.style.transition = 'transform 160ms ease';
    el.style.transform = '';
  });
}

export function enableDragSort(
  root: HTMLElement,
  onDrop: (listKey: string, ids: string[]) => void | Promise<void>,
): void {
  root.addEventListener('pointerdown', (e) => {
    if (active || e.button !== 0) return;
    const handle = (e.target as Element).closest<HTMLElement>('[data-drag-handle]');
    const item = handle?.closest<HTMLElement>('[data-drag-item]');
    const list = item?.parentElement;
    if (!handle || !item || !list || !('dragList' in list.dataset)) return;

    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    active = true;

    const before = itemsOf(list).map((x) => x.dataset.dragItem!);
    const pageY = (clientY: number) => clientY + window.scrollY;
    // The pointer's page-Y at which the item sits exactly in its layout slot.
    let origin = pageY(e.clientY);
    let clientY = e.clientY;
    let frame = 0;

    item.classList.add('dragging');
    item.style.transition = 'none';

    const follow = () => {
      const y = pageY(clientY);
      let dy = y - origin;
      // Swap past neighbours until the item sits between the right two. A
      // swap fires once the item is past HALF the distance it would move —
      // that distance includes the gap between rows, so right after a swap
      // the item is less than half-way back and can't flip straight back
      // (thresholding on the neighbour's own height alone ping-ponged forever
      // whenever the gap made the jump bigger than twice that half). The cap
      // is a second guard: a list can't need more swaps than it has items.
      const sibs0 = itemsOf(list).length;
      for (let guard = 0; guard <= sibs0; guard++) {
        const sibs = itemsOf(list);
        const i = sibs.indexOf(item);
        const next = sibs[i + 1];
        const prev = sibs[i - 1];
        const down = next ? next.offsetTop + next.offsetHeight - (item.offsetTop + item.offsetHeight) : 0;
        const up = prev ? item.offsetTop - prev.offsetTop : 0;
        if (next && down > 0 && dy > down / 2) {
          const [mine, theirs] = [item.offsetTop, next.offsetTop];
          list.insertBefore(next, item);
          origin += item.offsetTop - mine;
          slide(next, theirs);
        } else if (prev && up > 0 && -dy > up / 2) {
          // Move the neighbour, never the dragged item: taking the item out
          // of the DOM, even for an instant, drops its pointer capture and
          // the drag dies mid-gesture.
          const [mine, theirs] = [item.offsetTop, prev.offsetTop];
          list.insertBefore(prev, item.nextSibling);
          origin += item.offsetTop - mine;
          slide(prev, theirs);
        } else break;
        dy = y - origin;
      }
      item.style.transform = `translateY(${dy}px)`;
    };

    const autoScroll = () => {
      const h = window.innerHeight;
      let v = 0;
      if (clientY < EDGE) v = -MAX_SPEED * (1 - clientY / EDGE);
      else if (clientY > h - EDGE) v = MAX_SPEED * (1 - (h - clientY) / EDGE);
      if (v) {
        window.scrollBy(0, v);
        follow();
      }
      frame = requestAnimationFrame(autoScroll);
    };
    frame = requestAnimationFrame(autoScroll);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      clientY = ev.clientY;
      follow();
    };

    const end = async (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      item.classList.remove('dragging');
      item.style.transform = '';
      item.style.transition = '';

      const after = itemsOf(list).map((x) => x.dataset.dragItem!);
      active = false;
      const held = pending;
      pending = null;
      if (after.join('\u0000') !== before.join('\u0000')) {
        await onDrop(list.dataset.dragList!, after);
      }
      held?.();
    };

    // On window rather than the handle: if capture is ever lost, the drag
    // still ends cleanly instead of leaving the list stuck mid-drag.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
