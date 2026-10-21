// Central board state with undo/redo. Items and links are treated as immutable: every change
// replaces the object, so renderers can skip work with a cheap identity check and history
// snapshots are just arrays of references.

const HISTORY_LIMIT = 150;

const listeners = new Set();
let pending = new Set();
let scheduled = false;

export const store = {
  board: null,
  itemMap: new Map(),
  selection: new Set(),
  selectedLink: null,
  editingId: null,
  autoLinks: [],
  graph: null,
  analysisVersion: 0,
  history: { past: [], future: [] },
  ui: {
    tool: 'select',
    yarnColor: '#e5484d',
    showKinds: {
      manual: true,
      manifest: true,
      net: true,
      local: true,
      callback: true,
      nui: true,
      export: true,
      include: false,
    },
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(...kinds) {
  for (const k of kinds) pending.add(k);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const changes = pending;
    pending = new Set();
    for (const fn of listeners) fn(changes);
  });
}

function reindex() {
  store.itemMap = new Map(store.board.items.map((i) => [i.id, i]));
}

function touch(...kinds) {
  store.board.updatedAt = Date.now();
  notify('save', ...kinds);
}

export function setBoard(board) {
  store.board = board;
  board.items ||= [];
  board.links ||= [];
  board.workspaces ||= [];
  board.viewport ||= { x: 0, y: 0, zoom: 1 };
  board.settings ||= {};
  board.settings.yarnStyle ||= 'pinned';
  reindex();
  store.selection = new Set();
  store.selectedLink = null;
  store.editingId = null;
  store.autoLinks = [];
  store.graph = null;
  store.history = { past: [], future: [] };
  notify('board', 'items', 'links', 'selection', 'viewport', 'content');
}

export const getItem = (id) => store.itemMap.get(id);

export function allLinks() {
  return store.autoLinks.length ? store.board.links.concat(store.autoLinks) : store.board.links;
}

export function getLink(id) {
  return store.board.links.find((l) => l.id === id) || store.autoLinks.find((l) => l.id === id);
}

// ---- history ----------------------------------------------------------------------------------

export function checkpoint() {
  const { past, future } = store.history;
  past.push({ items: store.board.items, links: store.board.links, workspaces: store.board.workspaces });
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
}

function restore(snapshot) {
  store.board.items = snapshot.items;
  store.board.links = snapshot.links;
  store.board.workspaces = snapshot.workspaces;
  reindex();
  for (const id of [...store.selection]) if (!store.itemMap.has(id)) store.selection.delete(id);
  if (store.selectedLink && !store.board.links.some((l) => l.id === store.selectedLink)) store.selectedLink = null;
  store.editingId = null;
  touch('items', 'links', 'selection', 'content');
}

export function undo() {
  const snap = store.history.past.pop();
  if (!snap) return false;
  store.history.future.push({ items: store.board.items, links: store.board.links, workspaces: store.board.workspaces });
  restore(snap);
  return true;
}

export function redo() {
  const snap = store.history.future.pop();
  if (!snap) return false;
  store.history.past.push({ items: store.board.items, links: store.board.links, workspaces: store.board.workspaces });
  restore(snap);
  return true;
}

// ---- items ------------------------------------------------------------------------------------

export function nextZ() {
  let max = 0;
  for (const it of store.board.items) if (it.type !== 'frame' && it.z > max) max = it.z;
  return max + 1;
}

export function addItems(items, { select = true } = {}) {
  let z = nextZ();
  const prepared = items.map((it) => (it.type === 'frame' ? it : { ...it, z: it.z ?? z++ }));
  store.board.items = store.board.items.concat(prepared);
  for (const it of prepared) store.itemMap.set(it.id, it);
  if (select) {
    store.selection = new Set(prepared.filter((i) => i.type !== 'frame' || prepared.length === 1).map((i) => i.id));
    store.selectedLink = null;
  }
  const kinds = ['items', 'selection'];
  if (prepared.some((i) => i.type === 'file')) kinds.push('content');
  touch(...kinds);
  return prepared;
}

/** Patch several items at once: updates is a Map or array of [id, patch]. */
export function updateItems(updates, { content = false } = {}) {
  const map = updates instanceof Map ? updates : new Map(updates);
  if (!map.size) return;
  store.board.items = store.board.items.map((it) => {
    const patch = map.get(it.id);
    if (!patch) return it;
    const next = { ...it, ...patch };
    store.itemMap.set(it.id, next);
    return next;
  });
  touch('items', ...(content ? ['content'] : []));
}

export function updateItem(id, patch, opts) {
  updateItems([[id, patch]], opts);
}

export function removeItems(ids) {
  const set = new Set(ids);
  if (!set.size) return;
  const hadFile = store.board.items.some((i) => set.has(i.id) && i.type === 'file');
  store.board.items = store.board.items.filter((i) => !set.has(i.id));
  store.board.links = store.board.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  for (const id of set) {
    store.itemMap.delete(id);
    store.selection.delete(id);
  }
  if (store.editingId && set.has(store.editingId)) store.editingId = null;
  touch('items', 'links', 'selection', ...(hadFile ? ['content'] : []));
}

export function bringToFront(ids) {
  let z = nextZ();
  const updates = [];
  for (const id of ids) {
    const it = getItem(id);
    if (it && it.type !== 'frame') updates.push([id, { z: z++ }]);
  }
  if (updates.length) updateItems(updates);
}

export function sendToBack(ids) {
  let min = Infinity;
  for (const it of store.board.items) if (it.type !== 'frame') min = Math.min(min, it.z || 0);
  const updates = ids.map((id, i) => [id, { z: min - ids.length + i }]);
  updateItems(updates);
}

// ---- links ------------------------------------------------------------------------------------

export function addLink(link) {
  if (link.from === link.to) return null;
  const exists = store.board.links.find(
    (l) => (l.from === link.from && l.to === link.to) || (l.from === link.to && l.to === link.from),
  );
  if (exists) return exists;
  store.board.links = store.board.links.concat(link);
  touch('links');
  return link;
}

export function updateLink(id, patch) {
  store.board.links = store.board.links.map((l) => (l.id === id ? { ...l, ...patch } : l));
  touch('links');
}

export function removeLinks(ids) {
  const set = new Set(ids);
  store.board.links = store.board.links.filter((l) => !set.has(l.id));
  if (set.has(store.selectedLink)) store.selectedLink = null;
  touch('links', 'selection');
}

export function setAutoLinks(links) {
  store.autoLinks = links;
  if (store.selectedLink && store.selectedLink.startsWith('auto:') && !links.some((l) => l.id === store.selectedLink)) {
    store.selectedLink = null;
  }
  notify('links');
}

// ---- selection / misc ---------------------------------------------------------------------------

export function setSelection(ids) {
  store.selection = new Set(ids);
  store.selectedLink = null;
  notify('selection');
}

export function toggleSelection(id) {
  if (store.selection.has(id)) store.selection.delete(id);
  else store.selection.add(id);
  store.selectedLink = null;
  notify('selection');
}

export function selectLink(id) {
  store.selectedLink = id;
  store.selection = new Set();
  notify('selection', 'links');
}

export function setEditing(id) {
  store.editingId = id;
  notify('items', 'editing');
}

export function setViewport(vp) {
  store.board.viewport = vp;
  notify('viewport', 'save-quiet');
}

export function setBoardSetting(key, value) {
  store.board.settings[key] = value;
  touch('settings', 'links');
}

export function setWorkspaces(workspaces) {
  store.board.workspaces = workspaces;
  touch('workspaces');
}

export function renameBoard(name) {
  store.board.name = name;
  touch('board-name');
}

export function setUi(patch) {
  Object.assign(store.ui, patch);
  notify('ui');
}

export function setGraph(graph, autoLinks) {
  store.graph = graph;
  store.analysisVersion++;
  setAutoLinks(autoLinks);
  notify('analysis', 'items');
}
