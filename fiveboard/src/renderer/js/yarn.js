// Draws the yarn between cards: a sagging string with a soft shadow and a twisted highlight,
// pinned to each card. Auto-detected FiveM relationships use the same yarn in their own colors.
import { store, getItem, allLinks } from './store.js';

const NS = 'http://www.w3.org/2000/svg';

export const LINK_KINDS = {
  manual: { label: 'Your yarn', color: '#e5484d' },
  manifest: { label: 'Manifest loads', color: '#7aa2ff' },
  net: { label: 'Net events', color: '#ff7a59' },
  local: { label: 'Local events', color: '#c3a6ff' },
  callback: { label: 'Callbacks', color: '#2dd4bf' },
  nui: { label: 'NUI', color: '#4ade80' },
  export: { label: 'Exports', color: '#f5c451' },
  include: { label: 'HTML includes', color: '#9aa1ad' },
};

const KIND_COLORS = {
  'manifest-client': '#5aa9ff',
  'manifest-server': '#ff9248',
  'manifest-shared': '#b48cff',
  'manifest-ui': '#3ecf8e',
  'event-c2s': '#ff6b5e',
  'event-s2c': '#5cc8ff',
  'event-local': '#c3a6ff',
  callback: '#2dd4bf',
  'nui-message': '#4ade80',
  'nui-callback': '#a3e635',
  export: '#f5c451',
  include: '#9aa1ad',
};

export const KIND_TITLES = {
  'manifest-client': 'fxmanifest loads client script',
  'manifest-server': 'fxmanifest loads server script',
  'manifest-shared': 'fxmanifest loads shared script',
  'manifest-ui': 'fxmanifest ui_page',
  'event-c2s': 'Client → server event (TriggerServerEvent)',
  'event-s2c': 'Server → client event (TriggerClientEvent)',
  'event-local': 'Local event (TriggerEvent)',
  callback: 'Server callback',
  'nui-message': 'SendNUIMessage → NUI page',
  'nui-callback': 'NUI fetch → RegisterNUICallback',
  export: 'Uses export',
  include: 'HTML includes file',
};

export function kindGroup(kind) {
  if (!kind || kind === 'manual') return 'manual';
  if (kind.startsWith('manifest')) return 'manifest';
  if (kind === 'event-c2s' || kind === 'event-s2c') return 'net';
  if (kind === 'event-local') return 'local';
  if (kind.startsWith('nui')) return 'nui';
  return kind;
}

export function linkColor(link) {
  return link.auto ? KIND_COLORS[link.kind] || '#9aa1ad' : link.color || LINK_KINDS.manual.color;
}

export const YARN_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#e8e8ec', '#1e1f22'];

// Three SVG layers: your own yarn (pinned on top, or behind cards in clean mode), the
// auto-detected code relationships (always edge-to-edge behind the cards), and a focus layer
// above everything for the strings attached to the current selection.
let layers = null;
let tempPath = null;
const views = new Map();

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function initYarn(manualSvg, autoSvg, focusSvg) {
  const defs = el('defs');
  const grad = el('radialGradient', { id: 'pin-gloss', cx: '35%', cy: '30%', r: '70%' });
  grad.append(el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.85' }), el('stop', { offset: '35%', 'stop-color': '#ffffff', 'stop-opacity': '0.15' }), el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': '0.25' }));
  defs.append(grad);
  const manual = { svg: manualSvg, root: el('g', { class: 'yarn-links' }), pins: el('g', { class: 'yarn-pins' }) };
  const auto = { svg: autoSvg, root: el('g', { class: 'yarn-links' }) };
  tempPath = el('g', { class: 'yarn-temp', style: 'display:none' });
  tempPath.append(el('path', { class: 'yarn-shadow' }), el('path', { class: 'yarn-main' }));
  const focus = { svg: focusSvg, root: el('g', { class: 'yarn-links' }) };
  manualSvg.append(defs, manual.root, tempPath, manual.pins);
  autoSvg.append(auto.root);
  focusSvg.append(focus.root);
  layers = { manual, auto, focus };
}

const styleFor = (link) => (link.auto ? 'clean' : store.board.settings.yarnStyle || 'pinned');

/** Where the yarn attaches on an item. */
export function anchorFor(item, toward, style) {
  if (style === 'pinned') {
    if (item.type === 'frame') return { x: item.x + 28, y: item.y + 18 };
    return { x: item.x + item.w / 2, y: item.y + 11 };
  }
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  if (!toward) return { x: cx, y: cy };
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? item.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? item.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

const center = (it) => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 });

function geometry(a, b, style) {
  const p0 = anchorFor(a, center(b), style);
  const p1 = anchorFor(b, center(a), style);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy);
  const sag = style === 'pinned' ? Math.min(170, Math.max(18, dist * 0.2)) : Math.min(110, Math.max(8, dist * 0.12));
  const c = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 + sag };
  return { p0, p1, c, d: `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}` };
}

export function pointOnCurve(g, t) {
  const u = 1 - t;
  return {
    x: u * u * g.p0.x + 2 * u * t * g.c.x + t * t * g.p1.x,
    y: u * u * g.p0.y + 2 * u * t * g.c.y + t * t * g.p1.y,
    tx: 2 * u * (g.c.x - g.p0.x) + 2 * t * (g.p1.x - g.c.x),
    ty: 2 * u * (g.c.y - g.p0.y) + 2 * t * (g.p1.y - g.c.y),
  };
}

function createView(link) {
  const g = el('g', { class: 'yarn', 'data-link-id': link.id });
  const shadow = el('path', { class: 'yarn-shadow' });
  const main = el('path', { class: 'yarn-main' });
  const twist = el('path', { class: 'yarn-twist' });
  const hit = el('path', { class: 'yarn-hit', 'data-link-id': link.id });
  const arrow = el('path', { class: 'yarn-arrow' });
  const labelG = el('g', { class: 'yarn-label' });
  const labelBg = el('rect', { rx: 6, ry: 6 });
  const labelText = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  labelG.append(labelBg, labelText);
  const title = el('title');
  hit.append(title);
  g.append(shadow, main, twist, arrow, hit, labelG);
  return { g, shadow, main, twist, hit, arrow, labelG, labelBg, labelText, title, key: '' };
}

export function isLinkVisible(link) {
  return store.ui.showKinds[kindGroup(link.auto ? link.kind : 'manual')] !== false;
}

function fitSvg(svg, b, pad = 220) {
  if (b.minX === Infinity) b = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const x = Math.floor(b.minX - pad);
  const y = Math.floor(b.minY - pad);
  const w = Math.ceil(b.maxX - b.minX + pad * 2);
  const hgt = Math.ceil(b.maxY - b.minY + pad * 2);
  svg.style.left = `${x}px`;
  svg.style.top = `${y}px`;
  svg.setAttribute('width', w);
  svg.setAttribute('height', hgt);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${hgt}`);
  svg._bounds = { x, y, w, h: hgt };
}

export function renderYarn() {
  if (!layers || !store.board) return;
  const boardStyle = store.board.settings.yarnStyle || 'pinned';
  const selection = store.selection;
  const focus = selection.size > 0;
  const seen = new Set();
  const bounds = {
    manual: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    auto: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    focus: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };
  const pinned = new Map();

  for (const link of allLinks()) {
    if (!isLinkVisible(link)) continue;
    const a = getItem(link.from);
    const b = getItem(link.to);
    if (!a || !b) continue;
    seen.add(link.id);
    const related = focus && (selection.has(link.from) || selection.has(link.to));
    const selected = store.selectedLink === link.id;
    const layerName = related || selected ? 'focus' : link.auto ? 'auto' : 'manual';
    let v = views.get(link.id);
    if (!v) {
      v = createView(link);
      views.set(link.id, v);
    }
    if (v.layer !== layerName) {
      layers[layerName].root.append(v.g);
      v.layer = layerName;
    }
    const style = styleFor(link);
    const geo = geometry(a, b, style);
    const color = linkColor(link);
    const label = link.auto ? (link.names || []).slice(0, 3).join(', ') + ((link.names || []).length > 3 ? ` +${link.names.length - 3}` : '') : link.label || '';
    const key = [geo.d, color, label, related, selected, focus, link.style, link.arrow, style].join('|');
    if (v.key !== key) {
      v.key = key;
      for (const p of [v.shadow, v.main, v.twist, v.hit]) p.setAttribute('d', geo.d);
      v.g.style.setProperty('--yarn', color);
      v.g.classList.toggle('auto', !!link.auto);
      v.g.classList.toggle('dashed', link.style === 'dashed' || (link.auto && link.kind?.startsWith('event-local')));
      v.g.classList.toggle('related', related);
      v.g.classList.toggle('dim', focus && !related && !selected);
      v.g.classList.toggle('selected', selected);
      v.g.classList.toggle('has-label', !!label && (!link.auto || related || selected));
      const mid = pointOnCurve(geo, 0.5);
      if (link.auto || link.arrow) {
        const ang = Math.atan2(mid.ty, mid.tx);
        const s = 7;
        const pts = [
          [mid.x + Math.cos(ang) * s, mid.y + Math.sin(ang) * s],
          [mid.x + Math.cos(ang + 2.5) * s, mid.y + Math.sin(ang + 2.5) * s],
          [mid.x + Math.cos(ang - 2.5) * s, mid.y + Math.sin(ang - 2.5) * s],
        ];
        v.arrow.setAttribute('d', `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L')} Z`);
        v.arrow.style.display = '';
      } else v.arrow.style.display = 'none';
      if (label) {
        v.labelText.textContent = label;
        const w = Math.min(320, label.length * 6.6 + 16);
        v.labelBg.setAttribute('x', (mid.x - w / 2).toFixed(1));
        v.labelBg.setAttribute('y', (mid.y + 8).toFixed(1));
        v.labelBg.setAttribute('width', w.toFixed(1));
        v.labelBg.setAttribute('height', 20);
        v.labelText.setAttribute('x', mid.x.toFixed(1));
        v.labelText.setAttribute('y', (mid.y + 18).toFixed(1));
      }
      v.title.textContent = link.auto ? `${KIND_TITLES[link.kind] || link.kind}${link.names?.length ? `: ${link.names.join(', ')}` : ''}` : link.label || 'Yarn — click to edit, double-click to label';
    }
    const bb = bounds[layerName];
    bb.minX = Math.min(bb.minX, geo.p0.x, geo.p1.x, geo.c.x);
    bb.minY = Math.min(bb.minY, geo.p0.y, geo.p1.y);
    bb.maxX = Math.max(bb.maxX, geo.p0.x, geo.p1.x, geo.c.x);
    bb.maxY = Math.max(bb.maxY, geo.p0.y, geo.p1.y, geo.c.y);
    if (style === 'pinned') {
      for (const [it, p] of [[a, geo.p0], [b, geo.p1]]) if (!pinned.has(it.id)) pinned.set(it.id, { p, color });
    }
  }
  for (const [id, v] of views) {
    if (!seen.has(id)) {
      v.g.remove();
      views.delete(id);
    }
  }

  // Push pins drawn on top of the yarn so the string looks tied under them.
  layers.manual.pins.replaceChildren(
    ...[...pinned.entries()].map(([id, { p, color }]) => {
      const g = el('g', { class: 'pushpin', 'data-item-id': id });
      g.append(
        el('ellipse', { cx: p.x + 2, cy: p.y + 4, rx: 6.5, ry: 4, class: 'pushpin-shadow' }),
        el('circle', { cx: p.x, cy: p.y, r: 6.5, fill: color, class: 'pushpin-head' }),
        el('circle', { cx: p.x, cy: p.y, r: 6.5, fill: 'url(#pin-gloss)' }),
      );
      return g;
    }),
  );
  layers.manual.svg.dataset.style = boardStyle;
  fitSvg(layers.manual.svg, bounds.manual);
  fitSvg(layers.auto.svg, bounds.auto);
  fitSvg(layers.focus.svg, bounds.focus);
}

/** Temporary yarn that follows the pointer while connecting. */
export function showTempYarn(fromItem, to) {
  const svg = layers.manual.svg;
  const style = store.board.settings.yarnStyle || 'pinned';
  const p0 = anchorFor(fromItem, to, style);
  const dist = Math.hypot(to.x - p0.x, to.y - p0.y);
  const sag = Math.min(150, dist * 0.18);
  const d = `M${p0.x},${p0.y} Q${(p0.x + to.x) / 2},${(p0.y + to.y) / 2 + sag} ${to.x},${to.y}`;
  tempPath.style.display = '';
  tempPath.style.setProperty('--yarn', store.ui.yarnColor);
  for (const p of tempPath.querySelectorAll('path')) p.setAttribute('d', d);
  // Make sure the SVG viewport includes the temporary string.
  const b = svg._bounds || { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(b.x, p0.x - 200, to.x - 200);
  const minY = Math.min(b.y, p0.y - 200, to.y - 200);
  const maxX = Math.max(b.x + b.w, p0.x + 200, to.x + 200);
  const maxY = Math.max(b.y + b.h, p0.y + 200, to.y + 200 + sag);
  svg.style.left = `${minX}px`;
  svg.style.top = `${minY}px`;
  svg.setAttribute('width', maxX - minX);
  svg.setAttribute('height', maxY - minY);
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
}

export function hideTempYarn() {
  tempPath.style.display = 'none';
  renderYarn();
}

/** Endpoint helper for hit-testing a click near the end of a string. */
export function linkEndpoints(link) {
  const a = getItem(link.from);
  const b = getItem(link.to);
  if (!a || !b) return null;
  const g = geometry(a, b, styleFor(link));
  return { from: g.p0, to: g.p1 };
}
