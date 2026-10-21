// Renderers for every board item type. Each renderer builds the inner DOM once (create) and
// patches it when the item changes (update). User content is only ever set as text.
import { h, icon, formatBytes, uid } from './util.js';
import { renderPreview, LANG_LABEL } from './codeview.js';

export const ROLE_LABEL = {
  manifest: 'MANIFEST', client: 'CLIENT', server: 'SERVER', shared: 'SHARED', config: 'CONFIG', locale: 'LOCALE',
  nui: 'NUI', sql: 'SQL', cfg: 'CFG', meta: 'META', doc: 'DOC', data: 'DATA',
};

export const NOTE_COLORS = ['grey', 'yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green'];

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Turn an element into an inline plain-text editor until it loses focus. */
export function editInline(el, value, commit, { multiline = true, selectAll = false } = {}) {
  el.contentEditable = 'plaintext-only';
  el.textContent = value || '';
  el.classList.remove('placeholder');
  el.classList.add('is-editing');
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    el.contentEditable = 'false';
    el.classList.remove('is-editing');
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    commit(save ? el.innerText.replace(/\n$/, '') : null);
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true);
    }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
  requestAnimationFrame(() => {
    el.focus({ preventScroll: true });
    if (selectAll) document.execCommand('selectAll');
    else placeCaretAtEnd(el);
  });
}

function setText(el, text, placeholder) {
  if (el.classList.contains('is-editing')) return;
  el.textContent = text || placeholder || '';
  el.classList.toggle('placeholder', !text && !!placeholder);
}

// ---------------------------------------------------------------------------------------------

const note = {
  label: 'Note',
  minW: 140,
  minH: 90,
  create() {
    const text = h('div.note-text.scrollable');
    return { body: h('div.note', null, h('div.note-tape'), text), text };
  },
  update(v, item, ctx) {
    v.root.dataset.color = item.color || 'yellow';
    if (ctx.editingId === item.id) {
      if (!v.text.classList.contains('is-editing')) editInline(v.text, item.text, (val) => ctx.actions.commitField(item.id, 'text', val));
    } else setText(v.text, item.text, 'Double-click to write…');
  },
};

const text = {
  label: 'Text',
  minW: 80,
  minH: 30,
  autoHeight: true,
  create() {
    const el = h('div.text-content');
    return { body: h('div.text-item', null, el), text: el };
  },
  update(v, item, ctx) {
    v.root.dataset.size = item.size || 'l';
    v.root.dataset.color = item.color || 'grey';
    if (ctx.editingId === item.id) {
      if (!v.text.classList.contains('is-editing')) editInline(v.text, item.text, (val) => ctx.actions.commitField(item.id, 'text', val));
    } else setText(v.text, item.text, 'Heading');
  },
};

const checklist = {
  label: 'Checklist',
  minW: 200,
  minH: 80,
  autoHeight: true,
  create(item, ctx) {
    const title = h('div.check-title', { 'data-edit': 'title' });
    const progress = h('div.check-progress', null, h('div.check-progress-bar'));
    const list = h('div.check-list');
    const input = h('input.check-add', { type: 'text', placeholder: '+ Add item', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        const cur = ctx.actions.getItem(item.id);
        ctx.actions.commitField(item.id, 'entries', [...(cur.entries || []), { id: uid('c'), text: input.value.trim(), done: false }]);
        input.value = '';
      } else if (e.key === 'Escape') input.blur();
    });
    return { body: h('div.checklist', null, title, progress, list, input), title, list, progress };
  },
  update(v, item, ctx) {
    v.root.dataset.color = item.color || 'grey';
    if (ctx.editingId === item.id) {
      if (!v.title.classList.contains('is-editing')) editInline(v.title, item.title, (val) => ctx.actions.commitField(item.id, 'title', val), { multiline: false });
    } else setText(v.title, item.title, 'Checklist');
    const entries = item.entries || [];
    const done = entries.filter((e) => e.done).length;
    v.progress.firstChild.style.width = entries.length ? `${(done / entries.length) * 100}%` : '0%';
    v.progress.dataset.label = entries.length ? `${done}/${entries.length}` : '';
    v.list.replaceChildren(
      ...entries.map((entry) => {
        const textEl = h('span.check-text', { text: entry.text });
        textEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          editInline(textEl, entry.text, (val) => {
            if (val == null) return;
            const cur = ctx.actions.getItem(item.id);
            const next = val.trim()
              ? cur.entries.map((x) => (x.id === entry.id ? { ...x, text: val.trim() } : x))
              : cur.entries.filter((x) => x.id !== entry.id);
            ctx.actions.commitField(item.id, 'entries', next);
          }, { multiline: false });
        });
        return h(
          'div.check-row',
          { class: entry.done ? 'done' : '' },
          h('button.check-box', {
            'data-action': 'toggle',
            'aria-label': entry.done ? 'Mark as not done' : 'Mark as done',
            onclick: (e) => {
              e.stopPropagation();
              const cur = ctx.actions.getItem(item.id);
              ctx.actions.commitField(item.id, 'entries', cur.entries.map((x) => (x.id === entry.id ? { ...x, done: !x.done } : x)));
            },
          }),
          textEl,
          h('button.check-del', {
            'data-action': 'remove',
            title: 'Remove',
            onclick: (e) => {
              e.stopPropagation();
              const cur = ctx.actions.getItem(item.id);
              ctx.actions.commitField(item.id, 'entries', cur.entries.filter((x) => x.id !== entry.id));
            },
          }, icon('close', 12)),
        );
      }),
    );
  },
};

const image = {
  label: 'Image',
  minW: 60,
  minH: 40,
  keepAspect: true,
  create() {
    const img = h('img', { draggable: 'false', alt: '' });
    const caption = h('div.image-caption');
    return { body: h('div.image-card', null, img, caption), img, caption };
  },
  update(v, item) {
    if (v.img.getAttribute('src') !== item.src) v.img.setAttribute('src', item.src || '');
    v.caption.textContent = item.caption || item.name || '';
    v.caption.hidden = !(item.caption || item.name);
  },
};

const link = {
  label: 'Link',
  minW: 200,
  minH: 64,
  create(item, ctx) {
    const title = h('div.link-title');
    const url = h('div.link-url');
    const open = h('button.btn-icon', {
      'data-action': 'open',
      title: 'Open in browser',
      onclick: (e) => {
        e.stopPropagation();
        ctx.actions.openUrl(ctx.actions.getItem(item.id).url);
      },
    }, icon('external', 14));
    return { body: h('div.link-card', null, h('div.link-icon', null, icon('link', 18)), h('div.link-text', null, title, url), open), title, url };
  },
  update(v, item) {
    let host = item.url || '';
    try {
      host = new URL(item.url).host;
    } catch {
      /* keep raw */
    }
    v.title.textContent = item.title || host || 'Link';
    v.url.textContent = item.url || '';
  },
};

// ---------------------------------------------------------------------------------------------
// Files

function chip(cls, label, title) {
  return h(`span.chip.${cls}`, { title }, label);
}

const file = {
  label: 'File',
  minW: 220,
  minH: 120,
  create(item, ctx) {
    const lang = h('span.lang-badge');
    const name = h('div.file-name');
    const path = h('div.file-path');
    const role = h('span.role-badge');
    const dirty = h('span.dirty-dot', { title: 'Unsaved changes' });
    const warn = h('span.disk-flag');
    const openBtn = h('button.btn-icon', {
      'data-action': 'open',
      title: 'Open in code editor (double-click)',
      onclick: (e) => {
        e.stopPropagation();
        ctx.actions.openEditor(item.id);
      },
    }, icon('code', 14));
    const head = h('div.file-head', null, lang, h('div.file-titles', null, name, path), warn, dirty, role, openBtn);
    const preview = h('pre.code-preview.cm-s-fiveboard');
    const binary = h('div.file-binary');
    const bodyWrap = h('div.file-body.scrollable', null, preview);
    const foot = h('div.file-foot');
    const far = h('div.far-label');
    return { body: h('div.file-card', null, head, bodyWrap, binary, foot, far), lang, name, path, role, dirty, warn, preview, bodyWrap, binary, foot, far };
  },
  update(v, item, ctx) {
    const info = ctx.graph?.files.get(item.id);
    const roleName = info?.role || item.role || 'other';
    v.root.dataset.role = roleName;
    v.lang.textContent = LANG_LABEL[item.lang] || (item.kind === 'binary' ? 'BIN' : 'TXT');
    v.lang.dataset.lang = item.lang || 'text';
    v.name.textContent = item.name;
    v.path.textContent = item.relPath && item.relPath !== item.name ? item.relPath : item.path ? item.path : 'Not saved yet';
    v.path.title = item.path || '';
    v.role.textContent = ROLE_LABEL[roleName] || '';
    v.role.hidden = !ROLE_LABEL[roleName];
    v.role.title = info?.roleSource === 'manifest' ? 'Loaded by fxmanifest' : 'Guessed from the file path';
    v.dirty.hidden = !item.dirty;
    v.warn.hidden = !(item.missing || item.diskChanged);
    v.warn.textContent = item.missing ? 'MISSING' : 'CHANGED ON DISK';
    v.far.textContent = item.name;

    const isBinary = item.kind === 'binary' || item.content == null;
    v.bodyWrap.hidden = isBinary;
    v.binary.hidden = !isBinary;
    if (isBinary) {
      v.binary.replaceChildren(...[
        h('div.binary-icon', null, icon('file', 34)),
        h('div.binary-meta', null, item.omitted ? 'Content skipped (workspace too large)' : 'Binary file', item.size != null ? ` · ${formatBytes(item.size)}` : ''),
        item.path
          ? h('div.binary-actions', null,
              h('button.btn', { 'data-action': 'open', onclick: (e) => { e.stopPropagation(); ctx.actions.openPath(item.path); } }, 'Open'),
              h('button.btn', { 'data-action': 'reveal', onclick: (e) => { e.stopPropagation(); ctx.actions.reveal(item.path); } }, 'Show in Finder'))
          : null,
      ].filter(Boolean));
    } else if (v.renderedContent !== item.content || v.renderedLang !== item.lang) {
      v.needsPreview = true;
      if (v.isVisible) file.visible(v, item, ctx);
    }

    const a = info?.analysis;
    const chips = [];
    if (a) {
      const events = a.handlers.length + a.triggers.length;
      if (events) chips.push(chip('c-event', `⇄ ${events} event${events === 1 ? '' : 's'}`, 'Events handled / triggered'));
      if (a.commands.length) chips.push(chip('c-cmd', a.commands.slice(0, 3).map((c) => `/${c.name}`).join(' ') + (a.commands.length > 3 ? ' …' : ''), 'Commands'));
      const cbs = a.callbacksRegistered.length + a.callbacksTriggered.length;
      if (cbs) chips.push(chip('c-cb', `↺ ${cbs} callback${cbs === 1 ? '' : 's'}`, 'Server callbacks'));
      const nui = a.nuiCallbacks.length + a.nuiMessagesSent.length + a.nuiMessagesHandled.length + a.nuiFetches.length;
      if (nui) chips.push(chip('c-nui', `▣ NUI ${nui}`, 'NUI messages and callbacks'));
      if (a.exportsDefined.length) chips.push(chip('c-export', `⇪ ${a.exportsDefined.length} export${a.exportsDefined.length === 1 ? '' : 's'}`, 'Exports defined'));
      if (a.threads) chips.push(chip('c-thread', `⟳ ${a.threads} thread${a.threads === 1 ? '' : 's'}`, 'CreateThread loops'));
      const warns = a.hints.filter((x) => x.level === 'warn').length;
      const infos = a.hints.length - warns;
      if (warns) chips.push(chip('c-warn', `⚠ ${warns}`, 'Warnings — select the card to see them in the inspector'));
      if (infos) chips.push(chip('c-info', `ⓘ ${infos}`, 'Tips — select the card to see them in the inspector'));
    }
    if (!chips.length && item.size != null) chips.push(chip('c-size', formatBytes(item.size)));
    if (item.truncated) chips.push(chip('c-warn', 'truncated', 'Only the first part of this large file is shown'));
    v.foot.replaceChildren(...chips);
    v.foot.hidden = chips.length === 0;
  },
  visible(v, item, ctx) {
    if (!v.needsPreview || ctx.zoom < 0.42) return;
    v.needsPreview = false;
    v.renderedContent = item.content;
    v.renderedLang = item.lang;
    renderPreview(v.preview, item.content || '', item.lang);
  },
};

const filelist = {
  label: 'Files',
  minW: 200,
  minH: 100,
  create() {
    const title = h('div.filelist-title');
    const list = h('div.filelist-rows.scrollable');
    return { body: h('div.filelist', null, h('div.filelist-head', null, icon('filelist', 14), title), list), title, list };
  },
  update(v, item, ctx) {
    const entries = item.entries || [];
    const total = entries.reduce((s, e) => s + (e.size || 0), 0);
    v.title.textContent = `${item.title || 'Files'} · ${entries.length} file${entries.length === 1 ? '' : 's'} · ${formatBytes(total)}`;
    v.list.replaceChildren(
      ...entries.slice(0, 400).map((e) =>
        h('div.filelist-row', {
          title: e.path ? 'Click to show in Finder' : '',
          onclick: (ev) => {
            if (e.path && !ev.shiftKey && !ev.metaKey) ctx.actions.reveal(e.path);
          },
        }, h('span.filelist-ext', null, (e.name.split('.').pop() || '').toUpperCase().slice(0, 4)), h('span.filelist-name', null, e.name), h('span.filelist-size', null, formatBytes(e.size))),
      ),
      ...(entries.length > 400 ? [h('div.filelist-row.more', null, `… and ${entries.length - 400} more`)] : []),
    );
  },
};

function kv(label, value) {
  return h('div.kv', null, h('span.kv-k', null, label), h('span.kv-v', null, value));
}

const resource = {
  label: 'Resource',
  minW: 260,
  minH: 120,
  autoHeight: true,
  create() {
    const name = h('div.res-name');
    const sub = h('div.res-sub');
    const content = h('div.res-content');
    return { body: h('div.resource-card', null, h('div.res-head', null, h('div.res-icon', null, icon('resource', 20)), h('div', null, name, sub)), content), name, sub, content };
  },
  update(v, item, ctx) {
    const res = ctx.graph?.resources.get(item.resourceId);
    v.name.textContent = item.title || res?.name || 'Resource';
    const m = res?.manifest;
    v.sub.textContent = m ? (m.meta.description || 'FiveM resource') : res ? 'No fxmanifest.lua found' : 'Analyzing…';
    if (!res) {
      v.content.replaceChildren();
      return;
    }
    const rows = [];
    if (m) {
      rows.push(h('div.kv-grid', null,
        kv('fx_version', m.fxVersion || '—'),
        kv('game', m.games.join(', ') || '—'),
        kv('lua54', m.lua54 ? 'yes' : 'no'),
        kv('version', m.meta.version || '—'),
      ));
    }
    rows.push(h('div.res-scripts', null,
      h('span.pill.role-client', null, `${res.scripts.client.length} client`),
      h('span.pill.role-server', null, `${res.scripts.server.length} server`),
      h('span.pill.role-shared', null, `${res.scripts.shared.length} shared`),
      res.nui ? h('span.pill.role-nui', null, 'NUI') : null,
      res.escrow ? h('span.pill', null, 'escrow') : null,
    ));
    if (res.frameworks.length) rows.push(h('div.res-row', null, h('span.res-label', null, 'Uses'), ...res.frameworks.map((f) => h('span.tag', null, f))));
    if (res.dependencies.length) rows.push(h('div.res-row', null, h('span.res-label', null, 'Needs'), ...res.dependencies.slice(0, 8).map((d) => h('span.tag.dep', null, d))));
    if (res.commands.length) {
      rows.push(h('div.res-row', null, h('span.res-label', null, 'Commands'), ...res.commands.slice(0, 10).map((c) => h('span.tag.cmd', null, `/${c.name}`))));
    }
    if (res.keymaps.length) rows.push(h('div.res-row', null, h('span.res-label', null, 'Keys'), ...res.keymaps.slice(0, 6).map((k) => h('span.tag', null, `${k.key} → ${k.command}`))));
    rows.push(h('div.res-stats', null,
      `${res.events.handled} handlers · ${res.events.triggered} triggers · ${res.callbacks} callbacks · ${res.exports.length} exports`,
    ));
    const warns = res.hints.filter((x) => x.level === 'warn');
    const fileWarns = [...(ctx.graph?.files.values() || [])].filter((f) => f.resourceId === item.resourceId).reduce((n, f) => n + f.analysis.hints.filter((x) => x.level === 'warn').length, 0);
    const total = warns.length + fileWarns;
    rows.push(total
      ? h('div.res-warn', null, icon('warn', 13), `${total} warning${total === 1 ? '' : 's'} — select to review`)
      : h('div.res-ok', null, '✓ No problems found'));
    v.content.replaceChildren(...rows);
  },
};

const frame = {
  label: 'Frame',
  minW: 160,
  minH: 100,
  create(item, ctx) {
    const title = h('span.frame-title');
    const sub = h('span.frame-sub');
    const badge = h('span.frame-badge');
    const exportBtn = h('button.btn.frame-export', {
      'data-action': 'export',
      title: 'Write these files to a folder on disk',
      onclick: (e) => {
        e.stopPropagation();
        ctx.actions.exportFrame(item.id);
      },
    }, icon('export', 12), 'Export to folder…');
    const header = h('div.frame-header', { 'data-role': 'frame-header' }, h('span.frame-icon'), title, badge, sub, exportBtn);
    return { body: header, title, sub, badge, header, exportBtn };
  },
  update(v, item) {
    v.root.dataset.kind = item.kind || 'group';
    v.root.dataset.color = item.color || 'grey';
    v.header.querySelector('.frame-icon').replaceChildren(icon(item.kind === 'resource' ? 'resource' : item.kind === 'group' ? 'frame' : 'folder', 14));
    if (!v.title.classList.contains('is-editing')) v.title.textContent = item.title || 'Frame';
    v.sub.textContent = item.subtitle || '';
    const badge = { resource: 'RESOURCE', category: 'CATEGORY', workspace: 'WORKSPACE' }[item.kind] || '';
    v.badge.textContent = badge;
    v.badge.hidden = !badge;
    v.exportBtn.hidden = !item.scaffold;
  },
};

export const RENDERERS = { note, text, checklist, image, link, file, filelist, resource, frame };
