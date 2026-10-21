// Lightweight in-app dialogs: text prompts, option pickers and info sheets.
import { h, icon } from '../util.js';

let host = null;

export function initModals(el) {
  host = el;
}

function openModal(content, { onClose, wide = false } = {}) {
  const backdrop = h('div.modal-backdrop');
  const box = h('div.modal', { class: wide ? 'modal-wide' : '', role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(box);
  host.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const close = (value) => {
    backdrop.classList.remove('show');
    backdrop.style.pointerEvents = 'none';
    window.removeEventListener('keydown', onKey, true);
    setTimeout(() => backdrop.remove(), 160);
    onClose?.(value);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(null);
    }
  };
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close(null);
  });
  return { box, close };
}

export function prompt(title, { value = '', placeholder = '', label = '', okLabel = 'OK', multiline = false } = {}) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea.modal-input', { rows: 4, placeholder, spellcheck: 'false' })
      : h('input.modal-input', { type: 'text', placeholder, spellcheck: 'false' });
    input.value = value;
    const form = h('form.modal-form', null,
      h('h2.modal-title', null, title),
      label ? h('p.modal-label', null, label) : null,
      input,
      h('div.modal-actions', null,
        h('button.btn', { type: 'button', onclick: () => m.close(null) }, 'Cancel'),
        h('button.btn.btn-primary', { type: 'submit' }, okLabel),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      m.close(input.value);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) m.close(input.value);
    });
    const m = openModal(form, { onClose: resolve });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/** options: [{ id, title, description, icon, group }] → resolves the chosen id (or null). */
export function pick(title, options, { subtitle = '', extra = null } = {}) {
  return new Promise((resolve) => {
    const search = h('input.modal-input', { type: 'text', placeholder: 'Filter…', spellcheck: 'false' });
    const list = h('div.pick-list');
    let active = 0;
    let shown = options;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      shown = options.filter((o) => !q || `${o.title} ${o.description || ''} ${o.group || ''}`.toLowerCase().includes(q));
      active = Math.min(active, Math.max(0, shown.length - 1));
      let group = null;
      list.replaceChildren(...shown.flatMap((o, i) => {
        const nodes = [];
        if (o.group && o.group !== group) {
          group = o.group;
          nodes.push(h('div.pick-group', null, o.group));
        }
        nodes.push(h('button.pick-item', {
          type: 'button',
          class: i === active ? 'active' : '',
          onclick: () => m.close(o.id),
          onmouseenter: () => {
            active = i;
            list.querySelectorAll('.pick-item').forEach((b, j) => b.classList.toggle('active', j === active));
          },
        },
        h('span.pick-icon', null, icon(o.icon || 'snippet', 16)),
        h('span.pick-text', null, h('span.pick-title', null, o.title), o.description ? h('span.pick-desc', null, o.description) : null)));
        return nodes;
      }));
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
        draw();
        list.querySelector('.pick-item.active')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[active]) m.close(shown[active].id);
      } else if (e.key === 'Escape') {
        m.close(null);
      }
    });
    const content = h('div.modal-form', null,
      h('h2.modal-title', null, title),
      subtitle ? h('p.modal-label', null, subtitle) : null,
      extra,
      search,
      list,
    );
    const m = openModal(content, { onClose: resolve, wide: true });
    draw();
    requestAnimationFrame(() => search.focus());
  });
}

export function sheet(title, body) {
  return new Promise((resolve) => {
    const content = h('div.modal-form', null,
      h('h2.modal-title', null, title),
      body,
      h('div.modal-actions', null, h('button.btn.btn-primary', { type: 'button', onclick: () => m.close(true) }, 'Done')),
    );
    const m = openModal(content, { onClose: resolve, wide: true });
  });
}
