// Left sidebar: boards library, workspace file trees and yarn filters.
import { store, subscribe, setUi, getItem } from '../store.js';
import { h, icon, timeAgo, fileManager } from '../util.js';
import { LINK_KINDS, YARN_COLORS, kindGroup } from '../yarn.js';

let els = {};
let hooks = {};
let boards = [];
let treeSig = '';
const collapsed = new Set();

export function initSidebar(root, appHooks) {
  hooks = appHooks;
  const boardList = h('div.sb-list');
  const wsHost = h('div.sb-ws');
  const yarnHost = h('div.sb-yarn');
  root.append(
    h('section.sb-section', null,
      h('div.sb-head', null, h('span', null, 'Boards'), h('button.btn-icon', { title: 'New board (⌘N)', onclick: () => hooks.command('board:new') }, icon('plus', 14))),
      boardList),
    h('section.sb-section.sb-grow', null,
      h('div.sb-head', null, h('span', null, 'Workspace'), h('button.btn-icon', { title: 'Import folder (⇧⌘O)', onclick: () => hooks.command('workspace:import') }, icon('folder', 14))),
      wsHost),
    h('section.sb-section', null, h('div.sb-head', null, h('span', null, 'Yarn')), yarnHost),
  );
  els = { boardList, wsHost, yarnHost };

  subscribe((changes) => {
    if (changes.has('board') || changes.has('board-name') || changes.has('boards')) refreshBoards();
    if (changes.has('board') || changes.has('items') || changes.has('workspaces') || changes.has('analysis')) renderTree();
    if (changes.has('board') || changes.has('links') || changes.has('ui')) renderYarn();
    if (changes.has('selection')) highlightSelection();
  });
}

export async function refreshBoards() {
  boards = await hooks.listBoards();
  renderBoards();
}

function renderBoards() {
  const current = store.board?.id;
  els.boardList.replaceChildren(
    ...boards.map((b) => {
      const name = h('span.sb-board-name', null, b.id === current ? store.board.name : b.name);
      return h('div.sb-board', {
        class: b.id === current ? 'active' : '',
        onclick: () => b.id !== current && hooks.switchBoard(b.id),
        ondblclick: () => hooks.renameBoard(b.id),
        oncontextmenu: (e) => {
          e.preventDefault();
          hooks.boardMenu(b, e.clientX, e.clientY);
        },
      },
      icon('board', 14),
      h('span.sb-board-text', null, name, h('span.sb-board-meta', null, `${b.itemCount} cards · ${timeAgo(b.updatedAt)}`)),
      h('button.sb-board-more', { title: 'More', onclick: (e) => { e.stopPropagation(); hooks.boardMenu(b, e.clientX, e.clientY); } }, icon('dots', 14)));
    }),
  );
}

// ---------------------------------------------------------------------------------------------

function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = (f.relPath || f.name).split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, path: node.path ? `${node.path}/${seg}` : seg, dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push(f);
  }
  return root;
}

function renderTree() {
  if (!store.board) return;
  const files = store.board.items.filter((i) => i.type === 'file');
  const sig = `${store.analysisVersion}|${store.board.workspaces.map((w) => w.id).join(',')}|${files.map((f) => `${f.id}:${f.relPath}:${f.dirty ? 1 : 0}:${f.workspaceId}`).join('|')}`;
  if (sig === treeSig) return;
  treeSig = sig;
  const blocks = [];
  for (const ws of store.board.workspaces) {
    const wsFiles = files.filter((f) => f.workspaceId === ws.id);
    const key = `ws:${ws.id}`;
    const isCollapsed = collapsed.has(key);
    blocks.push(h('div.tree-ws', null,
      h('div.tree-ws-head', { onclick: () => toggle(key) },
        h('span.tree-caret', { class: isCollapsed ? '' : 'open' }, icon('chevron', 11)),
        icon('folder', 14),
        h('span.tree-ws-name', { title: ws.root }, ws.name),
        h('span.tree-count', null, String(wsFiles.length)),
        h('button.btn-icon.tree-ws-btn', { title: 'Rescan from disk', onclick: (e) => { e.stopPropagation(); hooks.command('workspace:rescan', ws.id); } }, icon('refresh', 12)),
        h('button.btn-icon.tree-ws-btn', { title: 'Workspace options', onclick: (e) => { e.stopPropagation(); hooks.workspaceMenu(ws, e.clientX, e.clientY); } }, icon('dots', 12)),
      ),
      isCollapsed ? null : renderNode(buildTree(wsFiles), key, 1),
    ));
  }
  const loose = files.filter((f) => !f.workspaceId);
  if (loose.length) {
    const key = 'loose';
    blocks.push(h('div.tree-ws', null,
      h('div.tree-ws-head', { onclick: () => toggle(key) }, h('span.tree-caret', { class: collapsed.has(key) ? '' : 'open' }, icon('chevron', 11)), icon('file', 14), h('span.tree-ws-name', null, 'Files on this board'), h('span.tree-count', null, String(loose.length))),
      collapsed.has(key) ? null : h('div.tree-children', null, ...loose.map((f) => fileRow(f, 1))),
    ));
  }
  if (!blocks.length) {
    blocks.push(h('div.sb-empty', null, h('p', null, 'No folders yet.'), h('button.btn.btn-small', { onclick: () => hooks.command('workspace:import') }, 'Import a resource folder…'), h('p.muted', null, `or drag one from ${fileManager()} onto the board`)));
  }
  els.wsHost.replaceChildren(...blocks);
  highlightSelection();
}

function renderNode(node, keyPrefix, depth) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return h('div.tree-children', null,
    ...dirs.map((d) => {
      const key = `${keyPrefix}/${d.path}`;
      const isCollapsed = collapsed.has(key);
      return h('div.tree-dir', null,
        h('div.tree-row.tree-dir-row', { style: { paddingLeft: `${depth * 12}px` }, onclick: () => toggle(key) },
          h('span.tree-caret', { class: isCollapsed ? '' : 'open' }, icon('chevron', 11)),
          h('span.tree-label', null, d.name)),
        isCollapsed ? null : renderNode(d, keyPrefix, depth + 1));
    }),
    ...files.map((f) => fileRow(f, depth)),
  );
}

function fileRow(f, depth) {
  const role = store.graph?.files.get(f.id)?.role || 'other';
  return h('div.tree-row.tree-file', {
    'data-id': f.id,
    style: { paddingLeft: `${depth * 12 + 14}px` },
    title: f.path || f.name,
    onclick: () => hooks.locate(f.id),
    ondblclick: () => hooks.openEditor(f.id),
  },
  h('span.tree-dot', { class: `role-${role}` }),
  h('span.tree-label', null, f.name),
  f.dirty ? h('span.dirty-dot') : null);
}

function toggle(key) {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  treeSig = '';
  renderTree();
}

function highlightSelection() {
  for (const row of els.wsHost.querySelectorAll('.tree-file')) row.classList.toggle('selected', store.selection.has(row.dataset.id));
}

// ---------------------------------------------------------------------------------------------

function renderYarn() {
  if (!store.board) return;
  const counts = {};
  counts.manual = store.board.links.length;
  for (const l of store.autoLinks) {
    const g = kindGroup(l.kind);
    counts[g] = (counts[g] || 0) + 1;
  }
  const rows = Object.entries(LINK_KINDS).map(([key, info]) => {
    const on = store.ui.showKinds[key] !== false;
    return h('label.yarn-filter', { class: on ? '' : 'off' },
      h('input', {
        type: 'checkbox',
        checked: on || null,
        onchange: (e) => setUi({ showKinds: { ...store.ui.showKinds, [key]: e.target.checked } }),
      }),
      h('span.legend-dot', { style: { background: info.color } }),
      h('span.yarn-filter-label', null, info.label),
      h('span.tree-count', null, String(counts[key] || 0)));
  });
  const color = h('div.sb-yarn-colors', null,
    h('span.muted', null, 'New yarn'),
    ...YARN_COLORS.map((c) => h('button.swatch.small', { class: store.ui.yarnColor === c ? 'active' : '', style: { '--swatch': c }, title: c, onclick: () => setUi({ yarnColor: c }) })),
  );
  const style = store.board.settings.yarnStyle || 'pinned';
  const styleToggle = h('div.segmented.small', null,
    h('button', { class: style === 'pinned' ? 'active' : '', onclick: () => hooks.command('view:yarnStyle', 'pinned'), title: 'Classic bulletin board: pins and yarn on top' }, 'Pinned'),
    h('button', { class: style === 'clean' ? 'active' : '', onclick: () => hooks.command('view:yarnStyle', 'clean'), title: 'Yarn runs behind cards, edge to edge' }, 'Clean'),
  );
  els.yarnHost.replaceChildren(...rows, color, styleToggle);
}

export function revealInTree(id) {
  const it = getItem(id);
  if (!it || it.type !== 'file') return;
  const row = els.wsHost.querySelector(`.tree-file[data-id="${CSS.escape(id)}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}
