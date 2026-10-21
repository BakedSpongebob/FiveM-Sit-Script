// Minimap in the corner of the board: overview of every card plus the visible area. Click or drag to jump.
import { store, subscribe } from '../store.js';
import { boundsOf } from '../util.js';
import { visibleWorldRect, centerOn } from '../viewport.js';

let canvas = null;
let ctx = null;
let raf = null;
let mapping = null;
const colors = { theme: null, frame: '', accent: '' };

const TYPE_COLORS = {
  note: '#c9a94a', text: '#9aa1ad', checklist: '#7d8590', image: '#6e7681', link: '#5aa9ff', file: '#8b949e',
  filelist: '#6e7681', resource: '#3ecf8e',
};
const ROLE_COLORS = { client: '#5aa9ff', server: '#ff9248', shared: '#b48cff', config: '#e9c46a', nui: '#3ecf8e', manifest: '#d0d7de' };

export function initMinimap(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
  subscribe((changes) => {
    if (['items', 'viewport', 'board', 'analysis'].some((k) => changes.has(k))) schedule();
  });
  window.addEventListener('resize', schedule);
  const jump = (e) => {
    if (!mapping) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - mapping.ox) / mapping.s + mapping.bx;
    const y = (e.clientY - r.top - mapping.oy) / mapping.s + mapping.by;
    centerOn({ x, y }, { animate: false });
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    jump(e);
    const move = (ev) => jump(ev);
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = null;
    draw();
  });
}

function draw() {
  if (!store.board || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const items = store.board.items;
  const view = visibleWorldRect();
  const b = boundsOf(items.length ? [...items, view] : [view]);
  const pad = 8;
  const s = Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h);
  const ox = pad + (W - pad * 2 - b.w * s) / 2;
  const oy = pad + (H - pad * 2 - b.h * s) / 2;
  mapping = { s, ox, oy, bx: b.x, by: b.y };
  const tx = (x) => ox + (x - b.x) * s;
  const ty = (y) => oy + (y - b.y) * s;
  const theme = document.body.dataset.theme;
  if (theme !== colors.theme) {
    const cs = getComputedStyle(document.body);
    colors.theme = theme;
    colors.frame = cs.getPropertyValue('--mm-frame').trim() || 'rgba(255,255,255,0.18)';
    colors.accent = cs.getPropertyValue('--accent').trim() || '#7c8cff';
  }
  for (const it of items) {
    if (it.type !== 'frame') continue;
    ctx.strokeStyle = it.kind === 'resource' ? 'rgba(62,207,142,0.55)' : colors.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(tx(it.x), ty(it.y), Math.max(1, it.w * s), Math.max(1, it.h * s));
  }
  for (const it of items) {
    if (it.type === 'frame') continue;
    const role = it.type === 'file' ? store.graph?.files.get(it.id)?.role : null;
    ctx.fillStyle = ROLE_COLORS[role] || TYPE_COLORS[it.type] || '#8b949e';
    ctx.globalAlpha = store.selection.has(it.id) ? 1 : 0.75;
    ctx.fillRect(tx(it.x), ty(it.y), Math.max(1.5, it.w * s), Math.max(1.5, it.h * s));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tx(view.x), ty(view.y), view.w * s, view.h * s);
}

export function redrawMinimap() {
  schedule();
}
