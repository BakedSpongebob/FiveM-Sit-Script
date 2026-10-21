import { h, icon } from '../util.js';

let host = null;

export function initToasts(el) {
  host = el;
}

/** Show a small notification. Returns a handle with update() and close(). */
export function toast(message, { type = 'info', timeout = 3500, action = null } = {}) {
  if (!host) return { close() {}, update() {} };
  const text = h('span.toast-text', null, message);
  const node = h('div.toast', { class: `toast-${type}`, role: 'status' },
    type === 'busy' ? h('span.spinner') : icon(type === 'error' || type === 'warn' ? 'warn' : 'info', 15),
    text,
    action ? h('button.btn.btn-small', { onclick: () => { action.fn(); close(); } }, action.label) : null,
    h('button.toast-close', { 'aria-label': 'Dismiss', onclick: () => close() }, icon('close', 12)),
  );
  host.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  let timer = timeout ? setTimeout(close, timeout) : null;
  function close() {
    clearTimeout(timer);
    node.classList.remove('show');
    setTimeout(() => node.remove(), 220);
  }
  return {
    close,
    update(msg, opts = {}) {
      text.textContent = msg;
      if (opts.type) {
        node.className = `toast toast-${opts.type} show`;
        node.firstChild.replaceWith(opts.type === 'busy' ? h('span.spinner') : icon(opts.type === 'error' || opts.type === 'warn' ? 'warn' : 'info', 15));
      }
      if (opts.timeout) {
        clearTimeout(timer);
        timer = setTimeout(close, opts.timeout);
      }
    },
  };
}
