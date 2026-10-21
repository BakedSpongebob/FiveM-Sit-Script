// Tabbed code editor drawer (CodeMirror 5). Edits flow back into the file card on the board and
// are written to disk with ⌘S.
import { store, subscribe, getItem, updateItem, setSelection } from './store.js';
import { modeFor, LANG_LABEL } from './codeview.js';
import { ROLE_LABEL } from './items.js';
import { NATIVES, LUA_WORDS } from './fivem/natives.js';
import { detectLanguage } from './fivem/analyzer.js';
import { h, icon, basename, debounce, keys, fileManager, vscodeUrl } from './util.js';
import { toast } from './ui/toast.js';

const CM = window.CodeMirror;

const state = {
  tabs: [],
  active: null,
  open: false,
  width: 640,
};

let cm = null;
let els = {};
let hooks = {};

export function initEditor(root, appHooks) {
  hooks = appHooks;
  const tabs = h('div.editor-tabs');
  const closeDrawer = h('button.btn-icon.editor-hide', { title: 'Hide editor (⌘E)', onclick: () => toggleEditor(false) }, icon('close', 14));
  const lang = h('span.lang-badge');
  const name = h('span.editor-name');
  const path = h('span.editor-path');
  const role = h('span.role-badge');
  const locate = h('button.btn-icon', { title: 'Show on board', onclick: () => state.active && hooks.locate(state.active) }, icon('locate', 15));
  const reveal = h('button.btn-icon', { title: `Show in ${fileManager()}`, onclick: () => { const it = getItem(state.active); if (it?.path) window.api.shell.reveal(it.path); } }, icon('reveal', 15));
  const vscode = h('button.btn-icon', { title: 'Open in VS Code', onclick: () => { const it = getItem(state.active); if (it?.path) window.api.shell.openExternal(vscodeUrl(it.path)); } }, icon('external', 15));
  const revert = h('button.btn', { title: 'Discard unsaved changes', onclick: () => revertActive() }, 'Revert');
  const save = h('button.btn.btn-primary', { title: 'Save (⌘S)', onclick: () => saveActive() }, icon('save', 13), 'Save');
  const banner = h('div.editor-banner', { hidden: true });
  const host = h('div.editor-host');
  const status = h('div.editor-status');
  const empty = h('div.editor-empty', null, icon('code', 28), h('p', null, 'Double-click a file card to open it here.'), h('p.muted', null, keys('⌘S save · ⌘/ comment · ⌃Space natives · ⌘F find')));
  const resize = h('div.editor-resize', { title: 'Drag to resize' });
  root.append(resize, h('div.editor-tabbar', null, tabs, closeDrawer), h('div.editor-toolbar', null, h('div.editor-file', null, lang, h('div.editor-titles', null, name, path), role), h('div.editor-actions', null, locate, reveal, vscode, revert, save)), banner, host, status, empty);
  els = { root, tabs, lang, name, path, role, save, revert, banner, host, status, empty, reveal, vscode };

  cm = CM(host, {
    theme: 'fiveboard',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: false, minChars: 2 },
    gutters: ['fb-hints', 'CodeMirror-linenumbers'],
    extraKeys: {
      'Cmd-/': 'toggleComment',
      'Ctrl-/': 'toggleComment',
      'Ctrl-Space': (ed) => ed.showHint({ hint: fivemHint, completeSingle: false }),
      'Cmd-F': 'findPersistent',
      'Ctrl-F': 'findPersistent',
      'Cmd-G': 'findNext',
      'Shift-Cmd-G': 'findPrev',
      'Alt-G': 'jumpToLine',
      Tab: (ed) => (ed.somethingSelected() ? ed.indentSelection('add') : ed.replaceSelection('    ', 'end')),
      'Shift-Tab': (ed) => ed.indentSelection('subtract'),
    },
  });
  cm.on('change', onChange);
  cm.on('cursorActivity', updateStatus);
  cm.on('inputRead', (ed, change) => {
    const tab = activeTab();
    if (!tab || ed.state.completionActive) return;
    if (!/^[A-Za-z_.:]$/.test(change.text[0] || '')) return;
    const cur = ed.getCursor();
    const before = ed.getLine(cur.line).slice(0, cur.ch);
    if (/[A-Za-z_][\w.:]{2,}$/.test(before)) ed.showHint({ hint: fivemHint, completeSingle: false });
  });

  // Drawer width.
  window.api.settings.get('editorWidth').then((w) => {
    if (w) setWidth(w);
  });
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resize.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = state.width;
    const move = (ev) => setWidth(startW + (startX - ev.clientX));
    const up = () => {
      resize.removeEventListener('pointermove', move);
      resize.removeEventListener('pointerup', up);
      window.api.settings.set('editorWidth', state.width);
      cm.refresh();
    };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', up);
  });

  subscribe((changes) => {
    if (changes.has('board')) {
      closeAll();
      return;
    }
    if (changes.has('items')) syncFromItems();
    if (changes.has('analysis')) refreshHints();
  });
  renderChrome();
}

function setWidth(w) {
  state.width = Math.max(360, Math.min(w, window.innerWidth - 420));
  els.root.style.width = `${state.width}px`;
}

const activeTab = () => state.tabs.find((t) => t.itemId === state.active);

export function isEditorOpen() {
  return state.open;
}

export function toggleEditor(force) {
  state.open = force ?? !state.open;
  els.root.classList.toggle('open', state.open);
  document.body.classList.toggle('editor-open', state.open);
  if (state.open) requestAnimationFrame(() => cm.refresh());
  hooks.onToggle?.(state.open);
}

export function openInEditor(itemId, { line = null } = {}) {
  const item = getItem(itemId);
  if (!item || item.type !== 'file') return;
  if (item.kind === 'binary' || item.content == null) {
    if (item.path) window.api.shell.openPath(item.path);
    else toast('This file has no text content to edit', { type: 'warn' });
    return;
  }
  let tab = state.tabs.find((t) => t.itemId === itemId);
  if (!tab) {
    const doc = CM.Doc(item.content || '', modeFor(item.lang));
    tab = { itemId, doc, saved: item.dirty ? item.savedContent ?? null : item.content, pushed: item.content, lang: item.lang, dirty: !!item.dirty };
    state.tabs.push(tab);
  }
  state.active = itemId;
  cm.swapDoc(tab.doc);
  toggleEditor(true);
  renderChrome();
  refreshHints();
  requestAnimationFrame(() => {
    cm.refresh();
    if (line) {
      cm.setCursor({ line: line - 1, ch: 0 });
      cm.scrollIntoView({ line: line - 1, ch: 0 }, 120);
      const handle = cm.addLineClass(line - 1, 'background', 'flash-line');
      setTimeout(() => cm.removeLineClass(handle, 'background', 'flash-line'), 1400);
    }
    cm.focus();
  });
}

export function closeTab(itemId = state.active) {
  const idx = state.tabs.findIndex((t) => t.itemId === itemId);
  if (idx < 0) return false;
  flushPush();
  state.tabs.splice(idx, 1);
  if (state.active === itemId) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    state.active = next?.itemId || null;
    if (next) cm.swapDoc(next.doc);
    else cm.swapDoc(CM.Doc('', 'text/plain'));
  }
  renderChrome();
  return true;
}

function closeAll() {
  state.tabs = [];
  state.active = null;
  cm.swapDoc(CM.Doc('', 'text/plain'));
  renderChrome();
}

// Push editor text into the board item (debounced so typing stays smooth).
const pushToItem = debounce(() => {
  for (const tab of state.tabs) {
    const value = tab.doc.getValue();
    if (value === tab.pushed) continue;
    tab.pushed = value;
    const item = getItem(tab.itemId);
    if (!item) continue;
    updateItem(tab.itemId, { content: value, dirty: tab.saved == null ? true : value !== tab.saved, savedContent: tab.saved }, { content: true });
  }
}, 280);

function flushPush() {
  pushToItem.flush();
}

function onChange() {
  const tab = activeTab();
  if (!tab) return;
  const dirty = tab.saved == null || tab.doc.getValue() !== tab.saved;
  if (dirty !== tab.dirty) {
    tab.dirty = dirty;
    renderTabs();
    renderToolbar();
  }
  pushToItem();
}

function syncFromItems() {
  let changed = false;
  for (const tab of [...state.tabs]) {
    const item = getItem(tab.itemId);
    if (!item) {
      closeTab(tab.itemId);
      changed = true;
      continue;
    }
    if (item.lang !== tab.lang) {
      tab.lang = item.lang;
      tab.doc.modeOption = modeFor(item.lang);
      if (tab.itemId === state.active) cm.setOption('mode', modeFor(item.lang));
      changed = true;
    }
    // Content replaced from outside (reload from disk, undo on the board).
    if (item.content !== tab.pushed && item.content !== tab.doc.getValue()) {
      const cursor = tab.doc.getCursor();
      tab.doc.setValue(item.content || '');
      tab.doc.setCursor(cursor);
      tab.pushed = item.content;
      if (!item.dirty) tab.saved = item.content;
      changed = true;
    }
    const dirty = !!item.dirty;
    if (dirty !== !!tab.dirty) {
      tab.dirty = dirty;
      changed = true;
    }
  }
  if (changed) renderChrome();
  else renderToolbar();
}

export async function saveActive() {
  if (!state.active) return false;
  return saveTab(activeTab());
}

export async function saveAll() {
  let n = 0;
  for (const tab of state.tabs) if (tab.dirty && (await saveTab(tab, { quiet: true }))) n++;
  // Dirty cards that aren't open in the editor.
  for (const it of store.board.items) {
    if (it.type === 'file' && it.dirty && it.path && !state.tabs.some((t) => t.itemId === it.id)) {
      await window.api.fs.writeFile(it.path, it.content || '');
      updateItem(it.id, { dirty: false, diskChanged: false, savedContent: undefined });
      n++;
    }
  }
  toast(n ? `Saved ${n} file${n === 1 ? '' : 's'}` : 'Nothing to save');
}

async function saveTab(tab, { quiet = false } = {}) {
  if (!tab) return false;
  flushPush();
  const item = getItem(tab.itemId);
  if (!item) return false;
  let filePath = item.path;
  const patch = {};
  if (!filePath) {
    filePath = await window.api.dialog.saveFile({ title: 'Save file', defaultPath: item.name || 'script.lua' });
    if (!filePath) return false;
    patch.path = filePath;
    patch.name = basename(filePath);
    patch.lang = detectLanguage(patch.name);
    if (!item.relPath || item.relPath === item.name) patch.relPath = patch.name;
  }
  const content = tab.doc.getValue();
  try {
    const res = await window.api.fs.writeFile(filePath, content);
    Object.assign(patch, { content, dirty: false, diskChanged: false, missing: false, size: res.size, mtimeMs: res.mtimeMs, savedContent: undefined });
  } catch (err) {
    toast(`Could not save: ${err.message}`, { type: 'error' });
    return false;
  }
  tab.saved = content;
  tab.pushed = content;
  tab.dirty = false;
  updateItem(tab.itemId, patch, { content: true });
  renderChrome();
  if (!quiet) toast(`Saved ${patch.name || item.name}`, { timeout: 1800 });
  return true;
}

export async function revertActive() {
  const tab = activeTab();
  if (!tab) return;
  const item = getItem(tab.itemId);
  let content = tab.saved;
  if (item?.path) {
    const desc = await window.api.fs.readFile(item.path).catch(() => null);
    if (desc && desc.kind === 'text') content = desc.content;
  }
  if (content == null) return;
  tab.doc.setValue(content);
  tab.saved = content;
  tab.pushed = content;
  tab.dirty = false;
  updateItem(tab.itemId, { content, dirty: false, diskChanged: false, savedContent: undefined }, { content: true });
  renderChrome();
}

export function dirtyTabs() {
  return state.tabs.filter((t) => t.dirty).length;
}

// ---------------------------------------------------------------------------------------------
// Chrome

function renderChrome() {
  renderTabs();
  renderToolbar();
  updateStatus();
  const has = !!state.active;
  els.empty.hidden = has;
  els.host.style.visibility = has ? 'visible' : 'hidden';
}

function renderTabs() {
  els.tabs.replaceChildren(
    ...state.tabs.map((tab) => {
      const item = getItem(tab.itemId);
      const btn = h('div.editor-tab', {
        class: tab.itemId === state.active ? 'active' : '',
        title: item?.path || item?.name || '',
        onclick: () => openInEditor(tab.itemId),
        onauxclick: (e) => {
          if (e.button === 1) closeTab(tab.itemId);
        },
      },
      h('span.tab-dot', { class: `role-${store.graph?.files.get(tab.itemId)?.role || 'other'}` }),
      h('span.tab-name', null, item?.name || 'untitled'),
      h('button.tab-close', {
        class: tab.dirty ? 'dirty' : '',
        title: 'Close tab (⌘W)',
        onclick: (e) => {
          e.stopPropagation();
          closeTab(tab.itemId);
        },
      }, icon('close', 11)));
      return btn;
    }),
  );
}

function renderToolbar() {
  const item = state.active ? getItem(state.active) : null;
  if (!item) {
    els.name.textContent = '';
    els.path.textContent = '';
    els.lang.textContent = '';
    els.role.hidden = true;
    els.banner.hidden = true;
    return;
  }
  const info = store.graph?.files.get(item.id);
  els.lang.textContent = LANG_LABEL[item.lang] || 'TXT';
  els.lang.dataset.lang = item.lang;
  els.name.textContent = item.name;
  // Wrapped in LRM marks so the right-to-left truncation (keeps the file end visible) doesn't move slashes.
  els.path.textContent = item.path ? `\u200E${item.path}\u200E` : keys('Not saved yet — ⌘S to choose a location');
  els.path.title = item.path || '';
  els.role.textContent = ROLE_LABEL[info?.role] || '';
  els.role.hidden = !ROLE_LABEL[info?.role];
  els.role.dataset.role = info?.role || '';
  els.reveal.disabled = !item.path;
  els.vscode.disabled = !item.path;
  const tab = activeTab();
  els.save.disabled = !(tab?.dirty || !item.path);
  els.revert.disabled = !tab?.dirty;
  if (item.diskChanged || item.missing) {
    els.banner.hidden = false;
    els.banner.replaceChildren(...[
      icon('warn', 14),
      h('span', null, item.missing ? 'This file no longer exists on disk. Saving will recreate it.' : 'This file changed on disk while you had unsaved edits.'),
      item.missing ? null : h('button.btn.btn-small', { onclick: () => revertActive() }, 'Load disk version'),
      h('button.btn.btn-small', { onclick: () => updateItem(item.id, { diskChanged: false }) }, 'Keep mine'),
    ].filter(Boolean));
  } else els.banner.hidden = true;
}

function updateStatus() {
  if (!cm || !state.active) {
    els.status.textContent = '';
    return;
  }
  const c = cm.getCursor();
  const item = getItem(state.active);
  const sel = cm.getSelection();
  els.status.textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}${sel ? ` (${sel.length} selected)` : ''} · ${LANG_LABEL[item?.lang] || 'TXT'} · Spaces: 4 · ${cm.lineCount()} lines`;
}

function refreshHints() {
  if (!cm || !state.active) return;
  cm.clearGutter('fb-hints');
  const info = store.graph?.files.get(state.active);
  if (!info) return;
  const byLine = new Map();
  for (const hnt of info.analysis.hints) {
    if (!hnt.line) continue;
    const list = byLine.get(hnt.line) || [];
    list.push(hnt);
    byLine.set(hnt.line, list);
  }
  for (const [line, list] of byLine) {
    const warn = list.some((x) => x.level === 'warn');
    const marker = h('span.gutter-hint', { class: warn ? 'warn' : 'info', title: list.map((x) => x.message).join('\n') }, warn ? '!' : 'i');
    if (line - 1 < cm.lineCount()) cm.setGutterMarker(line - 1, 'fb-hints', marker);
  }
  renderTabs();
  renderToolbar();
}

// ---------------------------------------------------------------------------------------------
// Autocomplete: FiveM natives + Lua words + words already in the file.

const SIDE_LABEL = { c: 'client', s: 'server', b: 'shared', nui: 'NUI' };

function fivemHint(ed) {
  const cur = ed.getCursor();
  const line = ed.getLine(cur.line);
  let start = cur.ch;
  while (start > 0 && /[\w.:]/.test(line[start - 1])) start--;
  const word = line.slice(start, cur.ch);
  if (!word) return null;
  const lower = word.toLowerCase();
  const seen = new Set();
  const list = [];
  for (const [name, params, side] of NATIVES) {
    if (!name.toLowerCase().startsWith(lower) || name === word) continue;
    seen.add(name);
    list.push({
      text: name,
      displayText: `${name}${params}`,
      className: `hint-native hint-${side}`,
      render(el) {
        el.append(h('span.hint-name', null, name), h('span.hint-params', null, params), h('span.hint-side', null, SIDE_LABEL[side] || ''));
      },
    });
  }
  for (const w of LUA_WORDS) {
    if (w.toLowerCase().startsWith(lower) && w !== word && !seen.has(w)) {
      seen.add(w);
      list.push({ text: w, className: 'hint-word' });
    }
  }
  const docWords = new Set(ed.getValue().match(/[A-Za-z_][\w]{3,}/g) || []);
  for (const w of docWords) {
    if (w.toLowerCase().startsWith(lower) && w !== word && !seen.has(w)) {
      seen.add(w);
      list.push({ text: w, className: 'hint-local' });
    }
    if (list.length > 80) break;
  }
  if (!list.length) return null;
  return { list: list.slice(0, 60), from: CM.Pos(cur.line, start), to: CM.Pos(cur.line, cur.ch) };
}

export function insertAtCursor(text) {
  if (!cm || !state.active || !state.open) return false;
  cm.replaceSelection(text);
  cm.focus();
  return true;
}

export function focusEditor() {
  cm?.focus();
}

export function editorHasFocus() {
  return !!cm?.hasFocus();
}

export function selectActiveOnBoard() {
  if (state.active) setSelection([state.active]);
}
