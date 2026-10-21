// Floating context menus with keyboard navigation and nested submenus.
import { h, icon } from '../util.js';

let host = null;
let open = [];

export function initMenus(el) {
  host = el;
  window.addEventListener('pointerdown', (e) => {
    if (open.length && !e.target.closest('.ctx-menu')) closeMenus();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (!open.length) return;
    const menu = open[open.length - 1];
    const buttons = [...menu.el.querySelectorAll(':scope > .ctx-item:not([disabled])')];
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenus(open.length - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (e.key === 'ArrowRight' && document.activeElement?.dataset.submenu) {
      e.preventDefault();
      document.activeElement.dispatchEvent(new Event('mouseenter'));
    } else if (e.key === 'ArrowLeft' && open.length > 1) {
      e.preventDefault();
      closeMenus(open.length - 1);
    }
  }, true);
  window.addEventListener('blur', () => closeMenus());
  window.addEventListener('resize', () => closeMenus());
}

export function closeMenus(fromLevel = 0) {
  while (open.length > fromLevel) open.pop().el.remove();
}

/**
 * items: [{ label, icon, shortcut, action, disabled, danger, checked, swatch, submenu: [...] } | { separator: true } | { heading }]
 */
export function showMenu(x, y, items, { level = 0, anchor = null } = {}) {
  closeMenus(level);
  const el = h('div.ctx-menu', { role: 'menu' });
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      el.append(h('div.ctx-sep'));
      continue;
    }
    if (item.heading) {
      el.append(h('div.ctx-heading', null, item.heading));
      continue;
    }
    if (item.swatches) {
      el.append(h('div.ctx-swatches', null, ...item.swatches.map((s) =>
        h('button.ctx-swatch', {
          title: s.label || s.color,
          class: s.active ? 'active' : '',
          style: { '--swatch': s.color },
          onclick: () => {
            closeMenus();
            s.action();
          },
        }),
      )));
      continue;
    }
    const btn = h('button.ctx-item', { role: 'menuitem', disabled: item.disabled || null, class: item.danger ? 'danger' : '' },
      h('span.ctx-icon', null, item.icon ? icon(item.icon, 14) : item.checked ? '✓' : ''),
      h('span.ctx-label', null, item.label),
      item.shortcut ? h('span.ctx-shortcut', null, item.shortcut) : null,
      item.submenu ? h('span.ctx-arrow', null, icon('chevron', 12)) : null,
    );
    if (item.submenu) {
      btn.dataset.submenu = '1';
      const openSub = () => {
        const r = btn.getBoundingClientRect();
        showMenu(r.right - 4, r.top - 6, item.submenu, { level: level + 1, anchor: r });
      };
      btn.addEventListener('mouseenter', openSub);
      btn.addEventListener('click', openSub);
    } else {
      btn.addEventListener('mouseenter', () => closeMenus(level + 1));
      btn.addEventListener('click', () => {
        closeMenus();
        item.action?.();
      });
    }
    el.append(btn);
  }
  host.append(el);
  const r = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + r.width > window.innerWidth - 8) left = anchor ? anchor.left - r.width + 4 : window.innerWidth - r.width - 8;
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  open.push({ el, level });
  if (level === 0) el.querySelector('.ctx-item')?.focus({ preventScroll: true });
  return el;
}

export const menuOpen = () => open.length > 0;
