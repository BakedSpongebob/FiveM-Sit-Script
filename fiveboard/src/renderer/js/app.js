// FiveBoard renderer entry point: wires the board, panels, menus, shortcuts and file handling together.
import {
  store, subscribe, getItem, getLink, checkpoint, addItems, updateItem, updateItems, removeItems, removeLinks,
  setSelection, setEditing, setUi, setBoardSetting, bringToFront, sendToBack, addLink, undo, redo,
  setWorkspaces, renameBoard, notify,
} from './store.js';
import { initBoard, itemAtPoint, renameFrame } from './board.js';
import { zoomBy, fitRect, setView, worldCenter, screenToWorld, centerOn, visibleWorldRect } from './viewport.js';
import { makeNote, makeText, makeChecklist, makeFrame, makeLink, makeImage, makeFile, fitSize, FILE_W, FILE_H } from './factory.js';
import { importFolder, rescanWorkspace, onFilesChanged, addFilesAt, exportFrameToFolder } from './importer.js';
import { initAnalysis } from './analysis.js';
import {
  initEditor, openInEditor, toggleEditor, saveActive, saveAll, closeTab, isEditorOpen, insertAtCursor,
} from './editor.js';
import { initInspector } from './ui/inspector.js';
import { initSidebar, revealInTree } from './ui/sidebar.js';
import { initPalette, openPalette, paletteOpen } from './ui/palette.js';
import { initMinimap } from './ui/minimap.js';
import { initMenus, showMenu, closeMenus, menuOpen } from './ui/menu.js';
import { initModals, prompt, pick, sheet } from './ui/modal.js';
import { initToasts, toast } from './ui/toast.js';
import {
  initPersistence, onSaveStatus, newBoard, switchBoard, deleteBoard, renameBoardById, duplicateBoard,
  exportCurrentBoard, importBoardFile, listBoards,
} from './persistence.js';
import { SCAFFOLDS, SNIPPETS, fillTemplate } from './fivem/snippets.js';
import { detectLanguage } from './fivem/analyzer.js';
import { YARN_COLORS, kindGroup, LINK_KINDS } from './yarn.js';
import { NOTE_COLORS } from './items.js';
import { h, icon, uid, boundsOf, rectContains, isEditableTarget, modKey, basename } from './util.js';

const $ = (sel) => document.querySelector(sel);
let lastPointer = null;
const fitting = new Set();

// ---------------------------------------------------------------------------------------------
// Boot

async function boot() {
  const info = await window.api.info();
  document.body.classList.add(`platform-${info.platform}`);
  const theme = (await window.api.settings.get('theme')) || 'dark';
  document.body.dataset.theme = theme;
  for (const [key, cls] of [['sidebarHidden', 'sidebar-hidden'], ['inspectorHidden', 'inspector-hidden'], ['minimapHidden', 'minimap-hidden']]) {
    if (await window.api.settings.get(key)) document.body.classList.add(cls);
  }

  initToasts($('#toasts'));
  initMenus($('#menus'));
  initModals($('#modal-root'));
  initPalette($('#palette-root'), { locate, openEditor, selectAndFit });
  buildChrome();

  initBoard(
    {
      viewport: $('#viewport'),
      world: $('#world'),
      frames: $('#layer-frames'),
      items: $('#layer-items'),
      yarn: $('#layer-yarn'),
      yarnAuto: $('#layer-yarn-auto'),
      yarnFocus: $('#layer-yarn-focus'),
      marquee: $('#marquee'),
    },
    {
      openEditor,
      openUrl,
      exportFrame: exportFrameToFolder,
      contextMenu,
      closeMenus,
      editLinkLabel,
      editLink,
      createAt,
    },
  );
  initEditor($('#editor'), { locate, onToggle: (open) => $('#btn-editor').classList.toggle('active', open) });
  initInspector($('#inspector'), {
    toggle: (show) => togglePanel('inspector', show),
    command: run,
    openEditor,
    locate,
    search: (q) => openPalette({ query: q }),
    openUrl,
    exportFrame: exportFrameToFolder,
    fitFrame,
    reloadFile,
    resetImage,
  });
  initSidebar($('#sidebar'), {
    command: run,
    listBoards,
    switchBoard,
    renameBoard: renameBoardPrompt,
    boardMenu,
    workspaceMenu,
    locate,
    openEditor,
  });
  initMinimap($('#minimap'));
  initAnalysis();
  initStatusBar();
  initKeyboard();
  initClipboard();
  initDrop();
  subscribe(onStoreChange);

  window.api.onMenu(({ command, payload }) => run(command, payload));
  window.api.onFsChanged((ev) => onFilesChanged(ev));
  window.api.onOpenFile((p) => openExternalFile(p));

  await initPersistence();
  // Handy from DevTools (View → Developer) and used by the end-to-end smoke test.
  window.fiveboard = { store, run, importFolder, openEditor, locate };
  const { openFiles } = await window.api.ready();
  for (const p of openFiles || []) openExternalFile(p);
}

function openExternalFile(p) {
  if (/\.(fiveboard|json)$/i.test(p)) importBoardFile(p);
}

function onStoreChange(changes) {
  if (changes.has('board') || changes.has('board-name')) {
    $('#board-name').textContent = store.board?.name || 'Untitled';
    document.title = `${store.board?.name || 'Board'} — FiveBoard`;
  }
  if (changes.has('items') || changes.has('board')) fitPendingImages();
}

// ---------------------------------------------------------------------------------------------
// Chrome: toolbar, zoom controls, status bar

function toolButton(name, title, onClick, extra = {}) {
  return h('button.tool', { title, onclick: onClick, ...extra }, icon(name, 17));
}

function buildChrome() {
  $('#btn-sidebar').append(icon('sidebar', 17));
  $('#btn-sidebar').addEventListener('click', () => togglePanel('sidebar'));
  $('#btn-search').append(icon('search', 17));
  $('#btn-search').addEventListener('click', () => openPalette());
  $('#btn-editor').append(icon('code', 17));
  $('#btn-editor').addEventListener('click', () => toggleEditor());
  $('#btn-inspector').append(icon('inspector', 17));
  $('#btn-inspector').addEventListener('click', () => togglePanel('inspector'));
  $('#board-name').addEventListener('click', () => renameBoardPrompt(store.board.id));

  const select = toolButton('pointer', 'Select (V)', () => setUi({ tool: 'select' }), { 'data-tool': 'select' });
  const hand = toolButton('hand', 'Hand — pan the board (H, or hold Space)', () => setUi({ tool: 'hand' }), { 'data-tool': 'hand' });
  const toolbar = $('#toolbar');
  toolbar.append(
    h('div.tool-group', null, select, hand),
    h('div.tool-group', null,
      toolButton('note', 'Sticky note (N)', () => run('insert:note')),
      toolButton('text', 'Text (T)', () => run('insert:text')),
      toolButton('checklist', 'Checklist (L)', () => run('insert:checklist')),
      toolButton('frame', 'Frame (G)', () => run('insert:frame')),
      toolButton('image', 'Image (I)', () => run('insert:image')),
      toolButton('link', 'Link (U)', () => run('insert:link')),
    ),
    h('div.tool-group', null,
      toolButton('file', 'Add files (⇧⌘A)', () => run('files:add')),
      toolButton('folder', 'Import folder / resource (⇧⌘O)', () => run('workspace:import')),
    ),
    h('div.tool-group.fivem', null,
      h('button.tool.tool-wide', { title: 'New FiveM resource from a template (⇧⌘N)', onclick: () => run('fivem:scaffold') }, icon('resource', 16), h('span', null, 'Resource')),
      h('button.tool.tool-wide', { title: 'FiveM snippets (⇧⌘I)', onclick: () => run('fivem:snippet') }, icon('snippet', 16), h('span', null, 'Snippet')),
    ),
    h('div.tool-group', null,
      h('button.tool.yarn-color', { title: 'Color for new yarn', onclick: (e) => yarnColorMenu(e.currentTarget) }, h('span.yarn-swatch')),
    ),
  );
  const updateTools = () => {
    for (const b of toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === store.ui.tool);
    $('.yarn-swatch').style.background = store.ui.yarnColor;
    $('#viewport').classList.toggle('tool-hand', store.ui.tool === 'hand');
  };
  subscribe((c) => c.has('ui') && updateTools());
  updateTools();

  const zoomLabel = h('button.zoom-label', { title: 'Reset to 100% (⌘0)', onclick: () => run('view:zoomReset') });
  $('#zoom-controls').append(
    h('button.btn-icon', { title: 'Zoom out (⌘-)', onclick: () => run('view:zoomOut') }, icon('minus', 14)),
    zoomLabel,
    h('button.btn-icon', { title: 'Zoom in (⌘=)', onclick: () => run('view:zoomIn') }, icon('plus', 14)),
    h('button.btn-icon', { title: 'Zoom to fit (⌘1)', onclick: () => run('view:fit') }, icon('fit', 14)),
    h('button.btn-icon', { title: 'Toggle minimap (⌘M)', onclick: () => run('view:minimap') }, icon('board', 14)),
  );
  subscribe((c) => {
    if (c.has('viewport') || c.has('board')) zoomLabel.textContent = `${Math.round((store.board?.viewport.zoom || 1) * 100)}%`;
  });
  for (const [panel, btn] of [['inspector', '#btn-inspector'], ['sidebar', '#btn-sidebar']]) {
    $(btn).classList.toggle('active', !document.body.classList.contains(`${panel}-hidden`));
  }
}

function yarnColorMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  showMenu(r.left, r.bottom + 6, [
    { heading: 'New yarn color' },
    { swatches: YARN_COLORS.map((c) => ({ color: c, active: store.ui.yarnColor === c, action: () => setUi({ yarnColor: c }) })) },
    { separator: true },
    { label: 'Pinned yarn (classic)', checked: store.board.settings.yarnStyle !== 'clean', action: () => run('view:yarnStyle', 'pinned') },
    { label: 'Clean yarn (behind cards)', checked: store.board.settings.yarnStyle === 'clean', action: () => run('view:yarnStyle', 'clean') },
  ]);
}

function initStatusBar() {
  const left = $('#status-left');
  const center = $('#status-center');
  const right = $('#status-right');
  const saveEl = $('#save-status');
  onSaveStatus((s) => {
    saveEl.dataset.state = s;
    saveEl.textContent = { saved: 'Saved', pending: 'Edited', saving: 'Saving…', error: 'Save failed' }[s] || '';
  });
  const draw = () => {
    if (!store.board) return;
    const g = store.graph;
    const files = store.board.items.filter((i) => i.type === 'file');
    const dirty = files.filter((f) => f.dirty).length;
    left.replaceChildren(...[
      h('span', null, `${store.board.items.filter((i) => i.type !== 'frame').length} cards`),
      store.selection.size ? h('span', null, ` · ${store.selection.size} selected`) : null,
      dirty ? h('span.status-dirty', null, ` · ${dirty} unsaved file${dirty === 1 ? '' : 's'}`) : null,
    ].filter(Boolean));
    if (g && files.length) {
      const warns = g.problems.filter((p) => p.level === 'warn').length;
      center.replaceChildren(
        h('span', null, `${g.resources.size} resource${g.resources.size === 1 ? '' : 's'} · ${g.events.size} event${g.events.size === 1 ? '' : 's'} · ${store.autoLinks.length} detected links`),
        h('button.status-problems', { class: warns ? 'has-warn' : '', onclick: () => { setSelection([]); togglePanel('inspector', true); } }, icon(warns ? 'warn' : 'info', 12), warns ? `${warns} warning${warns === 1 ? '' : 's'}` : 'No warnings'),
      );
    } else center.replaceChildren(h('span.muted', null, 'Tip: drop a FiveM resource folder onto the board'));
    right.replaceChildren(h('span', null, `Yarn: ${store.board.settings.yarnStyle === 'clean' ? 'clean' : 'pinned'}`), h('span', null, ` · ${Math.round(store.board.viewport.zoom * 100)}%`));
  };
  let raf = null;
  let lastZoom = null;
  subscribe((changes) => {
    const panOnly = [...changes].every((k) => k === 'viewport' || k === 'save-quiet');
    if (panOnly && store.board?.viewport.zoom === lastZoom) return;
    lastZoom = store.board?.viewport.zoom;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      draw();
    });
  });
}

function togglePanel(name, force) {
  const cls = `${name}-hidden`;
  const show = force ?? document.body.classList.contains(cls);
  document.body.classList.toggle(cls, !show);
  window.api.settings.set(`${name}Hidden`, !show);
  const btn = name === 'inspector' ? '#btn-inspector' : name === 'sidebar' ? '#btn-sidebar' : null;
  if (btn) $(btn).classList.toggle('active', show);
  notify('viewport');
}

// ---------------------------------------------------------------------------------------------
// Commands (menu bar, toolbar, shortcuts and context menus all go through here)

function insertPoint() {
  if (lastPointer) {
    const v = visibleWorldRect();
    const p = screenToWorld(lastPointer.x, lastPointer.y);
    if (p.x > v.x && p.y > v.y && p.x < v.x + v.w && p.y < v.y + v.h) return p;
  }
  return worldCenter();
}

function createAt(type, at = insertPoint()) {
  let item;
  if (type === 'note') item = makeNote(at);
  else if (type === 'text') item = makeText(at);
  else if (type === 'checklist') item = makeChecklist(at);
  if (!item) return null;
  checkpoint();
  addItems([item]);
  setEditing(item.id);
  return item;
}

async function run(command, payload) {
  if (!store.board) return;
  switch (command) {
    case 'board:new': {
      const name = await prompt('New board', { value: 'Untitled board', okLabel: 'Create' });
      if (name != null) newBoard(name.trim() || 'Untitled board');
      break;
    }
    case 'board:import': importBoardFile(); break;
    case 'board:export': exportCurrentBoard(); break;

    case 'workspace:import': {
      const dir = await window.api.dialog.openFolder();
      if (dir) importFolder(dir);
      break;
    }
    case 'workspace:rescan':
      if (payload) rescanWorkspace(payload);
      else if (!store.board.workspaces.length) toast('No imported folders on this board yet');
      else for (const ws of store.board.workspaces) rescanWorkspace(ws.id);
      break;
    case 'workspace:remove': removeWorkspace(payload); break;
    case 'files:add': {
      const paths = await window.api.dialog.openFiles();
      if (paths.length) addFilesAt(paths, insertPoint());
      break;
    }

    case 'editor:save':
      if (isEditorOpen() && (await saveActive())) break;
      if (!isEditorOpen()) {
        const sel = [...store.selection].map(getItem).find((i) => i?.type === 'file' && i.dirty);
        if (sel) {
          openInEditor(sel.id);
          saveActive();
        }
      }
      break;
    case 'editor:saveAll': saveAll(); break;
    case 'editor:closeTab':
      if (isEditorOpen()) {
        if (!closeTab()) toggleEditor(false);
      } else window.api.closeWindow();
      break;

    case 'items:duplicate': duplicateSelection(); break;
    case 'items:delete': deleteSelection(); break;
    case 'items:group': groupSelection(); break;
    case 'items:connect': connectSelection(); break;
    case 'items:arrange': arrangeSelection(); break;

    case 'search:open': openPalette(); break;
    case 'search:files': openPalette({ mode: 'files' }); break;

    case 'insert:note':
    case 'insert:text':
    case 'insert:checklist':
      createAt(command.split(':')[1]);
      break;
    case 'insert:frame': {
      const sel = [...store.selection].map(getItem).filter((i) => i && i.type !== 'frame');
      if (sel.length) groupSelection();
      else {
        const at = insertPoint();
        const frame = makeFrame({ x: at.x - 300, y: at.y - 200, w: 600, h: 400 }, { title: 'Frame' });
        checkpoint();
        addItems([frame]);
        requestAnimationFrame(() => renameFrame(frame));
      }
      break;
    }
    case 'insert:link': {
      const url = await prompt('Add a link', { placeholder: 'https://docs.fivem.net/natives/', okLabel: 'Add' });
      if (url && url.trim()) addLinkCard(url.trim(), insertPoint());
      break;
    }
    case 'insert:image': {
      const paths = await window.api.dialog.openFiles({ title: 'Add images', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }] });
      if (paths.length) addFilesAt(paths, insertPoint());
      break;
    }

    case 'fivem:scaffold': scaffoldResource(); break;
    case 'fivem:snippet': insertSnippet(); break;

    case 'view:zoomIn': zoomBy(1.25); break;
    case 'view:zoomOut': zoomBy(0.8); break;
    case 'view:zoomReset': {
      const c = worldCenter();
      centerOn(c, { zoom: 1 });
      break;
    }
    case 'view:fit': fitAll(); break;
    case 'view:fitSelection': fitSelection(); break;
    case 'view:sidebar': togglePanel('sidebar'); break;
    case 'view:inspector': togglePanel('inspector'); break;
    case 'view:editor': toggleEditor(); break;
    case 'view:minimap': togglePanel('minimap'); break;
    case 'view:yarnStyle': setBoardSetting('yarnStyle', payload === 'clean' ? 'clean' : 'pinned'); break;
    case 'view:theme':
      document.body.dataset.theme = payload === 'light' ? 'light' : 'dark';
      window.api.settings.set('theme', document.body.dataset.theme);
      notify('viewport');
      break;

    case 'help:shortcuts': showShortcuts(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    default:
      console.warn('Unknown command', command);
  }
}

// ---------------------------------------------------------------------------------------------
// Navigation helpers

function locate(id) {
  const it = getItem(id);
  if (!it) return;
  setSelection([id]);
  const v = visibleWorldRect();
  const zoom = Math.max(store.board.viewport.zoom, 0.6);
  if (!rectContains(v, it) || store.board.viewport.zoom < 0.42) centerOn({ x: it.x + it.w / 2, y: it.y + it.h / 2 }, { zoom: Math.min(zoom, 1) });
  revealInTree(id);
}

function openEditor(id, line) {
  const it = getItem(id);
  if (!it) return;
  setSelection([id]);
  openInEditor(id, { line });
}

function selectAndFit(ids) {
  const items = ids.map(getItem).filter(Boolean);
  if (!items.length) return;
  setSelection(items.map((i) => i.id));
  fitRect(boundsOf(items), { padding: 120, maxZoom: 1 });
}

function fitAll() {
  const items = store.board.items;
  if (!items.length) return setView({ x: 0, y: 0, zoom: 1 }, { animate: true });
  fitRect(boundsOf(items), { padding: 60, maxZoom: 1 });
}

function fitSelection() {
  const items = [...store.selection].map(getItem).filter(Boolean);
  if (!items.length) return fitAll();
  fitRect(boundsOf(items), { padding: 100, maxZoom: 1.5 });
}

function openUrl(url) {
  if (!url) return;
  const full = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
  window.api.shell.openExternal(full);
}

// ---------------------------------------------------------------------------------------------
// Selection actions

function selectedItems() {
  return [...store.selection].map(getItem).filter(Boolean);
}

function deleteSelection() {
  if (store.selectedLink) {
    const link = getLink(store.selectedLink);
    if (link?.auto) {
      toast(`Detected yarn can’t be deleted — hide “${LINK_KINDS[kindGroup(link.kind)]?.label}” in the sidebar instead`);
      return;
    }
    checkpoint();
    removeLinks([store.selectedLink]);
    return;
  }
  const items = selectedItems();
  if (!items.length) return;
  const dirty = items.filter((i) => i.type === 'file' && i.dirty);
  if (dirty.length) toast(`Removed ${dirty.length} card${dirty.length === 1 ? '' : 's'} with unsaved changes — ⌘Z to undo`, { type: 'warn' });
  checkpoint();
  removeItems(items.map((i) => i.id));
}

function cloneItems(items, dx, dy) {
  const idMap = new Map();
  const clones = items.map((it) => {
    const id = uid(it.type.slice(0, 2));
    idMap.set(it.id, id);
    const copy = structuredClone(it);
    return { ...copy, id, x: it.x + dx, y: it.y + dy };
  });
  return { clones, idMap };
}

function duplicateSelection() {
  if (isEditableTarget(document.activeElement)) return;
  const items = selectedItems();
  if (!items.length) return;
  const { clones, idMap } = cloneItems(items, 32, 32);
  checkpoint();
  addItems(clones);
  for (const l of store.board.links) {
    if (idMap.has(l.from) && idMap.has(l.to)) addLink({ ...l, id: uid('l'), from: idMap.get(l.from), to: idMap.get(l.to) });
  }
}

function groupSelection() {
  const items = selectedItems().filter((i) => i.type !== 'frame');
  if (!items.length) return toast('Select some cards to group');
  const b = boundsOf(items);
  const frame = makeFrame({ x: b.x - 32, y: b.y - 70, w: b.w + 64, h: b.h + 102 }, { title: 'Group' });
  checkpoint();
  addItems([frame]);
  setSelection([frame.id]);
  requestAnimationFrame(() => renameFrame(frame));
}

function connectSelection() {
  const items = selectedItems();
  if (items.length < 2) return toast('Select two or more cards to connect them with yarn');
  checkpoint();
  for (let i = 0; i < items.length - 1; i++) addLink({ id: uid('l'), from: items[i].id, to: items[i + 1].id, color: store.ui.yarnColor, label: '', style: 'solid' });
}

function arrangeSelection() {
  const items = selectedItems().filter((i) => i.type !== 'frame').sort((a, b) => a.y - b.y || a.x - b.x);
  if (items.length < 2) return;
  const b = boundsOf(items);
  const cols = Math.ceil(Math.sqrt(items.length));
  const colW = Math.max(...items.map((i) => i.w)) + 30;
  const updates = [];
  let y = b.y;
  for (let r = 0; r * cols < items.length; r++) {
    const row = items.slice(r * cols, r * cols + cols);
    row.forEach((it, c) => updates.push([it.id, { x: b.x + c * colW, y }]));
    y += Math.max(...row.map((i) => i.h)) + 30;
  }
  checkpoint();
  updateItems(updates);
}

function nudge(dx, dy) {
  const items = selectedItems();
  if (!items.length) return;
  const ids = new Set(items.map((i) => i.id));
  for (const f of items.filter((i) => i.type === 'frame')) for (const o of store.board.items) if (rectContains(f, o)) ids.add(o.id);
  checkpoint();
  updateItems([...ids].map((id) => {
    const it = getItem(id);
    return [id, { x: it.x + dx, y: it.y + dy }];
  }));
}

function fitFrame(frameId) {
  const frame = getItem(frameId);
  const inside = store.board.items.filter((i) => i.id !== frameId && rectContains(frame, i));
  if (!inside.length) return;
  const b = boundsOf(inside);
  checkpoint();
  updateItem(frameId, { x: b.x - 28, y: b.y - 56, w: b.w + 56, h: b.h + 84 });
}

async function reloadFile(id) {
  const it = getItem(id);
  if (!it?.path) return;
  const desc = await window.api.fs.readFile(it.path).catch(() => null);
  if (!desc) return toast('File not found on disk', { type: 'warn' });
  updateItem(id, { content: desc.kind === 'text' ? desc.content : null, size: desc.size, mtimeMs: desc.mtimeMs, dirty: false, diskChanged: false, missing: false, savedContent: undefined }, { content: true });
  toast(`Reloaded ${it.name}`, { timeout: 1500 });
}

function resetImage(id) {
  const it = getItem(id);
  if (!it?.src) return;
  const img = new Image();
  img.onload = () => {
    checkpoint();
    updateItem(id, { h: Math.round(it.w * (img.naturalHeight / img.naturalWidth)) });
  };
  img.src = it.src;
}

function fitPendingImages() {
  for (const it of store.board.items) {
    if (it.type !== 'image' || !it.fit || fitting.has(it.id)) continue;
    fitting.add(it.id);
    const img = new Image();
    img.onload = () => {
      fitting.delete(it.id);
      const cur = getItem(it.id);
      if (!cur) return;
      const max = cur.fitMax || [cur.path && cur.workspaceId ? 240 : 420, cur.path && cur.workspaceId ? 180 : 320];
      const size = fitSize(img.naturalWidth || 300, img.naturalHeight || 200, max[0], max[1]);
      updateItem(it.id, { ...size, fit: false });
    };
    img.onerror = () => {
      fitting.delete(it.id);
      updateItem(it.id, { fit: false });
    };
    img.src = it.src;
  }
}

function removeWorkspace(wsId) {
  const ws = store.board.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  checkpoint();
  removeItems(store.board.items.filter((i) => i.workspaceId === wsId).map((i) => i.id));
  setWorkspaces(store.board.workspaces.filter((w) => w.id !== wsId));
  window.api.fs.unwatch(ws.root);
  toast(`Removed ${ws.name} from the board (files on disk are untouched) — ⌘Z to undo`);
}

// ---------------------------------------------------------------------------------------------
// FiveM templates

async function scaffoldResource() {
  const choice = await pick('New FiveM resource', SCAFFOLDS.map((s) => ({ id: s.id, title: s.title, description: s.description, icon: 'resource' })), {
    subtitle: 'Files are created on the board first — edit them, then use “Export to folder…” on the frame to write them into your server.',
  });
  if (!choice) return;
  const tpl = SCAFFOLDS.find((s) => s.id === choice);
  const nameRaw = await prompt('Resource name', { value: 'my_resource', label: 'Folder name of the resource (used for event names too).', okLabel: 'Create' });
  if (nameRaw == null) return;
  const name = nameRaw.trim().replace(/[^\w\-]/g, '_') || 'my_resource';
  const at = insertPoint();
  const resourceId = `scaffold:${uid()}`;
  const cols = tpl.files.length > 4 ? 4 : 3;
  const origin = { x: Math.round(at.x - ((cols * (FILE_W + 30)) / 2)), y: Math.round(at.y - 300) };
  const cards = [{ id: uid('res'), type: 'resource', x: origin.x + 28, y: origin.y + 56, w: 380, h: 320, resourceId, title: name }];
  tpl.files.forEach((f, i) => {
    const idx = i + 1;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    cards.push(makeFile({ x: origin.x + 28 + col * (FILE_W + 30), y: origin.y + 56 + row * (FILE_H + 30) }, { name: basename(f.relPath), content: fillTemplate(f.content, name), relPath: f.relPath }, {
      relPath: f.relPath, resRelPath: f.relPath, resourceId, resourceName: name, dirty: true, path: null,
    }));
  });
  const b = boundsOf(cards);
  const frame = makeFrame({ x: origin.x, y: origin.y, w: b.x + b.w - origin.x + 28, h: b.y + b.h - origin.y + 28 }, {
    kind: 'resource', title: name, subtitle: 'Not on disk yet', color: 'green', scaffold: true, resourceId,
  });
  checkpoint();
  addItems([frame, ...cards], { select: false });
  setSelection([frame.id]);
  fitRect(boundsOf([frame]), { padding: 60, maxZoom: 0.9 });
  toast(`Created ${name} — when you’re ready, use “Export to folder…” on the frame`, { timeout: 6000 });
}

async function insertSnippet() {
  const choice = await pick('FiveM snippets', SNIPPETS.map((s) => ({ id: s.id, title: s.title, description: s.file, group: s.category, icon: 'snippet' })), {
    subtitle: isEditorOpen() ? 'Inserts at the cursor in the open file.' : 'Creates a new file card on the board.',
  });
  if (!choice) return;
  const snip = SNIPPETS.find((s) => s.id === choice);
  if (isEditorOpen() && insertAtCursor(snip.content)) return;
  const at = insertPoint();
  const card = makeFile({ x: at.x - FILE_W / 2, y: at.y - FILE_H / 2 }, { name: snip.file, content: snip.content }, { dirty: true, path: null });
  card.lang = detectLanguage(snip.file);
  checkpoint();
  addItems([card]);
}

// ---------------------------------------------------------------------------------------------
// Links, labels and small prompts

async function addLinkCard(url, at) {
  checkpoint();
  let title = '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    title = u.host.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    /* keep empty */
  }
  addItems([makeLink(at, url, title)]);
}

async function editLink(id) {
  const it = getItem(id);
  if (!it) return;
  const url = await prompt('Edit link', { value: it.url || '', okLabel: 'Save' });
  if (url == null) return;
  checkpoint();
  updateItem(id, { url: url.trim() });
}

async function editLinkLabel(linkId) {
  const link = getLink(linkId);
  if (!link || link.auto) return;
  const label = await prompt('Yarn label', { value: link.label || '', placeholder: 'e.g. triggers, depends on, TODO', okLabel: 'Save' });
  if (label == null) return;
  checkpoint();
  store.board.links = store.board.links.map((l) => (l.id === linkId ? { ...l, label: label.trim() } : l));
  notify('links', 'save');
}

async function renameBoardPrompt(id) {
  const current = id === store.board.id ? store.board.name : (await listBoards()).find((b) => b.id === id)?.name;
  const name = await prompt('Rename board', { value: current || '', okLabel: 'Rename' });
  if (name == null || !name.trim()) return;
  if (id === store.board.id) renameBoard(name.trim());
  else renameBoardById(id, name.trim());
}

function boardMenu(b, x, y) {
  showMenu(x, y, [
    { label: 'Open', disabled: b.id === store.board.id, action: () => switchBoard(b.id) },
    { label: 'Rename…', action: () => renameBoardPrompt(b.id) },
    { label: 'Duplicate', action: () => duplicateBoard(b.id) },
    { separator: true },
    {
      label: 'Delete board…',
      danger: true,
      action: async () => {
        const res = await window.api.dialog.confirm({ message: `Delete “${b.name}”?`, detail: 'The board is removed from FiveBoard. Files on disk are not touched.', buttons: ['Delete', 'Cancel'], type: 'warning' });
        if (res === 0) deleteBoard(b.id);
      },
    },
  ]);
}

function workspaceMenu(ws, x, y) {
  showMenu(x, y, [
    { label: 'Show on board', icon: 'locate', action: () => { const f = store.board.items.find((i) => i.type === 'frame' && i.workspaceId === ws.id && !i.relPath); if (f) selectAndFit([f.id]); } },
    { label: 'Rescan from disk', icon: 'refresh', action: () => rescanWorkspace(ws.id) },
    { label: 'Show in Finder', icon: 'reveal', action: () => window.api.shell.openPath(ws.root) },
    { separator: true },
    { label: 'Remove from board', icon: 'trash', danger: true, action: () => removeWorkspace(ws.id) },
  ]);
}

function showShortcuts() {
  const k = document.body.classList.contains('platform-darwin') ? '⌘' : 'Ctrl+';
  const rows = [
    ['Board', [
      ['Pan', 'Scroll · Space-drag · middle mouse'], ['Zoom', `Pinch · ${k}scroll · ${k}= / ${k}-`], ['Zoom to fit / selection', `${k}1 / ${k}2`],
      ['Select / hand tool', 'V / H'], ['Multi-select', 'Shift-click or drag a box'], ['Nudge', 'Arrow keys (Shift = 10px)'],
      ['Undo / redo', `${k}Z / ⇧${k}Z`], ['Duplicate / delete', `${k}D / ⌫`], ['Search', `${k}K · in files ⇧${k}F`],
    ]],
    ['Cards', [
      ['Sticky note / text / checklist', 'N / T / L (or double-click the board)'], ['Frame / group selection', `G / ${k}G`], ['Link / image', 'U / I'],
      ['Edit or open card', 'Enter or double-click'], ['Connect with yarn', `Drag a card’s pin · ${k}L for the selection`],
    ]],
    ['Code', [
      ['Save / save all', `${k}S / ⌥${k}S`], ['Toggle editor', `${k}E`], ['Close tab', `${k}W`], ['Comment line', `${k}/`],
      ['Autocomplete natives', 'Ctrl+Space'], ['Find in file', `${k}F`], ['New resource / snippet', `⇧${k}N / ⇧${k}I`],
    ]],
  ];
  sheet('Keyboard shortcuts', h('div.shortcuts', null, ...rows.map(([title, list]) =>
    h('div.shortcut-group', null, h('h3', null, title), ...list.map(([a, b]) => h('div.shortcut-row', null, h('span', null, a), h('kbd', null, b)))),
  )));
}

// ---------------------------------------------------------------------------------------------
// Context menus

function colorMenu(items) {
  const NOTE_SWATCH = { grey: '#5b5e66', yellow: '#e9c46a', orange: '#f08c4a', red: '#e5484d', pink: '#e86fa8', purple: '#9b7bea', blue: '#4c8df6', teal: '#2bb3a3', green: '#4caf6e' };
  return {
    swatches: NOTE_COLORS.map((c) => ({
      color: NOTE_SWATCH[c],
      label: c,
      active: items.length === 1 && (items[0].color || 'yellow') === c,
      action: () => {
        checkpoint();
        updateItems(items.map((i) => [i.id, { color: c }]));
      },
    })),
  };
}

function contextMenu({ kind, id, x, y, world }) {
  if (kind === 'board') {
    showMenu(x, y, [
      { label: 'Sticky note', icon: 'note', shortcut: 'N', action: () => createAt('note', world) },
      { label: 'Text', icon: 'text', shortcut: 'T', action: () => createAt('text', world) },
      { label: 'Checklist', icon: 'checklist', shortcut: 'L', action: () => createAt('checklist', world) },
      { label: 'Frame', icon: 'frame', shortcut: 'G', action: () => { checkpoint(); const f = makeFrame({ x: world.x, y: world.y, w: 600, h: 400 }); addItems([f]); requestAnimationFrame(() => renameFrame(f)); } },
      { label: 'Link…', icon: 'link', action: async () => { const url = await prompt('Add a link', { placeholder: 'https://', okLabel: 'Add' }); if (url?.trim()) addLinkCard(url.trim(), world); } },
      { label: 'Images or files…', icon: 'file', action: async () => { const paths = await window.api.dialog.openFiles(); if (paths.length) addFilesAt(paths, world); } },
      { separator: true },
      { label: 'Import folder / resource…', icon: 'folder', action: () => run('workspace:import') },
      { label: 'New FiveM resource…', icon: 'resource', action: () => { lastPointer = { x, y }; scaffoldResource(); } },
      { label: 'FiveM snippet…', icon: 'snippet', action: () => { lastPointer = { x, y }; insertSnippet(); } },
      { separator: true },
      { label: 'Select all', shortcut: '⌘A', action: () => setSelection(store.board.items.filter((i) => i.type !== 'frame').map((i) => i.id)) },
      { label: 'Zoom to fit', icon: 'fit', shortcut: '⌘1', action: fitAll },
    ]);
    return;
  }
  if (kind === 'link') {
    const link = getLink(id);
    if (!link) return;
    if (link.auto) {
      const group = kindGroup(link.kind);
      showMenu(x, y, [
        { heading: LINK_KINDS[group]?.label || 'Detected' },
        ...(link.names || []).slice(0, 6).map((n) => ({ label: `Search “${n}”`, icon: 'search', action: () => openPalette({ query: n }) })),
        { separator: true },
        { label: 'Show both cards', icon: 'fit', action: () => selectAndFit([link.from, link.to]) },
        { label: `Hide all “${LINK_KINDS[group]?.label}” yarn`, action: () => setUi({ showKinds: { ...store.ui.showKinds, [group]: false } }) },
      ]);
      return;
    }
    showMenu(x, y, [
      { swatches: YARN_COLORS.map((c) => ({ color: c, active: (link.color || YARN_COLORS[0]) === c, action: () => { checkpoint(); store.board.links = store.board.links.map((l) => (l.id === id ? { ...l, color: c } : l)); notify('links', 'save'); } })) },
      { label: 'Label…', action: () => editLinkLabel(id) },
      { label: link.style === 'dashed' ? 'Solid yarn' : 'Dashed yarn', action: () => { checkpoint(); store.board.links = store.board.links.map((l) => (l.id === id ? { ...l, style: l.style === 'dashed' ? 'solid' : 'dashed' } : l)); notify('links', 'save'); } },
      { label: link.arrow ? 'Hide arrow' : 'Show arrow', action: () => { checkpoint(); store.board.links = store.board.links.map((l) => (l.id === id ? { ...l, arrow: !l.arrow } : l)); notify('links', 'save'); } },
      { separator: true },
      { label: 'Remove yarn', icon: 'trash', danger: true, action: () => { checkpoint(); removeLinks([id]); } },
    ]);
    return;
  }
  const items = selectedItems();
  const item = getItem(id);
  if (!item) return;
  const multi = items.length > 1;
  const menu = [];
  if (!multi) {
    if (item.type === 'file') {
      menu.push(
        { label: 'Open in editor', icon: 'code', shortcut: '↩', action: () => openEditor(item.id) },
        item.path ? { label: 'Show in Finder', icon: 'reveal', action: () => window.api.shell.reveal(item.path) } : null,
        item.path ? { label: 'Open with default app', icon: 'external', action: () => window.api.shell.openPath(item.path) } : null,
        item.path ? { label: 'Open in VS Code', action: () => window.api.shell.openExternal(`vscode://file${encodeURI(item.path)}`) } : null,
        item.path ? { label: 'Reload from disk', icon: 'refresh', action: () => reloadFile(item.id) } : null,
        item.path ? { label: 'Copy path', icon: 'copy', action: () => navigator.clipboard.writeText(item.path) } : null,
        { separator: true },
      );
    } else if (item.type === 'frame') {
      menu.push(
        { label: 'Rename', action: () => renameFrame(item) },
        item.scaffold ? { label: 'Export resource to folder…', icon: 'export', action: () => exportFrameToFolder(item.id) } : null,
        { label: 'Select contents', action: () => setSelection(store.board.items.filter((i) => i.id !== item.id && i.type !== 'frame' && rectContains(item, i)).map((i) => i.id)) },
        { label: 'Fit to contents', icon: 'fit', action: () => fitFrame(item.id) },
        item.workspaceId ? { label: 'Rescan from disk', icon: 'refresh', action: () => rescanWorkspace(item.workspaceId) } : null,
        { label: 'Color', submenu: [colorMenu([item])] },
        { separator: true },
      );
    } else if (item.type === 'note' || item.type === 'text' || item.type === 'checklist') {
      menu.push({ label: 'Edit', shortcut: '↩', action: () => setEditing(item.id) }, colorMenu([item]), { separator: true });
    } else if (item.type === 'link') {
      menu.push({ label: 'Open link', icon: 'external', action: () => openUrl(item.url) }, { label: 'Edit link…', action: () => editLink(item.id) }, { separator: true });
    } else if (item.type === 'image') {
      menu.push({ label: 'Original ratio', action: () => resetImage(item.id) }, item.path ? { label: 'Show in Finder', icon: 'reveal', action: () => window.api.shell.reveal(item.path) } : null, { separator: true });
    } else if (item.type === 'resource') {
      const res = store.graph?.resources.get(item.resourceId);
      if (res?.manifestFileId) menu.push({ label: 'Open fxmanifest.lua', icon: 'code', action: () => openEditor(res.manifestFileId) }, { separator: true });
    }
  } else {
    const notes = items.filter((i) => i.type === 'note');
    menu.push(
      { label: 'Connect in order', icon: 'yarn', shortcut: '⌘L', action: connectSelection },
      { label: 'Group in frame', icon: 'frame', shortcut: '⌘G', action: groupSelection },
      { label: 'Arrange in a grid', icon: 'fit', action: arrangeSelection },
      notes.length ? colorMenu(notes) : null,
      { separator: true },
    );
  }
  menu.push(
    { label: 'Duplicate', shortcut: '⌘D', action: duplicateSelection },
    item.type !== 'frame' ? { label: 'Bring to front', action: () => { checkpoint(); bringToFront(items.map((i) => i.id)); } } : null,
    item.type !== 'frame' ? { label: 'Send to back', action: () => { checkpoint(); sendToBack(items.map((i) => i.id)); } } : null,
    { label: 'Zoom to selection', shortcut: '⌘2', action: fitSelection },
    { separator: true },
    { label: multi ? `Delete ${items.length} items` : 'Delete', icon: 'trash', danger: true, shortcut: '⌫', action: deleteSelection },
  );
  showMenu(x, y, menu.filter(Boolean));
}

// ---------------------------------------------------------------------------------------------
// Keyboard

function initKeyboard() {
  window.addEventListener('pointermove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (!store.board) return;
    if (isEditableTarget(e.target) || paletteOpen() || menuOpen() || document.querySelector('.modal-backdrop')) return;
    const mod = modKey(e);
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      setSelection(store.board.items.filter((i) => i.type !== 'frame').map((i) => i.id));
      return;
    }
    if (mod || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        deleteSelection();
        return;
      case 'Escape':
        if (store.selection.size || store.selectedLink) setSelection([]);
        else if (store.ui.tool !== 'select') setUi({ tool: 'select' });
        return;
      case 'Enter': {
        const items = selectedItems();
        if (items.length !== 1) return;
        e.preventDefault();
        const it = items[0];
        if (['note', 'text', 'checklist'].includes(it.type)) setEditing(it.id);
        else if (it.type === 'file') openEditor(it.id);
        else if (it.type === 'frame') renameFrame(it);
        else if (it.type === 'link') openUrl(it.url);
        return;
      }
      case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); return;
      case 'ArrowRight': e.preventDefault(); nudge(step, 0); return;
      case 'ArrowUp': e.preventDefault(); nudge(0, -step); return;
      case 'ArrowDown': e.preventDefault(); nudge(0, step); return;
      default:
        break;
    }
    if (e.shiftKey && e.key !== '?') return;
    const single = {
      v: () => setUi({ tool: 'select' }),
      h: () => setUi({ tool: 'hand' }),
      n: () => run('insert:note'),
      t: () => run('insert:text'),
      l: () => run('insert:checklist'),
      g: () => run('insert:frame'),
      u: () => run('insert:link'),
      i: () => run('insert:image'),
      f: () => (store.selection.size ? fitSelection() : fitAll()),
      '?': () => showShortcuts(),
    }[e.key === '?' ? '?' : key];
    if (single) {
      e.preventDefault();
      single();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Clipboard: copy / cut / paste cards, paste images, text and links

const CLIP_TYPE = 'application/x-fiveboard';

function initClipboard() {
  const copy = (e, cut) => {
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    const items = selectedItems();
    if (!items.length) return;
    const ids = new Set(items.map((i) => i.id));
    for (const f of items.filter((i) => i.type === 'frame')) for (const o of store.board.items) if (rectContains(f, o)) ids.add(o.id);
    const all = [...ids].map(getItem);
    const links = store.board.links.filter((l) => ids.has(l.from) && ids.has(l.to));
    e.clipboardData.setData(CLIP_TYPE, JSON.stringify({ items: all, links }));
    e.clipboardData.setData('text/plain', all.map((i) => i.text || i.title || i.url || i.content || i.name || '').filter(Boolean).join('\n\n'));
    e.preventDefault();
    if (cut) {
      checkpoint();
      removeItems([...ids]);
    }
  };
  document.addEventListener('copy', (e) => copy(e, false));
  document.addEventListener('cut', (e) => copy(e, true));
  document.addEventListener('paste', (e) => {
    if (!store.board || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    if (paletteOpen() || document.querySelector('.modal-backdrop')) return;
    const dt = e.clipboardData;
    const at = insertPoint();
    const raw = dt.getData(CLIP_TYPE);
    if (raw) {
      e.preventDefault();
      try {
        const data = JSON.parse(raw);
        const b = boundsOf(data.items);
        const { clones, idMap } = cloneItems(data.items, at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2));
        checkpoint();
        addItems(clones);
        for (const l of data.links || []) addLink({ ...l, id: uid('l'), from: idMap.get(l.from), to: idMap.get(l.to) });
      } catch {
        /* ignore malformed clipboard */
      }
      return;
    }
    const files = [...dt.files];
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      e.preventDefault();
      addImageFiles(images, at);
      return;
    }
    const text = dt.getData('text/plain');
    if (text && text.trim()) {
      e.preventDefault();
      const t = text.trim();
      checkpoint();
      if (/^https?:\/\/\S+$/i.test(t)) addLinkCard(t, at);
      else if (t.includes('\n') && /(function|local|end|RegisterNetEvent|=>|const |\{)/.test(t)) {
        addItems([makeFile({ x: at.x - FILE_W / 2, y: at.y - FILE_H / 2 }, { name: 'pasted.lua', content: t }, { dirty: true, path: null })]);
      } else addItems([makeNote(at, { text: t, h: Math.min(360, 120 + Math.ceil(t.length / 28) * 18) })]);
    }
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function addImageFiles(files, at) {
  const items = [];
  let x = at.x;
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) {
      toast(`${f.name || 'Image'} is too large (max 25 MB)`, { type: 'warn' });
      continue;
    }
    const src = await readAsDataUrl(f);
    items.push(makeImage({ x, y: at.y }, src, { name: f.name || 'Pasted image' }));
    x += 330;
  }
  if (!items.length) return;
  checkpoint();
  addItems(items);
}

// ---------------------------------------------------------------------------------------------
// Drag & drop from Finder

function initDrop() {
  const vp = $('#viewport');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
  vp.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    vp.classList.add('drop-active');
  });
  vp.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) vp.classList.remove('drop-active');
  });
  vp.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  vp.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    vp.classList.remove('drop-active');
    const at = screenToWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (!files.length) {
      const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (uri && /^https?:\/\//i.test(uri.trim())) addLinkCard(uri.trim().split('\n')[0], at);
      return;
    }
    const target = itemAtPoint(e.clientX, e.clientY, { includeFrames: false });
    const paths = [];
    const loose = [];
    for (const f of files) {
      const p = window.api.fs.pathForFile(f);
      if (!p) {
        if (f.type.startsWith('image/')) loose.push(f);
        continue;
      }
      const s = await window.api.fs.stat(p);
      if (s.isDirectory) await importFolder(p);
      else if (/\.fiveboard$/i.test(p)) importBoardFile(p);
      else paths.push(p);
    }
    if (paths.length) {
      const added = await addFilesAt(paths, at);
      // Dropping a file onto a card ties them together with yarn.
      if (target && added.length) for (const a of added) addLink({ id: uid('l'), from: target.id, to: a.id, color: store.ui.yarnColor, label: '', style: 'solid' });
    }
    if (loose.length) addImageFiles(loose, at);
  });
  // Stop the window from navigating to files dropped outside the board.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

boot().catch((err) => {
  console.error(err);
  document.body.append(h('pre.fatal', null, `FiveBoard failed to start:\n${err.stack || err}`));
});

