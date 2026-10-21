// ⌘K search: cards, file names, file contents, events and commands across the whole board.
import { store } from '../store.js';
import { h, icon } from '../util.js';

let host = null;
let hooks = {};
let openState = null;

export function initPalette(el, appHooks) {
  host = el;
  hooks = appHooks;
}

function itemTitle(it) {
  switch (it.type) {
    case 'file': return it.name;
    case 'note': case 'text': return (it.text || '').split('\n')[0] || (it.type === 'note' ? 'Empty note' : 'Text');
    case 'checklist': return it.title || 'Checklist';
    case 'frame': return it.title || 'Frame';
    case 'link': return it.title || it.url;
    case 'image': return it.name || 'Image';
    case 'resource': return it.title || 'Resource';
    case 'filelist': return it.title || 'Files';
    default: return it.type;
  }
}

function search(query, mode) {
  const q = query.trim().toLowerCase();
  const results = [];
  if (!store.board) return results;
  const items = store.board.items;
  if (mode !== 'files') {
    for (const it of items) {
      const title = itemTitle(it);
      const hay = `${title} ${it.relPath || ''} ${it.type === 'note' || it.type === 'text' ? it.text || '' : ''} ${it.type === 'checklist' ? (it.entries || []).map((e) => e.text).join(' ') : ''}`.toLowerCase();
      if (!q || hay.includes(q)) {
        results.push({ group: it.type === 'file' ? 'Files' : 'Cards', icon: it.type === 'file' ? 'file' : it.type === 'frame' ? 'frame' : it.type === 'resource' ? 'resource' : 'note', title, sub: it.relPath || it.type, run: () => hooks.locate(it.id), score: title.toLowerCase().startsWith(q) ? 0 : 1 });
      }
    }
    if (store.graph && q) {
      for (const ev of store.graph.events.values()) {
        if (!ev.name.toLowerCase().includes(q)) continue;
        const where = [...ev.handlers, ...ev.triggers];
        results.push({
          group: 'Events',
          icon: 'yarn',
          title: ev.name,
          sub: `${ev.handlers.length} handler${ev.handlers.length === 1 ? '' : 's'} · ${ev.triggers.length} trigger${ev.triggers.length === 1 ? '' : 's'}`,
          run: () => {
            const ids = [...new Set(where.map((w) => w.fileId))];
            hooks.selectAndFit(ids);
          },
          score: 0,
        });
      }
      for (const res of store.graph.resources.values()) {
        for (const c of res.commands) {
          if (`/${c.name}`.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) {
            results.push({ group: 'Commands', icon: 'code', title: `/${c.name}`, sub: res.name, run: () => hooks.openEditor(c.fileId, c.line), score: 0 });
          }
        }
      }
    }
  }
  if (q.length >= 2) {
    let hits = 0;
    for (const it of items) {
      if (it.type !== 'file' || !it.content) continue;
      const lines = it.content.split('\n');
      for (let i = 0; i < lines.length && hits < 200; i++) {
        if (!lines[i].toLowerCase().includes(q)) continue;
        hits++;
        results.push({ group: 'In files', icon: 'search', title: lines[i].trim().slice(0, 140), sub: `${it.name}:${i + 1}`, run: () => hooks.openEditor(it.id, i + 1), score: 2, mono: true, query: q });
      }
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, 250);
}

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length)];
}

export function openPalette({ mode = 'all', query = '' } = {}) {
  if (openState) {
    openState.input.value = query || openState.input.value;
    openState.input.focus();
    openState.input.select();
    openState.draw();
    return;
  }
  const input = h('input.palette-input', { type: 'text', placeholder: mode === 'files' ? 'Search inside every file…' : 'Search cards, files, events, commands and code…', spellcheck: 'false' });
  input.value = query;
  const list = h('div.palette-list');
  const box = h('div.palette', null, h('div.palette-bar', null, icon('search', 16), input, h('kbd', null, 'esc')), list);
  const backdrop = h('div.palette-backdrop', null, box);
  host.append(backdrop);
  let results = [];
  let active = 0;
  const draw = () => {
    results = search(input.value, mode);
    active = Math.min(active, Math.max(0, results.length - 1));
    let group = null;
    const q = input.value.trim().toLowerCase();
    list.replaceChildren(...results.flatMap((r, i) => {
      const nodes = [];
      if (r.group !== group) {
        group = r.group;
        nodes.push(h('div.palette-group', null, group));
      }
      nodes.push(h('button.palette-item', {
        class: i === active ? 'active' : '',
        onclick: () => choose(i),
        onmousemove: () => {
          if (active === i) return;
          active = i;
          list.querySelectorAll('.palette-item').forEach((b, j) => b.classList.toggle('active', j === active));
        },
      }, icon(r.icon, 14), h('span.palette-title', { class: r.mono ? 'mono' : '' }, highlight(r.title, q)), h('span.palette-sub', null, r.sub)));
      return nodes;
    }));
    if (!results.length) list.append(h('div.palette-empty', null, input.value ? 'No matches' : 'Start typing…'));
  };
  const choose = (i) => {
    const r = results[i];
    close();
    r?.run();
  };
  const close = () => {
    backdrop.remove();
    openState = null;
  };
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('.palette-item').forEach((b, j) => b.classList.toggle('active', j === active));
      list.querySelectorAll('.palette-item')[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  openState = { input, draw, close };
  draw();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

export const paletteOpen = () => !!openState;
