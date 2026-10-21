/**
 * Small DOM helpers. Deliberately avoids window.prompt/confirm — Electron does
 * not implement prompt(), and the Android WebView styles them badly.
 */
import { esc } from './util';

export function toast(msg: string, ms = 1800): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

interface ModalOpts {
  title: string;
  body?: string;
  okLabel?: string;
  danger?: boolean;
}

function shell(opts: ModalOpts, inner: string, danger = false): HTMLElement {
  const back = document.createElement('div');
  back.className = 'modal-back';
  // title/body can contain user data (a topic or class name, say) that syncs in from
  // another device — escape both so that never runs as HTML/script here.
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-title">${esc(opts.title)}</div>
      ${opts.body ? `<p class="muted small">${esc(opts.body)}</p>` : ''}
      ${inner}
      <div class="actions" style="margin-top:16px">
        <span class="spacer"></span>
        <button class="btn ghost" data-x="cancel">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${opts.okLabel ?? 'OK'}</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  return back;
}

export function askText(
  opts: ModalOpts & { label?: string; value?: string; multiline?: boolean },
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = opts.multiline
      ? `<textarea data-x="input">${esc(opts.value ?? '')}</textarea>`
      : `<input type="text" data-x="input" value="${esc(opts.value ?? '')}" />`;
    const back = shell(
      opts,
      `<div class="field">${opts.label ? `<label>${esc(opts.label)}</label>` : ''}${input}</div>`,
    );
    const field = back.querySelector<HTMLInputElement>('[data-x="input"]')!;
    field.focus();
    field.select();

    const close = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === back || t.dataset.x === 'cancel') close(null);
      if (t.dataset.x === 'ok') close(field.value.trim() || null);
    });
    // On the container, so it still fires if focus drifts off the input.
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !opts.multiline) {
        e.preventDefault();
        close(field.value.trim() || null);
      }
      if (e.key === 'Escape') close(null);
    });
  });
}

export interface Action {
  value: string;
  label: string;
  danger?: boolean;
}

/** A small menu: one big button per action, plus Cancel. Resolves to the picked value, or null. */
export function askAction(opts: { title: string; body?: string; actions: Action[] }): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">${esc(opts.title)}</div>
        ${opts.body ? `<p class="muted small">${esc(opts.body)}</p>` : ''}
        <div class="action-list">
          ${opts.actions
            .map(
              (a) =>
                `<button class="btn ${a.danger ? 'danger' : ''}" data-x="act" data-v="${esc(a.value)}">${esc(a.label)}</button>`,
            )
            .join('')}
          <button class="btn ghost" data-x="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (e.target === back || t?.dataset.x === 'cancel') close(null);
      else if (t?.dataset.x === 'act') close(t.dataset.v ?? null);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });
    back.querySelector<HTMLElement>('[data-x="act"]')?.focus();
  });
}

export interface ChoiceGroup {
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** A dropdown in a modal. Resolves to the picked value, or null if dismissed. */
export function askChoice(
  opts: ModalOpts & { label?: string; groups: ChoiceGroup[]; value?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    const groups = opts.groups
      .filter((g) => g.options.length)
      .map(
        (g) => `<optgroup label="${esc(g.label)}">${g.options
          .map(
            (o) =>
              `<option value="${esc(o.value)}" ${o.value === opts.value ? 'selected' : ''}>${esc(o.label)}</option>`,
          )
          .join('')}</optgroup>`,
      )
      .join('');
    const back = shell(
      opts,
      `<div class="field">${opts.label ? `<label>${esc(opts.label)}</label>` : ''}<select data-x="input">${groups}</select></div>`,
      opts.danger,
    );
    const field = back.querySelector<HTMLSelectElement>('[data-x="input"]')!;
    const close = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === back || t.dataset.x === 'cancel') close(null);
      if (t.dataset.x === 'ok') close(field.value || null);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });
    field.focus();
  });
}

export function confirmBox(opts: ModalOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const back = shell(opts, '', opts.danger);
    const close = (v: boolean) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === back || t.dataset.x === 'cancel') close(false);
      if (t.dataset.x === 'ok') close(true);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(true);
      if (e.key === 'Escape') close(false);
    });
    back.querySelector<HTMLElement>('[data-x="ok"]')?.focus();
  });
}

/** Delegated click handler: fires when a click lands on [data-act="name"]. */
export function onAct(
  root: HTMLElement,
  handler: (act: string, el: HTMLElement, ev: MouseEvent) => void,
): void {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el && root.contains(el)) handler(el.dataset.act!, el, ev as MouseEvent);
  });
}
