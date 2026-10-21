// Imports folders / FiveM resources onto the board: every folder becomes a frame, every file a
// card, binary assets are grouped into lists, and each resource gets a summary card.
import { store, checkpoint, addItems, updateItems, setWorkspaces, getItem, notify } from './store.js';
import { makeFile, makeImage, FILE_W, FILE_H } from './factory.js';
import { boundsOf, uid, basename, joinPath } from './util.js';
import { isManifestName } from './fivem/analyzer.js';
import { fitRect } from './viewport.js';
import { toast } from './ui/toast.js';

const PAD = 28;
const HEADER = 54;
const GAP = 30;
const RES_W = 380;
const RES_H = 320;
const MAX_ROW = 2600;

function isResourceDir(node) {
  return node.files.some((f) => isManifestName(f.name));
}

function frameKind(node, isRoot) {
  if (isResourceDir(node)) return 'resource';
  if (/^\[.*\]$/.test(node.name)) return 'category';
  return isRoot ? 'workspace' : 'folder';
}

function cardSize(card) {
  return { w: card.w, h: card.h };
}

/**
 * Lay out a scanned tree. Returns frames + cards positioned relative to (0, 0).
 */
function layoutNode(node, ctx, depth) {
  const isRoot = depth === 0;
  let res = ctx.res;
  if (isResourceDir(node)) {
    res = { id: `${ctx.wsId}:${node.relPath || '.'}`, name: isRoot ? ctx.rootName : node.name, relPath: node.relPath };
  }
  const resRel = (relPath) => (res ? (res.relPath ? relPath.slice(res.relPath.length + 1) : relPath) : relPath);

  const cards = [];
  if (res && res.relPath === node.relPath) {
    cards.push({ id: uid('res'), type: 'resource', w: RES_W, h: RES_H, resourceId: res.id, title: res.name, workspaceId: ctx.wsId });
  }
  const binaries = [];
  for (const f of node.files) {
    const common = { workspaceId: ctx.wsId, relPath: f.relPath, resourceId: res?.id || null, resourceName: res?.name || null, resRelPath: resRel(f.relPath) };
    if (f.kind === 'text') {
      const item = makeFile({ x: 0, y: 0 }, f, common);
      if (isManifestName(f.name)) item.h = 300;
      cards.push(item);
    } else if (f.kind === 'image') {
      cards.push(makeImage({ x: 150, y: 110 }, f.dataUrl, { name: f.name, path: f.path, workspaceId: ctx.wsId, relPath: f.relPath, w: 240, h: 180 }));
    } else {
      binaries.push(f);
    }
  }
  // .fxap marks an escrowed resource; keep it as a (binary) file so the analyzer can see it.
  for (const f of binaries.filter((b) => b.name.endsWith('.fxap'))) {
    cards.push(makeFile({ x: 0, y: 0 }, f, { workspaceId: ctx.wsId, relPath: f.relPath, resourceId: res?.id || null, resourceName: res?.name || null, resRelPath: resRel(f.relPath) }));
  }
  const listed = binaries.filter((b) => !b.name.endsWith('.fxap'));
  if (listed.length) {
    cards.push({
      id: uid('fl'),
      type: 'filelist',
      w: 330,
      h: Math.min(340, 64 + listed.length * 26),
      title: node.name,
      workspaceId: ctx.wsId,
      relPath: node.relPath,
      entries: listed.map((b) => ({ name: b.name, size: b.size, path: b.path })),
    });
  }

  // Cards in a grid.
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(cards.length * 1.4))));
  let y = HEADER;
  let gridW = 0;
  for (let row = 0; row * cols < cards.length; row++) {
    const rowCards = cards.slice(row * cols, row * cols + cols);
    let x = PAD;
    let rowH = 0;
    for (const c of rowCards) {
      const s = cardSize(c);
      c.x = x;
      c.y = y;
      x += s.w + GAP;
      rowH = Math.max(rowH, s.h);
    }
    gridW = Math.max(gridW, x - GAP - PAD);
    y += rowH + GAP;
  }

  // Sub-folders in shelves below the grid.
  const subs = node.dirs.map((d) => layoutNode(d, { ...ctx, res }, depth + 1));
  const rowLimit = Math.max(gridW, MAX_ROW);
  let x = PAD;
  let rowH = 0;
  let maxW = gridW;
  for (const s of subs) {
    if (x > PAD && x - PAD + s.w > rowLimit) {
      y += rowH + GAP;
      x = PAD;
      rowH = 0;
    }
    s.x = x;
    s.y = y;
    x += s.w + GAP;
    rowH = Math.max(rowH, s.h);
    maxW = Math.max(maxW, x - GAP - PAD);
  }
  if (subs.length) y += rowH + GAP;

  const w = Math.max(maxW, 300) + PAD * 2;
  const hgt = Math.max(y - GAP + PAD, HEADER + 80);
  const kind = frameKind(node, isRoot);
  return {
    w,
    h: hgt,
    frame: {
      id: uid('f'),
      type: 'frame',
      kind,
      title: isRoot ? ctx.rootName : node.name,
      subtitle: isRoot ? ctx.rootPath : node.relPath,
      color: kind === 'resource' ? 'green' : kind === 'category' ? 'purple' : 'grey',
      workspaceId: ctx.wsId,
      relPath: node.relPath,
      resourceId: kind === 'resource' ? res.id : null,
    },
    cards,
    subs,
  };
}

function place(layout, ox, oy, out) {
  out.push({ ...layout.frame, x: ox, y: oy, w: layout.w, h: layout.h });
  for (const c of layout.cards) out.push({ ...c, x: ox + c.x, y: oy + c.y });
  for (const s of layout.subs) place(s, ox + s.x, oy + s.y, out);
}

function countFiles(node) {
  return node.files.length + node.dirs.reduce((n, d) => n + countFiles(d), 0);
}

/** Free spot to the right of everything already on the board. */
function freeOrigin() {
  const b = boundsOf(store.board.items);
  if (!b) return { x: 0, y: 0 };
  return { x: b.x + b.w + 240, y: b.y };
}

export async function importFolder(root) {
  const busy = toast(`Scanning ${basename(root)}…`, { type: 'busy', timeout: 0 });
  let scan;
  try {
    scan = await window.api.fs.scan(root);
  } catch (err) {
    busy.update(`Could not read folder: ${err.message}`, { type: 'error', timeout: 5000 });
    return null;
  }
  const wsId = uid('ws');
  const layout = layoutNode(scan.tree, { wsId, rootName: scan.name, rootPath: root, res: null }, 0);
  const origin = freeOrigin();
  const items = [];
  place(layout, origin.x, origin.y, items);
  checkpoint();
  addItems(items, { select: false });
  setWorkspaces([...store.board.workspaces, { id: wsId, root, name: scan.name, importedAt: Date.now() }]);
  window.api.fs.watch(root);
  const files = countFiles(scan.tree);
  const resources = items.filter((i) => i.type === 'resource').length;
  let msg = `Imported ${files} file${files === 1 ? '' : 's'} from ${scan.name}`;
  if (resources) msg += ` · ${resources} FiveM resource${resources === 1 ? '' : 's'}`;
  if (scan.stats.limited) msg += ' (stopped at the file limit — import a sub-folder for the rest)';
  busy.update(msg, { type: scan.stats.limited ? 'warn' : 'info', timeout: 5000 });
  fitRect(boundsOf(items), { padding: 60, maxZoom: 0.9 });
  return wsId;
}

/** Re-read a workspace from disk: refresh contents, flag missing files and add new ones. */
export async function rescanWorkspace(wsId, { quiet = false } = {}) {
  const ws = store.board.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  const stat = await window.api.fs.stat(ws.root);
  if (!stat.exists) {
    if (!quiet) toast(`${ws.name}: folder not found at ${ws.root}`, { type: 'warn' });
    return;
  }
  let scan;
  try {
    scan = await window.api.fs.scan(ws.root);
  } catch (err) {
    if (!quiet) toast(`Rescan failed: ${err.message}`, { type: 'error' });
    return;
  }
  const existing = new Map();
  for (const it of store.board.items) if (it.workspaceId === wsId && it.type === 'file') existing.set(it.relPath, it);
  const seen = new Set();
  const updates = new Map();
  const fresh = [];
  const walk = (node, res) => {
    let r = res;
    if (isResourceDir(node)) r = { id: `${wsId}:${node.relPath || '.'}`, name: node.relPath ? node.name : scan.name, relPath: node.relPath };
    for (const f of node.files) {
      if (f.kind === 'image' || (f.kind === 'binary' && !f.name.endsWith('.fxap'))) continue;
      seen.add(f.relPath);
      const it = existing.get(f.relPath);
      if (it) {
        const content = f.kind === 'text' ? f.content : null;
        if (it.missing) updates.set(it.id, { missing: false });
        if (content !== it.content) {
          if (it.dirty) updates.set(it.id, { ...(updates.get(it.id) || {}), diskChanged: true });
          else updates.set(it.id, { ...(updates.get(it.id) || {}), content, size: f.size, mtimeMs: f.mtimeMs, truncated: !!f.truncated, diskChanged: false });
        }
      } else {
        const resRelPath = r ? (r.relPath ? f.relPath.slice(r.relPath.length + 1) : f.relPath) : f.relPath;
        fresh.push(makeFile({ x: 0, y: 0 }, f, { workspaceId: wsId, relPath: f.relPath, resourceId: r?.id || null, resourceName: r?.name || null, resRelPath }));
      }
    }
    for (const d of node.dirs) walk(d, r);
  };
  walk(scan.tree, null);
  for (const [rel, it] of existing) if (!seen.has(rel) && !it.missing) updates.set(it.id, { missing: true });

  if (fresh.length) {
    const rootFrame = store.board.items.find((i) => i.type === 'frame' && i.workspaceId === wsId && !i.relPath);
    const base = rootFrame ? { x: rootFrame.x + rootFrame.w + 80, y: rootFrame.y } : freeOrigin();
    const cols = Math.min(4, Math.ceil(Math.sqrt(fresh.length)));
    fresh.forEach((f, i) => {
      f.x = base.x + (i % cols) * (FILE_W + GAP);
      f.y = base.y + 60 + Math.floor(i / cols) * (FILE_H + GAP);
    });
  }
  if (updates.size || fresh.length) {
    if (fresh.length) checkpoint();
    if (updates.size) updateItems(updates, { content: true });
    if (fresh.length) addItems(fresh, { select: false });
  }
  if (!quiet) {
    const missing = [...updates.values()].filter((u) => u.missing).length;
    const parts = [`${ws.name}: rescanned`];
    if (fresh.length) parts.push(`${fresh.length} new file${fresh.length === 1 ? '' : 's'} (placed to the right)`);
    if (missing) parts.push(`${missing} missing`);
    toast(parts.join(' · '));
  }
}

/** Handle a batch of file-system change notifications from the watcher. */
export async function onFilesChanged({ root, paths }) {
  const ws = store.board?.workspaces.find((w) => w.root === root);
  if (!ws) return;
  const byRel = new Map();
  for (const it of store.board.items) if (it.workspaceId === ws.id && it.type === 'file') byRel.set(it.relPath, it);
  const updates = new Map();
  let unknown = 0;
  for (const rel of paths) {
    const it = byRel.get(rel);
    const full = joinPath(root, rel);
    if (!it) {
      const s = await window.api.fs.stat(full);
      if (s.exists && s.isFile) unknown++;
      continue;
    }
    const desc = await window.api.fs.readFile(full).catch(() => null);
    const current = getItem(it.id);
    if (!current) continue;
    if (!desc || desc.unreadable) {
      const s = await window.api.fs.stat(full);
      if (!s.exists) updates.set(it.id, { missing: true });
      continue;
    }
    const content = desc.kind === 'text' ? desc.content : null;
    if (content === current.content) {
      if (current.missing || current.diskChanged) updates.set(it.id, { missing: false, diskChanged: false });
      continue;
    }
    if (current.dirty) updates.set(it.id, { diskChanged: true, missing: false });
    else updates.set(it.id, { content, size: desc.size, mtimeMs: desc.mtimeMs, missing: false, diskChanged: false, truncated: !!desc.truncated });
  }
  if (updates.size) updateItems(updates, { content: true });
  if (unknown) {
    toast(`${ws.name}: ${unknown} new file${unknown === 1 ? '' : 's'} on disk`, {
      action: { label: 'Rescan', fn: () => rescanWorkspace(ws.id) },
      timeout: 8000,
    });
  }
}

/** On board open: pull the latest contents of every saved file card from disk. */
export async function syncBoardFromDisk() {
  const files = store.board.items.filter((i) => i.type === 'file' && i.path && i.kind !== 'binary');
  const updates = new Map();
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      const desc = await window.api.fs.readFile(it.path).catch(() => null);
      const current = getItem(it.id);
      if (!current) continue;
      if (!desc) {
        updates.set(it.id, { missing: true });
        continue;
      }
      const content = desc.kind === 'text' ? desc.content : null;
      if (content === current.content) {
        if (current.missing) updates.set(it.id, { missing: false });
      } else if (current.dirty) updates.set(it.id, { diskChanged: true, missing: false });
      else updates.set(it.id, { content, size: desc.size, mtimeMs: desc.mtimeMs, missing: false, truncated: !!desc.truncated });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (updates.size) updateItems(updates, { content: true });
  for (const ws of store.board.workspaces) window.api.fs.watch(ws.root);
}

/** Add individual files (from a dialog or drag and drop) at a board position. */
export async function addFilesAt(paths, at) {
  const items = [];
  let x = at.x;
  let y = at.y;
  let col = 0;
  for (const p of paths) {
    const desc = await window.api.fs.readFile(p).catch(() => null);
    if (!desc) continue;
    if (desc.kind === 'image') {
      items.push(makeImage({ x: x + 150, y: y + 110 }, desc.dataUrl, { name: desc.name, path: p }));
    } else {
      items.push(makeFile({ x, y }, { ...desc, path: p, relPath: desc.name }));
    }
    col++;
    if (col % 3 === 0) {
      x = at.x;
      y += FILE_H + GAP;
    } else x += FILE_W + GAP;
  }
  if (!items.length) return [];
  checkpoint();
  return addItems(items);
}

/** Write a scaffolded (unsaved) resource frame to disk and turn it into a live workspace. */
export async function exportFrameToFolder(frameId) {
  const frame = getItem(frameId);
  if (!frame) return;
  const parent = await window.api.dialog.openFolder();
  if (!parent) return;
  const name = (frame.title || 'my_resource').trim().replace(/[\\/:*?"<>|]/g, '-');
  const target = joinPath(parent, name);
  const inside = store.board.items.filter((i) => i.type === 'file' && i.x >= frame.x && i.y >= frame.y && i.x + i.w <= frame.x + frame.w && i.y + i.h <= frame.y + frame.h);
  if (!inside.length) {
    toast('This frame has no file cards to export', { type: 'warn' });
    return;
  }
  const s = await window.api.fs.stat(target);
  if (s.exists) {
    const choice = await window.api.dialog.confirm({ message: `“${name}” already exists in that folder.`, detail: 'Files with the same names will be overwritten.', buttons: ['Overwrite', 'Cancel'], type: 'warning' });
    if (choice !== 0) return;
  }
  const wsId = uid('ws');
  const resourceId = `${wsId}:.`;
  const updates = new Map();
  try {
    for (const it of inside) {
      const rel = it.resRelPath || it.relPath || it.name;
      const full = joinPath(target, rel);
      const res = await window.api.fs.writeFile(full, it.content || '');
      updates.set(it.id, { path: full, relPath: rel, resRelPath: rel, workspaceId: wsId, resourceId, resourceName: name, dirty: false, size: res.size, mtimeMs: res.mtimeMs, name: basename(rel) });
    }
  } catch (err) {
    toast(`Export failed: ${err.message}`, { type: 'error' });
    return;
  }
  checkpoint();
  updates.set(frame.id, { kind: 'resource', scaffold: false, title: name, subtitle: target, workspaceId: wsId, relPath: '', color: 'green', resourceId });
  for (const it of store.board.items) {
    if (it.type === 'resource' && it.resourceId === frame.resourceId) updates.set(it.id, { resourceId, workspaceId: wsId, title: name });
  }
  updateItems(updates, { content: true });
  setWorkspaces([...store.board.workspaces, { id: wsId, root: target, name, importedAt: Date.now() }]);
  window.api.fs.watch(target);
  notify('content');
  toast(`Exported ${inside.length} files to ${target}`, { action: { label: 'Show in Finder', fn: () => window.api.shell.reveal(joinPath(target, 'fxmanifest.lua')) }, timeout: 7000 });
}
