import { store, setViewport } from './store.js';
import { clamp } from './util.js';

export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 3;
const GRID = 28;

let viewportEl = null;
let worldEl = null;
let gridEl = null;
let anim = null;
let lastZoom = null;
let zoomIdle = null;

export function initViewport(vEl, wEl) {
  viewportEl = vEl;
  worldEl = wEl;
  // The dot grid lives on its own layer so panning only moves a texture instead of repainting.
  gridEl = document.createElement('div');
  gridEl.className = 'board-grid';
  viewportEl.prepend(gridEl);
}

export function getViewportEl() {
  return viewportEl;
}

export function applyViewport() {
  if (!store.board || !worldEl) return;
  const { x, y, zoom } = store.board.viewport;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  const size = GRID * zoom;
  // Space the dots out when zoomed far out so the grid never turns into noise.
  const gridSize = size < 9 ? size * 4 : size;
  const ox = ((x % gridSize) + gridSize) % gridSize;
  const oy = ((y % gridSize) + gridSize) % gridSize;
  gridEl.style.transform = `translate(${ox - gridSize}px, ${oy - gridSize}px)`;
  if (zoom === lastZoom) return;
  // Only touch zoom-dependent styles when the zoom actually changes: custom properties on an
  // ancestor restyle every card, which is far too slow to do on every pan frame.
  lastZoom = zoom;
  // Keep the world on its own GPU layer only while zooming. A permanent will-change makes
  // Chromium keep rasterizing at the old scale, which gets very slow when zoomed far out.
  worldEl.classList.add('zooming');
  clearTimeout(zoomIdle);
  zoomIdle = setTimeout(() => worldEl.classList.remove('zooming'), 220);
  gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  gridEl.style.setProperty('--grid', `${gridSize}px`);
  const far = zoom < 0.42;
  const tiny = zoom < 0.16;
  if (worldEl.classList.contains('lod-far') !== far) worldEl.classList.toggle('lod-far', far);
  if (worldEl.classList.contains('lod-tiny') !== tiny) worldEl.classList.toggle('lod-tiny', tiny);
  worldEl.style.setProperty('--zoom', zoom);
  worldEl.style.setProperty('--inv-zoom', 1 / zoom);
}

export function viewportRect() {
  return viewportEl.getBoundingClientRect();
}

export function screenToWorld(clientX, clientY) {
  const r = viewportEl.getBoundingClientRect();
  const { x, y, zoom } = store.board.viewport;
  return { x: (clientX - r.left - x) / zoom, y: (clientY - r.top - y) / zoom };
}

export function worldToScreen(wx, wy) {
  const r = viewportEl.getBoundingClientRect();
  const { x, y, zoom } = store.board.viewport;
  return { x: r.left + x + wx * zoom, y: r.top + y + wy * zoom };
}

export function visibleWorldRect() {
  const r = viewportEl.getBoundingClientRect();
  const { x, y, zoom } = store.board.viewport;
  return { x: -x / zoom, y: -y / zoom, w: r.width / zoom, h: r.height / zoom };
}

export function worldCenter() {
  const v = visibleWorldRect();
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
}

function stopAnim() {
  if (anim) cancelAnimationFrame(anim);
  anim = null;
}

export function setView(next, { animate = false } = {}) {
  stopAnim();
  const target = { x: next.x, y: next.y, zoom: clamp(next.zoom, MIN_ZOOM, MAX_ZOOM) };
  if (!animate) {
    setViewport(target);
    applyViewport();
    return;
  }
  const from = { ...store.board.viewport };
  const start = performance.now();
  const dur = 320;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const k = ease(t);
    // Interpolate zoom geometrically so it feels even.
    const zoom = from.zoom * Math.pow(target.zoom / from.zoom, k);
    setViewport({ x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, zoom });
    applyViewport();
    anim = t < 1 ? requestAnimationFrame(step) : null;
  };
  anim = requestAnimationFrame(step);
}

export function zoomAt(clientX, clientY, newZoom, opts) {
  const r = viewportEl.getBoundingClientRect();
  const { x, y, zoom } = store.board.viewport;
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const px = clientX - r.left;
  const py = clientY - r.top;
  const wx = (px - x) / zoom;
  const wy = (py - y) / zoom;
  setView({ x: px - wx * z, y: py - wy * z, zoom: z }, opts);
}

export function zoomBy(factor, opts = { animate: true }) {
  const r = viewportEl.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, store.board.viewport.zoom * factor, opts);
}

export function panBy(dx, dy) {
  stopAnim();
  const vp = store.board.viewport;
  setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy });
  applyViewport();
}

/** Width covered by the floating inspector, so "fit" frames content in the visible part. */
function rightInset(r) {
  if (document.body.classList.contains('inspector-hidden') || r.width < 900) return 0;
  const insp = document.getElementById('inspector');
  return insp && insp.offsetWidth ? insp.offsetWidth + 24 : 0;
}

export function fitRect(rect, { padding = 80, maxZoom = 1, animate = true } = {}) {
  if (!rect) return;
  const r = viewportEl.getBoundingClientRect();
  const width = r.width - rightInset(r);
  const zoom = clamp(Math.min((width - padding * 2) / Math.max(rect.w, 1), (r.height - padding * 2) / Math.max(rect.h, 1)), MIN_ZOOM, maxZoom);
  const x = width / 2 - (rect.x + rect.w / 2) * zoom;
  const y = r.height / 2 - (rect.y + rect.h / 2) * zoom;
  setView({ x, y, zoom }, { animate });
}

export function centerOn(point, { zoom, animate = true } = {}) {
  const r = viewportEl.getBoundingClientRect();
  const z = zoom ?? store.board.viewport.zoom;
  const width = r.width - rightInset(r);
  setView({ x: width / 2 - point.x * z, y: r.height / 2 - point.y * z, zoom: z }, { animate });
}
