// Floating inspector: details and actions for the current selection, FiveM insights for files
// and resources, and a problems list for the whole board when nothing is selected.
import { store, subscribe, getItem, getLink, checkpoint, updateItem, updateItems, updateLink, removeLinks, setSelection } from '../store.js';
import { h, icon, formatBytes, rectContains, boundsOf } from '../util.js';
import { ROLE_LABEL } from '../items.js';
import { LINK_KINDS, KIND_TITLES, YARN_COLORS, linkColor, kindGroup } from '../yarn.js';
import { classifyEvent } from '../fivem/analyzer.js';

let root = null;
let body = null;
let hooks = {};
let frame = null;

const NOTE_SWATCH = {
  grey: '#5b5e66', yellow: '#e9c46a', orange: '#f08c4a', red: '#e5484d', pink: '#e86fa8', purple: '#9b7bea',
  blue: '#4c8df6', teal: '#2bb3a3', green: '#4caf6e',
};

export function initInspector(el, appHooks) {
  root = el;
  hooks = appHooks;
  const title = h('div.insp-title');
  const collapse = h('button.btn-icon', { title: 'Hide inspector (⌘I)', onclick: () => hooks.toggle(false) }, icon('close', 13));
  body = h('div.insp-body');
  root.append(h('div.insp-head', null, title, collapse), body);
  root._title = title;
  subscribe((changes) => {
    if (['selection', 'items', 'analysis', 'links', 'board'].some((k) => changes.has(k))) schedule();
  });
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    render();
  });
}

function section(title, ...children) {
  const kids = children.flat().filter(Boolean);
  if (!kids.length) return null;
  return h('section.insp-section', null, h('div.insp-section-title', null, title), ...kids);
}

function row(label, value) {
  return h('div.insp-row', null, h('span.insp-k', null, label), h('span.insp-v', null, value));
}

function lineLink(fileId, line, text, extra) {
  return h('button.insp-line', {
    title: line ? `Open at line ${line}` : 'Open',
    onclick: () => hooks.openEditor(fileId, line),
  }, h('span.insp-line-text', null, text), extra || null, line ? h('span.insp-line-no', null, `:${line}`) : null);
}

function swatches(current, colors, onPick) {
  return h('div.swatches', null, ...colors.map(([key, color]) =>
    h('button.swatch', { class: key === current ? 'active' : '', title: key, style: { '--swatch': color }, onclick: () => onPick(key) }),
  ));
}

function fileName(id) {
  return getItem(id)?.name || '?';
}

function render() {
  if (!store.board) return;
  const sel = [...store.selection].map(getItem).filter(Boolean);
  let title = 'Board';
  let content;
  if (store.selectedLink) {
    const link = getLink(store.selectedLink);
    if (link) {
      title = link.auto ? 'Detected connection' : 'Yarn';
      content = renderLink(link);
    }
  }
  if (!content) {
    if (sel.length === 0) content = renderOverview();
    else if (sel.length > 1) {
      title = `${sel.length} selected`;
      content = renderMulti(sel);
    } else {
      const item = sel[0];
      title = { note: 'Sticky note', text: 'Text', checklist: 'Checklist', image: 'Image', link: 'Link', file: 'File', filelist: 'Files', resource: 'FiveM resource', frame: 'Frame' }[item.type] || 'Item';
      content = renderItem(item);
    }
  }
  root._title.textContent = title;
  const scroll = body.scrollTop;
  body.replaceChildren(...[content].flat().filter(Boolean));
  body.scrollTop = scroll;
}

// ---------------------------------------------------------------------------------------------

function renderOverview() {
  const items = store.board.items;
  const files = items.filter((i) => i.type === 'file');
  const g = store.graph;
  const out = [];
  out.push(h('div.insp-stats', null,
    h('div.stat', null, h('b', null, String(items.filter((i) => i.type !== 'frame').length)), h('span', null, 'cards')),
    h('div.stat', null, h('b', null, String(files.length)), h('span', null, 'files')),
    h('div.stat', null, h('b', null, String(g?.resources.size || 0)), h('span', null, 'resources')),
    h('div.stat', null, h('b', null, String(store.board.links.length + store.autoLinks.length)), h('span', null, 'yarn')),
  ));
  if (g && g.problems.length) {
    const warns = g.problems.filter((p) => p.level === 'warn');
    const infos = g.problems.filter((p) => p.level !== 'warn');
    const renderProblem = (p) =>
      h('button.problem', {
        class: p.level,
        onclick: () => (p.fileId ? hooks.openEditor(p.fileId, p.line) : null),
      }, icon(p.level === 'warn' ? 'warn' : 'info', 13), h('span.problem-text', null, h('span', null, p.message), h('span.problem-file', null, p.fileId ? `${fileName(p.fileId)}${p.line ? `:${p.line}` : ''}` : '')));
    out.push(section(`Problems · ${warns.length} warning${warns.length === 1 ? '' : 's'}`, warns.slice(0, 60).map(renderProblem), warns.length ? null : h('p.muted', null, 'No warnings 🎉')));
    if (infos.length) out.push(section(`Tips · ${infos.length}`, infos.slice(0, 40).map(renderProblem)));
  } else if (files.length === 0) {
    out.push(h('div.insp-empty', null,
      h('p', null, 'Drop a FiveM resource folder (or your whole resources folder) onto the board to map it out.'),
      h('p.muted', null, 'Every folder becomes a frame, every file a card, and the yarn shows how manifests, events, callbacks, NUI and exports connect.'),
      h('div.insp-actions', null,
        h('button.btn.btn-primary', { onclick: () => hooks.command('workspace:import') }, icon('folder', 13), 'Import folder…'),
        h('button.btn', { onclick: () => hooks.command('fivem:scaffold') }, icon('resource', 13), 'New resource…'),
      ),
    ));
  }
  out.push(section('Yarn legend', h('div.legend', null, ...Object.entries(LINK_KINDS).map(([k, v]) => h('div.legend-row', null, h('span.legend-dot', { style: { background: v.color } }), v.label, k === 'manual' ? h('span.muted', null, ' — drag a card’s pin') : null)))));
  return out;
}

function renderMulti(sel) {
  const nonFrames = sel.filter((i) => i.type !== 'frame');
  return [
    h('div.insp-actions.vertical', null,
      h('button.btn', { onclick: () => hooks.command('items:group') }, icon('frame', 13), 'Group in frame  ⌘G'),
      h('button.btn', { onclick: () => hooks.command('items:connect') }, icon('yarn', 13), 'Connect in order  ⌘L'),
      h('button.btn', { onclick: () => hooks.command('items:arrange') }, icon('fit', 13), 'Arrange in a grid'),
      h('button.btn', { onclick: () => align(nonFrames, 'left') }, 'Align left'),
      h('button.btn', { onclick: () => align(nonFrames, 'top') }, 'Align top'),
      h('button.btn.danger', { onclick: () => hooks.command('items:delete') }, icon('trash', 13), 'Delete'),
    ),
    nonFrames.some((i) => i.type === 'note')
      ? section('Note color', swatches(null, Object.entries(NOTE_SWATCH), (c) => {
          checkpoint();
          updateItems(nonFrames.filter((i) => i.type === 'note').map((i) => [i.id, { color: c }]));
        }))
      : null,
  ];
}

function align(items, edge) {
  if (items.length < 2) return;
  const b = boundsOf(items);
  checkpoint();
  updateItems(items.map((i) => [i.id, edge === 'left' ? { x: b.x } : { y: b.y }]));
}

function renderLink(link) {
  const from = getItem(link.from);
  const to = getItem(link.to);
  const ends = section('Connects',
    h('button.insp-line', { onclick: () => hooks.locate(link.from) }, h('span.insp-line-text', null, from?.name || from?.title || from?.text?.slice(0, 40) || from?.type || '?')),
    h('div.insp-arrow', null, link.auto ? '↓' : '↕'),
    h('button.insp-line', { onclick: () => hooks.locate(link.to) }, h('span.insp-line-text', null, to?.name || to?.title || to?.text?.slice(0, 40) || to?.type || '?')),
  );
  if (link.auto) {
    return [
      h('div.insp-kind', null, h('span.legend-dot', { style: { background: linkColor(link) } }), KIND_TITLES[link.kind] || link.kind),
      ends,
      link.names?.length ? section(kindGroup(link.kind) === 'manifest' ? 'Via' : 'Names', link.names.map((n) => h('button.insp-line', { onclick: () => hooks.search(n) }, h('span.insp-line-text.mono', null, n)))) : null,
      h('p.muted', null, 'Detected automatically from your code. Hide this kind of yarn from the sidebar.'),
    ];
  }
  const label = h('input.insp-input', { type: 'text', placeholder: 'Label (e.g. "triggers", "depends on")', value: link.label || '' });
  label.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') label.blur();
  });
  label.addEventListener('change', () => {
    checkpoint();
    updateLink(link.id, { label: label.value });
  });
  return [
    section('Color', h('div.swatches', null, ...YARN_COLORS.map((c) =>
      h('button.swatch', { class: (link.color || YARN_COLORS[0]) === c ? 'active' : '', style: { '--swatch': c }, onclick: () => { checkpoint(); updateLink(link.id, { color: c }); } }),
    ))),
    section('Label', label),
    section('Style', h('div.segmented', null,
      h('button', { class: link.style !== 'dashed' ? 'active' : '', onclick: () => { checkpoint(); updateLink(link.id, { style: 'solid' }); } }, 'Solid'),
      h('button', { class: link.style === 'dashed' ? 'active' : '', onclick: () => { checkpoint(); updateLink(link.id, { style: 'dashed' }); } }, 'Dashed'),
      h('button', { class: link.arrow ? 'active' : '', onclick: () => { checkpoint(); updateLink(link.id, { arrow: !link.arrow }); } }, 'Arrow'),
    )),
    ends,
    h('div.insp-actions', null,
      h('button.btn', { onclick: () => { checkpoint(); updateLink(link.id, { from: link.to, to: link.from }); } }, 'Reverse'),
      h('button.btn.danger', { onclick: () => { checkpoint(); removeLinks([link.id]); } }, icon('trash', 13), 'Remove yarn'),
    ),
  ];
}

function renderItem(item) {
  switch (item.type) {
    case 'note':
      return [
        section('Color', swatches(item.color || 'yellow', Object.entries(NOTE_SWATCH), (c) => { checkpoint(); updateItem(item.id, { color: c }); })),
        h('p.muted', null, 'Double-click to edit · drag the pin to connect yarn'),
      ];
    case 'text':
      return [
        section('Size', h('div.segmented', null, ...['s', 'm', 'l', 'xl'].map((s) => h('button', { class: (item.size || 'l') === s ? 'active' : '', onclick: () => { checkpoint(); updateItem(item.id, { size: s }); } }, s.toUpperCase())))),
        section('Color', swatches(item.color || 'grey', Object.entries(NOTE_SWATCH), (c) => { checkpoint(); updateItem(item.id, { color: c }); })),
      ];
    case 'checklist': {
      const entries = item.entries || [];
      return [
        row('Progress', `${entries.filter((e) => e.done).length} of ${entries.length} done`),
        section('Accent', swatches(item.color || 'grey', Object.entries(NOTE_SWATCH), (c) => { checkpoint(); updateItem(item.id, { color: c }); })),
        h('div.insp-actions', null, h('button.btn', { onclick: () => { checkpoint(); updateItem(item.id, { entries: entries.filter((e) => !e.done) }); } }, 'Clear completed')),
      ];
    }
    case 'image':
      return [
        item.name ? row('Name', item.name) : null,
        item.path ? row('Path', item.path) : null,
        h('div.insp-actions', null,
          item.path ? h('button.btn', { onclick: () => window.api.shell.reveal(item.path) }, icon('reveal', 13), 'Show in Finder') : null,
          h('button.btn', { onclick: () => hooks.resetImage(item.id) }, 'Original ratio'),
        ),
      ];
    case 'link': {
      const url = h('input.insp-input', { type: 'text', value: item.url || '', placeholder: 'https://…' });
      const title = h('input.insp-input', { type: 'text', value: item.title || '', placeholder: 'Title' });
      for (const [inp, key] of [[url, 'url'], [title, 'title']]) {
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('change', () => { checkpoint(); updateItem(item.id, { [key]: inp.value.trim() }); });
      }
      return [section('URL', url), section('Title', title), h('div.insp-actions', null, h('button.btn', { onclick: () => hooks.openUrl(item.url) }, icon('external', 13), 'Open'))];
    }
    case 'frame':
      return renderFrame(item);
    case 'filelist':
      return [row('Folder', item.relPath || item.title), row('Files', String(item.entries?.length || 0)), h('p.muted', null, 'Binary assets (streamed models, textures, audio…) are listed here instead of getting their own cards. Click one to show it in Finder.')];
    case 'resource':
      return renderResource(item);
    case 'file':
      return renderFile(item);
    default:
      return null;
  }
}

function renderFrame(item) {
  const inside = store.board.items.filter((i) => i.id !== item.id && rectContains(item, i));
  const title = h('input.insp-input', { type: 'text', value: item.title || '' });
  title.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') title.blur();
  });
  title.addEventListener('change', () => { checkpoint(); updateItem(item.id, { title: title.value.trim() || 'Frame' }); });
  return [
    section('Title', title),
    item.subtitle ? row('Path', item.subtitle) : null,
    row('Contains', `${inside.filter((i) => i.type !== 'frame').length} cards`),
    section('Color', swatches(item.color || 'grey', Object.entries(NOTE_SWATCH), (c) => { checkpoint(); updateItem(item.id, { color: c }); })),
    h('div.insp-actions.vertical', null,
      item.scaffold ? h('button.btn.btn-primary', { onclick: () => hooks.exportFrame(item.id) }, icon('export', 13), 'Export resource to folder…') : null,
      h('button.btn', { onclick: () => setSelection(inside.filter((i) => i.type !== 'frame').map((i) => i.id)) }, 'Select contents'),
      h('button.btn', { onclick: () => hooks.fitFrame(item.id) }, 'Fit frame to contents'),
      item.workspaceId ? h('button.btn', { onclick: () => hooks.command('workspace:rescan', item.workspaceId) }, icon('refresh', 13), 'Rescan from disk') : null,
    ),
  ];
}

function renderResource(item) {
  const res = store.graph?.resources.get(item.resourceId);
  if (!res) return h('p.muted', null, 'Analyzing…');
  const m = res.manifest;
  const fileHints = [...store.graph.files.values()].filter((f) => f.resourceId === res.id).flatMap((f) => f.analysis.hints.map((x) => ({ ...x, fileId: f.id })));
  const allHints = [...res.hints, ...fileHints].sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));
  return [
    m ? section('Manifest',
      row('fx_version', m.fxVersion || '—'),
      row('game', m.games.join(', ') || '—'),
      row('lua54', m.lua54 ? 'yes' : 'no'),
      m.meta.author ? row('author', m.meta.author) : null,
      m.meta.version ? row('version', m.meta.version) : null,
      m.uiPage ? row('ui_page', m.uiPage) : null,
      m.dataFiles.length ? row('data_file', `${m.dataFiles.length} entries`) : null,
      res.manifestFileId ? h('button.btn.btn-small', { onclick: () => hooks.openEditor(res.manifestFileId) }, 'Open fxmanifest.lua') : null,
    ) : h('p.muted', null, 'No fxmanifest.lua in this folder.'),
    section('Scripts',
      ...['client', 'server', 'shared'].map((side) => (res.scripts[side].length
        ? h('div.insp-group', null, h('span.role-badge', { 'data-role': side }, side.toUpperCase()), ...res.scripts[side].map((id) => lineLink(id, null, fileName(id))))
        : null)),
    ),
    res.frameworks.length ? section('Frameworks & libraries', h('div.tags', null, ...res.frameworks.map((f) => h('span.tag', null, f)))) : null,
    res.dependencies.length ? section('Dependencies', h('div.tags', null, ...res.dependencies.map((d) => h('span.tag.dep', null, d)))) : null,
    res.commands.length ? section('Commands', res.commands.map((c) => lineLink(c.fileId, c.line, `/${c.name}`, h('span.insp-via', null, c.via !== 'native' ? c.via : '')))) : null,
    res.keymaps.length ? section('Key mappings', res.keymaps.map((k) => lineLink(k.fileId, k.line, `${k.key} → ${k.command}`, h('span.insp-via', null, k.description)))) : null,
    res.exports.length ? section('Exports', h('div.tags', null, ...res.exports.map((e) => h('span.tag.mono', null, e)))) : null,
    section(`Problems & tips · ${allHints.length}`, allHints.length
      ? allHints.map((x) => h('button.problem', { class: x.level, onclick: () => x.fileId && hooks.openEditor(x.fileId, x.line) }, icon(x.level === 'warn' ? 'warn' : 'info', 13), h('span.problem-text', null, h('span', null, x.message), h('span.problem-file', null, x.fileId ? `${fileName(x.fileId)}${x.line ? `:${x.line}` : ''}` : ''))))
      : h('p.muted', null, 'Nothing to report.')),
  ];
}

function eventPeers(name, fileId, want) {
  const ev = store.graph?.events.get(name);
  if (!ev) return [];
  const list = want === 'handlers' ? ev.handlers : ev.triggers;
  return [...new Set(list.filter((x) => x.fileId !== fileId).map((x) => x.fileId))];
}

function renderFile(item) {
  const info = store.graph?.files.get(item.id);
  const a = info?.analysis;
  const out = [];
  out.push(h('div.insp-file', null,
    h('div.insp-file-name', null, item.name),
    h('div.insp-file-path', null, item.path || 'Not saved to disk yet'),
    h('div.insp-file-meta', null,
      info && ROLE_LABEL[info.role] ? h('span.role-badge', { 'data-role': info.role }, ROLE_LABEL[info.role]) : null,
      info ? h('span.muted', null, info.roleSource === 'manifest' ? 'loaded by fxmanifest' : 'role guessed from path') : null,
      item.size != null ? h('span.muted', null, formatBytes(item.size)) : null,
    ),
  ));
  out.push(h('div.insp-actions', null,
    item.kind !== 'binary' ? h('button.btn.btn-primary', { onclick: () => hooks.openEditor(item.id) }, icon('code', 13), 'Edit') : null,
    item.path ? h('button.btn', { onclick: () => window.api.shell.reveal(item.path) }, icon('reveal', 13), 'Finder') : null,
    item.path ? h('button.btn', { onclick: () => window.api.shell.openExternal(`vscode://file${encodeURI(item.path)}`) }, 'VS Code') : null,
    item.path ? h('button.btn', { onclick: () => hooks.reloadFile(item.id) }, icon('refresh', 13), 'Reload') : null,
  ));
  if (!a) return out;

  if (a.hints.length) {
    out.push(section(`Problems & tips · ${a.hints.length}`, a.hints.map((x) => h('button.problem', { class: x.level, onclick: () => hooks.openEditor(item.id, x.line) }, icon(x.level === 'warn' ? 'warn' : 'info', 13), h('span.problem-text', null, h('span', null, x.message), x.line ? h('span.problem-file', null, `line ${x.line}`) : null)))));
  }

  const evRow = (e, mode) => {
    const peers = eventPeers(e.name, item.id, mode === 'handler' ? 'triggers' : 'handlers');
    const cls = classifyEvent(e.name);
    const kindLabel = mode === 'trigger' ? { c2s: '→ server', s2c: '→ client', local: 'local' }[e.kind] : e.kind === 'net' ? 'net' : 'local';
    return h('div.insp-event', null,
      lineLink(item.id, e.line, e.name, h('span.insp-via', null, kindLabel)),
      peers.length
        ? h('div.insp-peers', null, ...peers.slice(0, 6).map((pid) => h('button.peer', { onclick: () => hooks.locate(pid), title: 'Show on board' }, mode === 'handler' ? '← ' : '→ ', fileName(pid))))
        : cls !== 'custom'
          ? h('div.insp-peers.muted', null, cls === 'builtin' ? 'built-in FiveM event' : 'framework / other resource')
          : null,
    );
  };
  out.push(section('Events handled', a.handlers.map((e) => evRow(e, 'handler'))));
  out.push(section('Events triggered', a.triggers.map((e) => evRow(e, 'trigger'))));
  out.push(section('Callbacks', [
    ...a.callbacksRegistered.map((c) => lineLink(item.id, c.line, c.name, h('span.insp-via', null, `${c.fw} register`))),
    ...a.callbacksTriggered.map((c) => lineLink(item.id, c.line, c.name, h('span.insp-via', null, `${c.fw} call`))),
  ]));
  out.push(section('Commands', a.commands.map((c) => lineLink(item.id, c.line, `/${c.name}`, h('span.insp-via', null, c.via !== 'native' ? c.via : '')))));
  out.push(section('Key mappings', a.keymaps.map((k) => lineLink(item.id, k.line, `${k.key} → ${k.command}`, h('span.insp-via', null, k.description)))));
  out.push(section('NUI', [
    ...a.nuiMessagesSent.filter((m) => m.name).map((m) => lineLink(item.id, m.line, m.name, h('span.insp-via', null, 'SendNUIMessage'))),
    ...a.nuiCallbacks.map((m) => lineLink(item.id, m.line, m.name, h('span.insp-via', null, 'NUI callback'))),
    ...a.nuiMessagesHandled.map((m) => lineLink(item.id, m.line, m.name, h('span.insp-via', null, 'handles message'))),
    ...a.nuiFetches.map((m) => lineLink(item.id, m.line, m.name, h('span.insp-via', null, 'fetch → Lua'))),
  ]));
  out.push(section('Exports', [
    ...a.exportsDefined.map((e) => lineLink(item.id, e.line, e.name, h('span.insp-via', null, 'defines'))),
    ...a.exportsUsed.map((e) => lineLink(item.id, e.line, `${e.resource}:${e.fn}`, h('span.insp-via', null, 'uses'))),
  ]));
  if (a.threads) out.push(row('Threads', `${a.threads} CreateThread`));
  out.push(section('Outline', a.functions.slice(0, 80).map((f) => lineLink(item.id, f.line, `${f.name}()`))));
  if (a.natives.length) {
    out.push(section(`Natives & API used · ${a.natives.length}`, h('div.tags', null, ...a.natives.slice(0, 40).map((n) => h('span.tag.mono', { title: `${n.count}×` }, n.count > 1 ? `${n.name} ×${n.count}` : n.name)))));
  }
  if (a.frameworks.length) out.push(section('Frameworks', h('div.tags', null, ...a.frameworks.map((f) => h('span.tag', null, f)))));
  return out;
}
