// Constructors for new board items.
import { uid } from './util.js';
import { detectLanguage } from './fivem/analyzer.js';

export const FILE_W = 470;
export const FILE_H = 330;

export function makeNote(at, props = {}) {
  return { id: uid('n'), type: 'note', x: Math.round(at.x - 110), y: Math.round(at.y - 75), w: 220, h: 160, text: '', color: 'yellow', ...props };
}

export function makeText(at, props = {}) {
  return { id: uid('t'), type: 'text', x: Math.round(at.x - 160), y: Math.round(at.y - 24), w: 320, h: 48, text: '', size: 'l', ...props };
}

export function makeChecklist(at, props = {}) {
  return { id: uid('k'), type: 'checklist', x: Math.round(at.x - 130), y: Math.round(at.y - 70), w: 260, h: 140, title: '', entries: [], ...props };
}

export function makeFrame(rect, props = {}) {
  return { id: uid('f'), type: 'frame', kind: 'group', title: 'Frame', color: 'grey', x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h), ...props };
}

export function makeLink(at, url, title = '') {
  return { id: uid('u'), type: 'link', x: Math.round(at.x - 140), y: Math.round(at.y - 36), w: 280, h: 72, url, title };
}

export function makeImage(at, src, props = {}) {
  return { id: uid('i'), type: 'image', x: Math.round(at.x - 150), y: Math.round(at.y - 110), w: 300, h: 220, src, fit: true, ...props };
}

/** Build a file card from a scanner descriptor ({ name, path, content, kind, size, ... }). */
export function makeFile(at, desc, props = {}) {
  const lang = detectLanguage(desc.name);
  const binary = desc.kind === 'binary' || desc.content == null;
  return {
    id: uid('file'),
    type: 'file',
    x: Math.round(at.x),
    y: Math.round(at.y),
    w: binary ? 280 : FILE_W,
    h: binary ? 180 : FILE_H,
    name: desc.name,
    path: desc.path || null,
    relPath: desc.relPath || desc.name,
    lang,
    kind: binary ? 'binary' : 'text',
    content: binary ? null : desc.content,
    size: desc.size ?? (desc.content ? desc.content.length : 0),
    mtimeMs: desc.mtimeMs || null,
    truncated: !!desc.truncated,
    omitted: !!desc.omitted,
    dirty: false,
    ...props,
  };
}

/** Fit an image's natural size into a max box. */
export function fitSize(nw, nh, maxW = 420, maxH = 320) {
  const s = Math.min(1, maxW / nw, maxH / nh);
  return { w: Math.max(40, Math.round(nw * s)), h: Math.max(30, Math.round(nh * s)) };
}
