// Board canvas: renders items, handles selection, dragging, resizing, marquee selection,
// panning/zooming and pulling yarn from one card to another.
import {
  store, subscribe, getItem, checkpoint, updateItem, updateItems, setSelection, toggleSelection, selectLink,
  setEditing, bringToFront, addLink, addItems, getLink,
} from './store.js';
import {
  initViewport, applyViewport, screenToWorld, panBy, zoomAt, setView, MIN_ZOOM, MAX_ZOOM,
} from './viewport.js';
import { RENDERERS, editInline } from './items.js';
import { initYarn, renderYarn, showTempYarn, hideTempYarn, linkEndpoints } from './yarn.js';
import { h, uid, clamp, modKey, rectContains, rectsIntersect, isEditableTarget } from './util.js';

const views = new Map();
let els = {};
let actions = {};
let io = null;
let ro = null;
let gesture = null;
let spaceDown = false;
let lastLod = null;
const pendingHeights = new Map();

const itemCtx = () => ({
  editingId: store.editingId,
  graph: store.graph,
  zoom: store.board?.viewport.zoom ?? 1,
  actions: itemActions,
});

const itemActions = {
  getItem,
  commitField(id, field, value) {
    const it = getItem(id);
    if (store.editingId === id && (field === 'text' || field === 'title')) setEditing(null);
    if (!it || value == null) return;
    if (JSON.stringify(it[field] ?? '') === JSON.stringify(value)) return;
    checkpoint();
    updateItem(id, { [field]: value });
  },
  openEditor: (id) => actions.openEditor?.(id),
  openUrl: (url) => actions.openUrl?.(url),
  reveal: (p) => window.api.shell.reveal(p),
  openPath: (p) => window.api.shell.openPath(p),
  exportFrame: (id) => actions.exportFrame?.(id),
};

export function initBoard(elements, appActions) {
  els = elements;
  actions = appActions;
  initViewport(els.viewport, els.world);
  initYarn(els.yarn, els.yarnAuto, els.yarnFocus);

  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const v = entry.target._view;
        if (!v) continue;
        v.isVisible = entry.isIntersecting;
        if (v.isVisible && v.renderer.visible && v.item) v.renderer.visible(v, v.item, itemCtx());
      }
    },
    { root: els.viewport, rootMargin: '300px' },
  );

  ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const v = entry.target._view;
      if (!v || !v.item) continue;
      const hgt = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight);
      if (hgt > 0 && Math.abs(hgt - v.item.h) > 1) pendingHeights.set(v.item.id, { h: hgt });
    }
    if (pendingHeights.size) {
      const updates = new Map(pendingHeights);
      pendingHeights.clear();
      updateItems([...updates].filter(([id]) => getItem(id)));
    }
  });

  const vp = els.viewport;
  vp.addEventListener('pointerdown', onPointerDown);
  vp.addEventListener('pointermove', onPointerMove);
  vp.addEventListener('pointerup', onPointerUp);
  vp.addEventListener('pointercancel', onPointerUp);
  vp.addEventListener('dblclick', onDoubleClick);
  vp.addEventListener('wheel', onWheel, { passive: false });
  vp.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isEditableTarget(e.target) && !e.repeat) {
      spaceDown = true;
      vp.classList.add('space-pan');
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      vp.classList.remove('space-pan');
    }
  });
  window.addEventListener('blur', () => {
    spaceDown = false;
    vp.classList.remove('space-pan');
  });

  subscribe(render);
}

// ---------------------------------------------------------------------------------------------
// Rendering

function createView(item) {
  const renderer = RENDERERS[item.type] || RENDERERS.note;
  const isFrame = item.type === 'frame';
  const root = h(isFrame ? 'div.frame' : 'div.item', { dataset: { id: item.id, type: item.type } });
  root.classList.add(`type-${item.type}`);
  const parts = renderer.create(item, itemCtx());
  root.append(parts.body);
  if (!isFrame) root.append(h('div.pin', { 'data-role': 'pin', title: 'Drag to connect with yarn' }));
  root.append(h('div.resize', { 'data-role': 'resize', title: 'Resize' }));
  const v = { ...parts, root, renderer, item: null, sel: null, editing: null, av: -1, isVisible: false };
  root._view = v;
  if (renderer.autoHeight) root.classList.add('auto-height');
  (isFrame ? els.frames : els.items).append(root);
  io.observe(root);
  if (renderer.autoHeight) ro.observe(root);
  return v;
}

function updateView(v, item) {
  const sel = store.selection.has(item.id);
  const editing = store.editingId === item.id;
  const needsAnalysis = (item.type === 'file' || item.type === 'resource') && v.av !== store.analysisVersion;
  if (v.item === item && v.sel === sel && v.editing === editing && !needsAnalysis) return;
  const prev = v.item;
  const root = v.root;
  if (!prev || prev.x !== item.x || prev.y !== item.y) root.style.transform = `translate(${item.x}px, ${item.y}px)`;
  if (!prev || prev.w !== item.w) root.style.width = `${item.w}px`;
  if (!v.renderer.autoHeight && (!prev || prev.h !== item.h)) root.style.height = `${item.h}px`;
  if (item.type !== 'frame' && (!prev || prev.z !== item.z)) root.style.zIndex = item.z || 1;
  root.classList.toggle('selected', sel);
  root.classList.toggle('editing', editing);
  const contentChanged = prev !== item || needsAnalysis || v.editing !== editing;
  v.item = item;
  v.sel = sel;
  v.editing = editing;
  v.av = store.analysisVersion;
  if (contentChanged) v.renderer.update(v, item, itemCtx());
}

function reconcile() {
  const seen = new Set();
  let framesChanged = false;
  for (const item of store.board.items) {
    seen.add(item.id);
    let v = views.get(item.id);
    if (!v) {
      v = createView(item);
      views.set(item.id, v);
      if (item.type === 'frame') framesChanged = true;
    } else if (item.type === 'frame' && v.item !== item && (v.item.w !== item.w || v.item.h !== item.h)) framesChanged = true;
    updateView(v, item);
  }
  for (const [id, v] of views) {
    if (seen.has(id)) continue;
    io.unobserve(v.root);
    ro.unobserve(v.root);
    v.root.remove();
    views.delete(id);
    if (v.item?.type === 'frame') framesChanged = true;
  }
  if (framesChanged) {
    // Bigger frames sit behind smaller (nested) ones.
    const frames = store.board.items.filter((i) => i.type === 'frame').sort((a, b) => b.w * b.h - a.w * a.h);
    frames.forEach((f, i) => {
      const v = views.get(f.id);
      if (v) v.root.style.zIndex = i + 1;
    });
  }
}

function clearViews() {
  for (const v of views.values()) {
    io.unobserve(v.root);
    ro.unobserve(v.root);
    v.root.remove();
  }
  views.clear();
}

function render(changes) {
  if (!store.board) return;
  if (changes.has('board')) {
    clearViews();
    lastLod = null;
  }
  if (changes.has('viewport') || changes.has('board')) {
    applyViewport();
    const lod = store.board.viewport.zoom < 0.42 ? 'far' : 'near';
    if (lod !== lastLod) {
      lastLod = lod;
      if (lod === 'near') for (const v of views.values()) if (v.isVisible && v.renderer.visible && v.item) v.renderer.visible(v, v.item, itemCtx());
    }
  }
  if (changes.has('items') || changes.has('selection') || changes.has('analysis') || changes.has('editing') || changes.has('board')) reconcile();
  if (changes.has('items') || changes.has('links') || changes.has('selection') || changes.has('settings') || changes.has('ui') || changes.has('board')) {
    els.world.dataset.yarn = store.board.settings.yarnStyle || 'pinned';
    renderYarn();
  }
}

export function viewFor(id) {
  return views.get(id);
}

// ---------------------------------------------------------------------------------------------
// Hit testing

const INTERACTIVE = 'button, input, textarea, select, a, label, .is-editing, .CodeMirror, [data-action]';

function isInteractive(target) {
  return !!target.closest(INTERACTIVE);
}

export function itemAtPoint(clientX, clientY, { includeFrames = true } = {}) {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const el = node.closest?.('.item, .frame');
    if (!el || !els.world.contains(el)) continue;
    if (el.classList.contains('frame')) {
      if (!includeFrames) continue;
      return getItem(el.dataset.id);
    }
    return getItem(el.dataset.id);
  }
  return null;
}

function onScrollbar(e) {
  const sc = e.target.closest('.scrollable');
  if (!sc || e.target !== sc) return false;
  return e.offsetX > sc.clientWidth || e.offsetY > sc.clientHeight;
}

// ---------------------------------------------------------------------------------------------
// Pointer gestures

function blurEditing(except) {
  const active = document.activeElement;
  if (active && isEditableTarget(active) && els.world.contains(active) && (!except || !except.contains(active))) active.blur();
}

function onPointerDown(e) {
  if (!store.board) return;
  actions.closeMenus?.();
  const t = e.target;
  if (e.button === 1 || (e.button === 0 && (spaceDown || store.ui.tool === 'hand'))) {
    e.preventDefault();
    startPan(e);
    return;
  }
  if (e.button !== 0) return;
  if (isInteractive(t) || onScrollbar(e)) return;

  const hit = t.closest('.yarn-hit');
  if (hit) {
    e.preventDefault();
    onYarnDown(e, hit.dataset.linkId);
    return;
  }

  const itemEl = t.closest('.item, .frame');
  if (itemEl && els.world.contains(itemEl)) {
    const item = getItem(itemEl.dataset.id);
    if (!item) return;
    const role = t.closest('[data-role]')?.dataset.role;
    blurEditing(itemEl);
    if (role === 'pin') {
      e.preventDefault();
      startConnect(e, item);
      return;
    }
    if (role === 'resize') {
      e.preventDefault();
      startResize(e, item);
      return;
    }
    if (item.type === 'frame' && role !== 'frame-header') {
      startMarquee(e);
      return;
    }
    if (store.editingId === item.id) return;
    if (e.shiftKey || modKey(e)) {
      toggleSelection(item.id);
      if (!store.selection.has(item.id)) return;
    } else if (!store.selection.has(item.id)) setSelection([item.id]);
    startDrag(e, item);
    return;
  }

  blurEditing();
  startMarquee(e);
}

function capture(e) {
  try {
    els.viewport.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already released */
  }
}

function startPan(e) {
  capture(e);
  const vp = store.board.viewport;
  gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y };
  els.viewport.classList.add('panning');
}

function startDrag(e, item) {
  capture(e);
  const moving = new Set(store.selection);
  for (const id of store.selection) {
    const it = getItem(id);
    if (it?.type !== 'frame') continue;
    for (const other of store.board.items) if (other.id !== id && rectContains(it, other)) moving.add(other.id);
  }
  const origins = new Map();
  for (const id of moving) {
    const it = getItem(id);
    if (it) origins.set(id, { x: it.x, y: it.y });
  }
  gesture = { type: 'drag', sx: e.clientX, sy: e.clientY, origins, moved: false, clicked: item.id, shift: e.shiftKey || modKey(e) };
}

function startResize(e, item) {
  capture(e);
  gesture = { type: 'resize', id: item.id, sx: e.clientX, sy: e.clientY, ow: item.w, oh: item.h, moved: false, ratio: item.w / Math.max(1, item.h) };
}

function startMarquee(e) {
  capture(e);
  const additive = e.shiftKey || modKey(e);
  if (!additive && (store.selection.size || store.selectedLink)) setSelection([]);
  if (store.editingId) setEditing(null);
  gesture = { type: 'marquee', sx: e.clientX, sy: e.clientY, base: new Set(additive ? store.selection : []), moved: false };
}

function startConnect(e, item) {
  capture(e);
  gesture = { type: 'connect', from: item.id, sx: e.clientX, sy: e.clientY, moved: false, target: null };
  els.viewport.classList.add('connecting');
}

function onYarnDown(e, linkId) {
  const link = getLink(linkId);
  if (!link) return;
  const ends = linkEndpoints(link);
  const p = screenToWorld(e.clientX, e.clientY);
  const tol = 14 / store.board.viewport.zoom;
  if (ends) {
    if (Math.hypot(p.x - ends.from.x, p.y - ends.from.y) < tol) return startConnect(e, getItem(link.from));
    if (Math.hypot(p.x - ends.to.x, p.y - ends.to.y) < tol) return startConnect(e, getItem(link.to));
  }
  selectLink(linkId);
}

function onPointerMove(e) {
  if (!gesture) return;
  const zoom = store.board.viewport.zoom;
  const dxs = e.clientX - gesture.sx;
  const dys = e.clientY - gesture.sy;
  const far = Math.hypot(dxs, dys) > 3;

  switch (gesture.type) {
    case 'pan':
      setView({ x: gesture.ox + dxs, y: gesture.oy + dys, zoom });
      break;
    case 'drag': {
      if (!gesture.moved) {
        if (!far) return;
        gesture.moved = true;
        checkpoint();
        bringToFront([...store.selection]);
        els.viewport.classList.add('dragging');
      }
      const dx = dxs / zoom;
      const dy = dys / zoom;
      updateItems([...gesture.origins].map(([id, o]) => [id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }]));
      break;
    }
    case 'resize': {
      const item = getItem(gesture.id);
      if (!item) return;
      if (!gesture.moved) {
        if (!far) return;
        gesture.moved = true;
        checkpoint();
      }
      const r = RENDERERS[item.type] || {};
      let w = Math.max(r.minW || 60, Math.round(gesture.ow + dxs / zoom));
      let hgt = Math.max(r.minH || 40, Math.round(gesture.oh + dys / zoom));
      if (r.keepAspect && !e.shiftKey) hgt = Math.max(r.minH || 40, Math.round(w / gesture.ratio));
      updateItem(item.id, r.autoHeight ? { w } : { w, h: hgt });
      break;
    }
    case 'marquee': {
      if (!gesture.moved && !far) return;
      gesture.moved = true;
      const vr = els.viewport.getBoundingClientRect();
      const x1 = Math.min(gesture.sx, e.clientX);
      const y1 = Math.min(gesture.sy, e.clientY);
      const x2 = Math.max(gesture.sx, e.clientX);
      const y2 = Math.max(gesture.sy, e.clientY);
      Object.assign(els.marquee.style, { display: 'block', left: `${x1 - vr.left}px`, top: `${y1 - vr.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
      const a = screenToWorld(x1, y1);
      const b = screenToWorld(x2, y2);
      const rect = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      const sel = new Set(gesture.base);
      for (const it of store.board.items) {
        const hitIt = it.type === 'frame' ? rectContains(rect, it) : rectsIntersect(rect, it);
        if (hitIt) sel.add(it.id);
      }
      if (sel.size !== store.selection.size || [...sel].some((id) => !store.selection.has(id))) setSelection([...sel]);
      break;
    }
    case 'connect': {
      if (!gesture.moved && !far) return;
      gesture.moved = true;
      const from = getItem(gesture.from);
      if (!from) return;
      showTempYarn(from, screenToWorld(e.clientX, e.clientY));
      const target = itemAtPoint(e.clientX, e.clientY);
      const targetId = target && target.id !== from.id ? target.id : null;
      if (targetId !== gesture.target) {
        if (gesture.target) views.get(gesture.target)?.root.classList.remove('connect-target');
        if (targetId) views.get(targetId)?.root.classList.add('connect-target');
        gesture.target = targetId;
      }
      break;
    }
    default:
      break;
  }
}

function onPointerUp(e) {
  const g = gesture;
  gesture = null;
  els.viewport.classList.remove('panning', 'dragging', 'connecting');
  if (!g) return;
  if (g.type === 'drag' && !g.moved && !g.shift && store.selection.size > 1) setSelection([g.clicked]);
  if (g.type === 'marquee') els.marquee.style.display = 'none';
  if (g.type === 'connect') {
    if (g.target) views.get(g.target)?.root.classList.remove('connect-target');
    hideTempYarn();
    if (!g.moved) return;
    const from = getItem(g.from);
    if (!from) return;
    const target = g.target ? getItem(g.target) : null;
    checkpoint();
    if (target) {
      const link = addLink({ id: uid('l'), from: from.id, to: target.id, color: store.ui.yarnColor, label: '', style: 'solid' });
      if (link) selectLink(link.id);
    } else {
      // Dropping yarn on empty board creates a new note at the end of the string.
      const p = screenToWorld(e.clientX, e.clientY);
      const [note] = addItems([{ id: uid('n'), type: 'note', x: Math.round(p.x - 110), y: Math.round(p.y - 20), w: 220, h: 150, text: '', color: 'yellow' }]);
      addLink({ id: uid('l'), from: from.id, to: note.id, color: store.ui.yarnColor, label: '', style: 'solid' });
      setSelection([note.id]);
      setEditing(note.id);
    }
  }
}

function onWheel(e) {
  if (!store.board) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const d = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -40, 40);
    zoomAt(e.clientX, e.clientY, store.board.viewport.zoom * Math.exp(-d * 0.0105));
    return;
  }
  const sc = e.target.closest?.('.scrollable');
  if (sc) {
    const itemEl = sc.closest('.item');
    const id = itemEl?.dataset.id;
    if (id && (store.selection.has(id) || store.editingId === id) && canScroll(sc, e.deltaX, e.deltaY)) return;
  }
  e.preventDefault();
  const mul = e.deltaMode === 1 ? 16 : 1;
  panBy(-e.deltaX * mul, -e.deltaY * mul);
}

function canScroll(el, dx, dy) {
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function onDoubleClick(e) {
  if (!store.board) return;
  const t = e.target;
  if (t.closest('input, textarea, button, .is-editing, [data-action]')) return;
  const hit = t.closest('.yarn-hit');
  if (hit) {
    actions.editLinkLabel?.(hit.dataset.linkId);
    return;
  }
  const itemEl = t.closest('.item, .frame');
  if (itemEl && els.world.contains(itemEl)) {
    const item = getItem(itemEl.dataset.id);
    if (!item) return;
    if (item.type === 'frame') {
      if (t.closest('[data-role="frame-header"]')) renameFrame(item);
      else actions.createAt?.('note', screenToWorld(e.clientX, e.clientY));
      return;
    }
    switch (item.type) {
      case 'note':
      case 'text':
      case 'checklist':
        setSelection([item.id]);
        setEditing(item.id);
        break;
      case 'file':
        actions.openEditor?.(item.id);
        break;
      case 'link':
        actions.editLink?.(item.id);
        break;
      case 'resource': {
        const res = store.graph?.resources.get(item.resourceId);
        if (res?.manifestFileId) actions.openEditor?.(res.manifestFileId);
        break;
      }
      default:
        break;
    }
    return;
  }
  actions.createAt?.('note', screenToWorld(e.clientX, e.clientY));
}

export function renameFrame(item) {
  const v = views.get(item.id);
  if (!v) return;
  editInline(v.title, item.title, (val) => itemActions.commitField(item.id, 'title', val?.trim() || item.title), { multiline: false, selectAll: true });
}

function onContextMenu(e) {
  e.preventDefault();
  if (!store.board) return;
  const t = e.target;
  if (t.closest('.is-editing, input, textarea')) return;
  const hit = t.closest('.yarn-hit');
  const world = screenToWorld(e.clientX, e.clientY);
  if (hit) {
    selectLink(hit.dataset.linkId);
    actions.contextMenu?.({ kind: 'link', id: hit.dataset.linkId, x: e.clientX, y: e.clientY, world });
    return;
  }
  const itemEl = t.closest('.item, .frame');
  if (itemEl && els.world.contains(itemEl)) {
    const item = getItem(itemEl.dataset.id);
    const onFrameBody = item?.type === 'frame' && !t.closest('[data-role="frame-header"]');
    if (item && !onFrameBody) {
      if (!store.selection.has(item.id)) setSelection([item.id]);
      actions.contextMenu?.({ kind: 'item', id: item.id, x: e.clientX, y: e.clientY, world });
      return;
    }
  }
  actions.contextMenu?.({ kind: 'board', x: e.clientX, y: e.clientY, world });
}

export { MIN_ZOOM, MAX_ZOOM };
