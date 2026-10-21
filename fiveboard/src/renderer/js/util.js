export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Tiny DOM builder: h('div.card', { onclick }, child, 'text'). Text is always set as text, never HTML. */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'title') el.setAttribute('title', keys(v));
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  note: 'M5 3h10l4 4v14H5zM15 3v4h4',
  text: 'M5 6h14M12 6v13M9 19h6',
  checklist: 'M4 6l2 2 3-3M11 7h9M4 13l2 2 3-3M11 14h9M11 20h9',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  folder: 'M3 6h6l2 2h10v11H3z',
  frame: 'M4 4h16v16H4zM4 9h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  yarn: 'M4 18c4-10 12-10 16 0M5 18a1.5 1.5 0 1 0 0-.01M19 18a1.5 1.5 0 1 0 0-.01',
  pointer: 'M6 3l12 9-6 1 3 7-3 1-3-7-4 4z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.4-1.8L8 15',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  inspector: 'M4 5h16v14H4zM15 5v14',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  reveal: 'M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5L12 16l2.5-2.5',
  refresh: 'M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5l2-2.5M20 20v-5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  resource: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  board: 'M4 4h16v12H4zM8 20l4-4 4 4',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8v.5',
  snippet: 'M8 4H6a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  export: 'M12 15V3M8 7l4-4 4 4M5 13v7h14v-7',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  filelist: 'M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12',
  menu: 'M4 7h16M4 12h16M4 17h16',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.dots);
  svg.append(path);
  return svg;
}

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function basename(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

export function dirname(p) {
  const parts = String(p || '').split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

/** Join path parts using the separator style of the first part (so Windows paths stay backslashed). */
export function joinPath(...parts) {
  const list = parts.filter(Boolean).map(String);
  const sep = list[0]?.includes('\\') && !list[0].includes('/') ? '\\' : '/';
  const joined = list.map((p, i) => (i === 0 ? p : p.replace(/[\\/]/g, sep))).join(sep);
  return sep === '/' ? joined.replace(/\/{2,}/g, '/') : joined.replace(/\\{2,}/g, '\\');
}

export const isMac = () => document.body.classList.contains('platform-darwin');

export const isWindows = () => document.body.classList.contains('platform-win32');

/** Name of the OS file browser, for "Show in …" labels. */
export const fileManager = () => (isMac() ? 'Finder' : isWindows() ? 'Explorer' : 'file manager');

/**
 * Shortcut labels are written Mac-style (⇧⌘O). On Windows and Linux they become Ctrl+Shift+O.
 * Works on whole sentences, so it can be applied to tooltips and help text.
 */
export function keys(text) {
  if (typeof text !== 'string' || isMac() || !/[⌃⌥⇧⌘⌫↩]/.test(text)) return text;
  return text
    .replace(/⌘-scroll/g, 'Ctrl+scroll')
    .replace(/([⌃⌥⇧⌘]+)(Space|[A-Za-z0-9]|[=\-\\/.,[\]`])?/g, (_, mods, key = '') => {
      const parts = [];
      if (mods.includes('⌘') || mods.includes('⌃')) parts.push('Ctrl');
      if (mods.includes('⇧')) parts.push('Shift');
      if (mods.includes('⌥')) parts.push('Alt');
      if (key) parts.push(key);
      return parts.join('+') + (key ? '' : '+');
    })
    .replace(/⌫/g, 'Backspace')
    .replace(/↩/g, 'Enter');
}

/** vscode:// link that opens a file, for both POSIX and Windows paths. */
export function vscodeUrl(p) {
  let norm = String(p).replace(/\\/g, '/');
  if (!norm.startsWith('/')) norm = `/${norm}`;
  return `vscode://file${encodeURI(norm)}`;
}

export const modKey = (e) => (isMac() ? e.metaKey : e.ctrlKey);

export function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('.CodeMirror')) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function boundsOf(items) {
  if (!items.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const it of items) {
    x1 = Math.min(x1, it.x);
    y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w);
    y2 = Math.max(y2, it.y + it.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
