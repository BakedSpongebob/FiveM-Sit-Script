// Autosave + boards library. Boards are saved as JSON in the app's user-data folder.
import { store, subscribe, setBoard, notify } from './store.js';
import { uid } from './util.js';
import { syncBoardFromDisk } from './importer.js';
import { welcomeBoard } from './welcome.js';
import { toast } from './ui/toast.js';

let saveTimer = null;
let saving = null;
let status = 'saved';
const statusListeners = new Set();

export function onSaveStatus(fn) {
  statusListeners.add(fn);
  fn(status);
}

function setStatus(s) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

export function serialize(board) {
  return {
    version: 1,
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    viewport: board.viewport,
    settings: board.settings,
    workspaces: board.workspaces,
    items: board.items,
    links: board.links,
  };
}

export function emptyBoard(name = 'Untitled board') {
  const now = Date.now();
  return { version: 1, id: uid('b'), name, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 }, settings: { yarnStyle: 'pinned' }, workspaces: [], items: [], links: [] };
}

function scheduleSave(delay) {
  setStatus('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, delay);
}

async function doSave() {
  clearTimeout(saveTimer);
  if (!store.board) return;
  if (saving) {
    await saving;
  }
  const snapshot = serialize(store.board);
  setStatus('saving');
  saving = window.api.boards
    .save(snapshot)
    .then(() => {
      setStatus('saved');
      notify('boards');
    })
    .catch((err) => {
      console.error(err);
      setStatus('error');
      toast(`Could not save the board: ${err.message}`, { type: 'error' });
    })
    .finally(() => {
      saving = null;
    });
  return saving;
}

export async function flushSave() {
  if (status === 'saved' && !saving) return;
  await doSave();
}

export async function initPersistence() {
  subscribe((changes) => {
    if (changes.has('save')) scheduleSave(600);
    else if (changes.has('save-quiet')) scheduleSave(1500);
  });
  window.api.onFlush(async () => {
    try {
      await flushSave();
    } finally {
      window.api.flushed();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (status !== 'saved') doSave();
  });

  const lastId = await window.api.settings.get('lastBoardId');
  let board = lastId ? await window.api.boards.load(lastId) : null;
  if (!board) {
    const list = await window.api.boards.list();
    if (list.length) board = await window.api.boards.load(list[0].id);
  }
  if (!board) {
    board = welcomeBoard(emptyBoard('Welcome'));
    await window.api.boards.save(serialize(board));
  }
  openBoard(board);
}

function openBoard(board) {
  for (const ws of store.board?.workspaces || []) window.api.fs.unwatch(ws.root);
  setBoard(board);
  window.api.settings.set('lastBoardId', board.id);
  setStatus('saved');
  notify('boards');
  syncBoardFromDisk().catch((err) => console.warn('sync failed', err));
}

export async function switchBoard(id) {
  await flushSave();
  const board = await window.api.boards.load(id);
  if (board) openBoard(board);
  else toast('That board could not be opened', { type: 'error' });
}

export async function newBoard(name = 'Untitled board') {
  await flushSave();
  const board = emptyBoard(name);
  await window.api.boards.save(serialize(board));
  openBoard(board);
  return board;
}

export async function deleteBoard(id) {
  await window.api.boards.remove(id);
  if (store.board?.id === id) {
    const list = await window.api.boards.list();
    if (list.length) await switchBoard(list[0].id);
    else await newBoard('Untitled board');
  }
  notify('boards');
}

export async function renameBoardById(id, name) {
  if (store.board?.id === id) {
    store.board.name = name;
    store.board.updatedAt = Date.now();
    notify('board-name', 'save');
    return;
  }
  const board = await window.api.boards.load(id);
  if (!board) return;
  board.name = name;
  await window.api.boards.save(board);
  notify('boards');
}

export async function duplicateBoard(id) {
  await flushSave();
  const board = await window.api.boards.load(id);
  if (!board) return;
  board.id = uid('b');
  board.name = `${board.name} copy`;
  board.createdAt = board.updatedAt = Date.now();
  await window.api.boards.save(board);
  openBoard(board);
}

export async function exportCurrentBoard() {
  await flushSave();
  const p = await window.api.boards.exportBoard(serialize(store.board));
  if (p) toast(`Exported to ${p}`);
}

export async function importBoardFile(filePath) {
  try {
    await flushSave();
    const board = filePath ? await window.api.boards.importFile(filePath) : await window.api.boards.importDialog();
    if (board) {
      openBoard(board);
      toast(`Opened “${board.name}”`);
    }
  } catch (err) {
    toast(`Could not open board: ${err.message}`, { type: 'error' });
  }
}

export const listBoards = () => window.api.boards.list();
