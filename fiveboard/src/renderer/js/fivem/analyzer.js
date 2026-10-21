// FiveM static analysis: manifest parsing, script inspection and the board-wide relationship graph.
// Pure functions only (no DOM), so this module also runs under `node --test`.

const LANG_BY_EXT = {
  lua: 'lua', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', html: 'html', htm: 'html', vue: 'html', svelte: 'html', css: 'css', scss: 'scss',
  sass: 'scss', less: 'less', xml: 'xml', meta: 'xml', ymt: 'xml', md: 'markdown', markdown: 'markdown',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'shell', bash: 'shell', zsh: 'shell', ini: 'properties',
  properties: 'properties', env: 'properties', cs: 'csharp', py: 'python', cfg: 'cfg', txt: 'text', log: 'text',
  csv: 'text', bat: 'shell', cmd: 'shell', ps1: 'shell',
};

export function extOf(name) {
  const base = String(name || '').toLowerCase().split('/').pop();
  const i = base.lastIndexOf('.');
  if (i === 0) return base.slice(1);
  return i > 0 ? base.slice(i + 1) : '';
}

export function detectLanguage(name) {
  const base = String(name || '').toLowerCase().split('/').pop();
  if (base === 'server.cfg' || base.endsWith('.cfg')) return 'cfg';
  if (base === 'dockerfile' || base === 'makefile') return 'shell';
  return LANG_BY_EXT[extOf(base)] || 'text';
}

export function isManifestName(name) {
  const base = String(name || '').toLowerCase().split('/').pop();
  return base === 'fxmanifest.lua' || base === '__resource.lua';
}

const isJsLike = (lang) => lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'tsx';

// ---------------------------------------------------------------------------------------------
// Source helpers

function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/** Replace Lua comments with spaces (keeping newlines so line numbers stay correct). */
export function stripLuaComments(src, { blankStrings = false } = {}) {
  const parts = [];
  const n = src.length;
  let i = 0;
  let last = 0;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const m = /^\[(=*)\[/.exec(src.slice(i + 2, i + 260));
      let end;
      if (m) {
        const close = `]${m[1]}]`;
        const j = src.indexOf(close, i + 2 + m[0].length);
        end = j < 0 ? n : j + close.length;
      } else {
        const j = src.indexOf('\n', i);
        end = j < 0 ? n : j;
      }
      parts.push(src.slice(last, i), blank(src.slice(i, end)));
      last = i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (blankStrings) {
        parts.push(src.slice(last, i + 1), blank(src.slice(i + 1, Math.min(j, n))));
        last = Math.min(j, n);
      }
      i = j + 1;
      continue;
    }
    if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 260));
      if (m) {
        const close = `]${m[1]}]`;
        const j = src.indexOf(close, i + m[0].length);
        const end = j < 0 ? n : j + close.length;
        if (blankStrings) {
          parts.push(src.slice(last, i), blank(src.slice(i, end)));
          last = end;
        }
        i = end;
        continue;
      }
    }
    i++;
  }
  parts.push(src.slice(last));
  return parts.join('');
}

/** Replace JS/TS comments with spaces. Strings, template literals and regex literals are skipped. */
export function stripJsComments(src) {
  const parts = [];
  const n = src.length;
  let i = 0;
  let last = 0;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      parts.push(src.slice(last, i), blank(src.slice(i, end)));
      last = i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      parts.push(src.slice(last, i), blank(src.slice(i, end)));
      last = i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      prevSignificant = c;
      continue;
    }
    if (c === '/' && (prevSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSignificant))) {
      // Regex literal.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      prevSignificant = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  parts.push(src.slice(last));
  return parts.join('');
}

function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, blank);
}

function makeLineLookup(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function readQuoted(src, pos) {
  const q = src[pos];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let j = pos + 1;
  let out = '';
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\n' && q !== '`') return null;
    if (src[j] === '\\') {
      out += src[j + 1] ?? '';
      j += 2;
      continue;
    }
    out += src[j];
    j++;
  }
  if (j >= src.length) return null;
  return { value: out, end: j + 1, quote: q };
}

const RESOURCE_TOKEN = '${resource}';

/**
 * Read an event/command name argument starting at `pos`. Understands plain strings plus the
 * common `GetCurrentResourceName() .. ':event'` style used to namespace events.
 */
function readNameArg(src, pos, lang) {
  let i = pos;
  while (i < src.length && /\s/.test(src[i])) i++;
  const direct = readQuoted(src, i);
  if (direct) {
    if (direct.quote === '`') {
      const tpl = direct.value.replace(/\$\{\s*(?:GetCurrentResourceName|GetParentResourceName)\(\)\s*\}/g, RESOURCE_TOKEN);
      if (/\$\{(?!resource\})/.test(tpl)) return null;
      return { name: tpl, dynamic: tpl.includes(RESOURCE_TOKEN) };
    }
    return { name: direct.value, dynamic: false };
  }
  const rest = src.slice(i, i + 200);
  const concat = lang === 'lua' ? /^(?:GetCurrentResourceName\(\)|cache\.resource)\s*\.\.\s*/ : /^(?:GetCurrentResourceName\(\)|GetParentResourceName\(\))\s*\+\s*/;
  const m = concat.exec(rest);
  if (m) {
    const tail = readQuoted(src, i + m[0].length);
    if (tail) return { name: RESOURCE_TOKEN + tail.value, dynamic: true };
  }
  return null;
}

function callRegex(callee) {
  return new RegExp(String.raw`(?<![\w.:$])(?:${callee})\s*\(`, 'g');
}

function* findCalls(src, callee, lang) {
  const re = callRegex(callee);
  let m;
  while ((m = re.exec(src))) {
    const arg = readNameArg(src, m.index + m[0].length, lang);
    yield { index: m.index, end: m.index + m[0].length, arg };
  }
}

function resolveName(name, resourceName) {
  if (!name.includes(RESOURCE_TOKEN)) return name;
  return name.split(RESOURCE_TOKEN).join(resourceName || '<resource>');
}

// ---------------------------------------------------------------------------------------------
// Manifest parsing

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil',
  'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

export function tokenizeLua(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const countLines = (from, to) => {
    let c = 0;
    for (let k = from; k < to; k++) if (src.charCodeAt(k) === 10) c++;
    return c;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      const m = /^\[(=*)\[/.exec(src.slice(i + 2, i + 260));
      let end;
      if (m) {
        const close = `]${m[1]}]`;
        const j = src.indexOf(close, i + 2);
        end = j < 0 ? n : j + close.length;
      } else {
        const j = src.indexOf('\n', i);
        end = j < 0 ? n : j;
      }
      line += countLines(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let val = '';
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\' && j + 1 < n) {
          val += src[j + 1];
          j += 2;
          continue;
        }
        val += src[j];
        j++;
      }
      tokens.push({ t: 'str', v: val, line });
      i = j + 1;
      continue;
    }
    if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 260));
      if (m) {
        const close = `]${m[1]}]`;
        const j = src.indexOf(close, i + m[0].length);
        const end = j < 0 ? n : j;
        let val = src.slice(i + m[0].length, end);
        if (val.startsWith('\n')) val = val.slice(1);
        tokens.push({ t: 'str', v: val, line });
        line += countLines(i, end);
        i = j < 0 ? n : j + close.length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(src[j])) j++;
      tokens.push({ t: 'name', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      tokens.push({ t: 'num', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    tokens.push({ t: 'p', v: c, line });
    i++;
  }
  return tokens;
}

function readGroup(tokens, start) {
  let depth = 0;
  const values = [];
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'p' && (t.v === '{' || t.v === '(')) depth++;
    else if (t.t === 'p' && (t.v === '}' || t.v === ')')) {
      depth--;
      if (depth === 0) return [values, i + 1];
    } else if (t.t === 'str') {
      // Skip the key in `['key'] = 'value'` style entries.
      const next = tokens[i + 1];
      const next2 = tokens[i + 2];
      if (next && next.t === 'p' && next.v === ']' && next2 && next2.v === '=') continue;
      values.push(t.v);
    }
  }
  return [values, tokens.length];
}

const MANIFEST_LISTS = {
  client_script: 'client', client_scripts: 'client',
  server_script: 'server', server_scripts: 'server',
  shared_script: 'shared', shared_scripts: 'shared',
  file: 'files', files: 'files',
  dependency: 'dependencies', dependencies: 'dependencies',
  export: 'exports', exports: 'exports',
  server_export: 'serverExports', server_exports: 'serverExports',
  provide: 'provides', provides: 'provides',
  escrow_ignore: 'escrowIgnore',
};

export function parseManifest(src, fileName = 'fxmanifest.lua') {
  const tokens = tokenizeLua(String(src || ''));
  const entries = [];
  let i = 0;
  while (i < tokens.length) {
    const tk = tokens[i];
    const prev = tokens[i - 1];
    const isStatementStart = !prev || !(prev.t === 'p' && (prev.v === '.' || prev.v === ':'));
    if (tk.t === 'name' && !LUA_KEYWORDS.has(tk.v) && isStatementStart) {
      const next = tokens[i + 1];
      if (next && (next.t === 'str' || (next.t === 'p' && (next.v === '{' || next.v === '(')))) {
        const entry = { key: tk.v, values: [], line: tk.line };
        i++;
        while (i < tokens.length) {
          const a = tokens[i];
          if (a.t === 'str') {
            entry.values.push(a.v);
            i++;
            continue;
          }
          if (a.t === 'p' && (a.v === '{' || a.v === '(')) {
            const [vals, ni] = readGroup(tokens, i);
            entry.values.push(...vals);
            i = ni;
            continue;
          }
          break;
        }
        entries.push(entry);
        continue;
      }
    }
    i++;
  }

  const manifest = {
    fileName,
    legacy: String(fileName).toLowerCase().endsWith('__resource.lua'),
    entries,
    fxVersion: null,
    games: [],
    lua54: false,
    meta: {},
    client: [],
    server: [],
    shared: [],
    files: [],
    uiPage: null,
    loadscreen: null,
    dependencies: [],
    exports: [],
    serverExports: [],
    provides: [],
    escrowIgnore: [],
    dataFiles: [],
    isMap: false,
    lines: {},
  };

  for (const e of entries) {
    const key = e.key;
    manifest.lines[key] ??= e.line;
    if (MANIFEST_LISTS[key]) {
      for (const v of e.values) manifest[MANIFEST_LISTS[key]].push({ value: v, line: e.line });
      continue;
    }
    switch (key) {
      case 'fx_version':
        manifest.fxVersion = e.values[0] ?? null;
        break;
      case 'resource_manifest_version':
        manifest.fxVersion ??= e.values[0] ?? null;
        break;
      case 'game':
      case 'games':
        manifest.games.push(...e.values);
        break;
      case 'lua54':
        manifest.lua54 = String(e.values[0]).toLowerCase() === 'yes';
        break;
      case 'ui_page':
        manifest.uiPage = e.values[0] ?? null;
        break;
      case 'loadscreen':
        manifest.loadscreen = e.values[0] ?? null;
        break;
      case 'this_is_a_map':
        manifest.isMap = String(e.values[0]).toLowerCase() === 'yes';
        break;
      case 'data_file':
        manifest.dataFiles.push({ type: e.values[0], path: e.values[1], line: e.line });
        break;
      case 'name':
      case 'author':
      case 'description':
      case 'version':
      case 'repository':
      case 'url':
        manifest.meta[key] = e.values[0];
        break;
      default:
        break;
    }
  }

  // Scripts loaded from other resources, e.g. '@ox_lib/init.lua' or '@oxmysql/lib/MySQL.lua'.
  manifest.externalRefs = [];
  for (const list of ['client', 'server', 'shared', 'files']) {
    for (const entry of manifest[list]) {
      const m = /^@([^/]+)\//.exec(entry.value);
      if (m && !manifest.externalRefs.includes(m[1])) manifest.externalRefs.push(m[1]);
    }
  }
  return manifest;
}

// ---------------------------------------------------------------------------------------------
// Glob matching for manifest file patterns (FiveM supports * and **).

export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function isExternalPattern(pattern) {
  return /^@/.test(pattern) || /^(https?|nui):\/\//i.test(pattern);
}

export function matchPattern(pattern, relPaths) {
  if (isExternalPattern(pattern)) return [];
  const re = globToRegExp(pattern);
  return relPaths.filter((p) => re.test(p));
}

// ---------------------------------------------------------------------------------------------
// Script analysis

const CLIENT_ONLY = [
  'PlayerPedId', 'PlayerId', 'GetPlayerServerId', 'SetNuiFocus', 'SendNUIMessage', 'SendNuiMessage',
  'RegisterNUICallback', 'RegisterNuiCallback', 'DrawMarker', 'IsControlJustPressed', 'IsControlPressed',
  'IsControlJustReleased', 'IsDisabledControlJustPressed', 'DisableControlAction', 'TriggerServerEvent',
  'TriggerLatentServerEvent', 'RegisterKeyMapping', 'GetActivePlayers', 'RequestModel', 'HasModelLoaded',
  'RequestAnimDict', 'HasAnimDictLoaded', 'BeginTextCommandDisplayText', 'GetGameplayCamCoord', 'AddTextEntry',
];

const SERVER_ONLY = [
  'TriggerClientEvent', 'TriggerLatentClientEvent', 'GetPlayerIdentifiers', 'GetPlayerIdentifier',
  'GetNumPlayerIdentifiers', 'GetPlayerEndpoint', 'DropPlayer', 'PerformHttpRequest', 'SaveResourceFile',
  'GetPlayers',
];

const FRAMEWORKS = [
  ['ESX', /\bESX\b|es_extended/],
  ['QBCore', /\bQBCore\b|qb-core/],
  ['Qbox', /qbx_core/],
  ['ox_lib', /@ox_lib\/init\.lua|exports\.ox_lib|\blib\.(?:callback|notify|addCommand|registerContext|showContext|progressBar|progressCircle|inputDialog|alertDialog|points|zones|requestModel|requestAnimDict|onCache|locale|registerMenu|showMenu|addKeybind|showTextUI|hideTextUI)\b/],
  ['oxmysql', /oxmysql|\bMySQL\.(?:query|insert|update|scalar|single|prepare|rawExecute|transaction)\b/],
  ['mysql-async', /mysql-async|\bMySQL\.Async\b/],
  ['ox_inventory', /ox_inventory/],
  ['ox_target', /ox_target/],
  ['qb-target', /qb-target/],
  ['PolyZone', /\bPolyZone\b|\bBoxZone\b|\bCircleZone\b/],
  ['NativeUI', /\bNativeUI\b/],
  ['RageUI', /\bRageUI\b/],
  ['vMenu', /\bvMenu\b/],
  ['pma-voice', /pma-voice/],
];

export function detectFrameworks(text) {
  return FRAMEWORKS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const NON_NATIVE_JS = new Set([
  'Promise', 'Object', 'Array', 'JSON', 'Math', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Map', 'Set',
  'Symbol', 'RegExp', 'BigInt', 'Function', 'Proxy', 'Reflect', 'TypeError', 'Intl', 'URL', 'Buffer',
]);

const NUI_HELPERS = 'fetchNui|fetchNUI|nuiFetch|postNui|postNUI|nuiPost|sendNui|sendNUI|nuiCallback|triggerNuiCallback';

function luaBlockEnd(src, start) {
  // Walk Lua block keywords from `start` (just after the opening `do`) to find the matching `end`.
  const re = /\b(function|if|do|repeat|end|until)\b/g;
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(src))) {
    const w = m[1];
    if (w === 'end' || w === 'until') {
      depth--;
      if (depth === 0) return m.index;
    } else depth++;
  }
  return src.length;
}

function stringsIn(expr) {
  const out = [];
  const re = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
  let m;
  while ((m = re.exec(expr))) out.push(m[2]);
  return out;
}

function callArgsEnd(src, from) {
  const limit = Math.min(src.length, from + 2000);
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = readQuoted(src, i);
      if (q) {
        i = q.end - 1;
        continue;
      }
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return limit;
}

/** Find the value expression of `key = ...` / `key: ...` inside a call argument, e.g. SendNUIMessage({ action = 'open' }). */
function messageNamesAfter(src, from) {
  const window = src.slice(from, callArgsEnd(src, from));
  const m = /\b(?:action|type|event|message|app|name)\s*[=:]\s*/.exec(window);
  if (!m) return [];
  let i = m.index + m[0].length;
  let depth = 0;
  let end = i;
  for (; end < window.length; end++) {
    const c = window[end];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) break;
      depth--;
    } else if ((c === ',' || c === '\n') && depth === 0) break;
  }
  return stringsIn(window.slice(i, end));
}

function pushUnique(list, entry, key = 'name') {
  if (!list.some((e) => e[key] === entry[key] && e.line === entry.line)) list.push(entry);
}

/**
 * Inspect one script. `side` is 'client' | 'server' | 'shared' | 'nui' | null and changes which
 * FiveM rules apply (e.g. TriggerServerEvent is a client-only native).
 */
export function analyzeScript(content, { lang = 'lua', side = null, resourceName = null } = {}) {
  const result = {
    handlers: [],
    triggers: [],
    callbacksRegistered: [],
    callbacksTriggered: [],
    commands: [],
    keymaps: [],
    exportsDefined: [],
    exportsUsed: [],
    nuiCallbacks: [],
    nuiMessagesSent: [],
    nuiMessagesHandled: [],
    nuiFetches: [],
    includes: [],
    functions: [],
    natives: [],
    threads: 0,
    frameworks: [],
    hints: [],
  };
  const raw = String(content || '');
  if (!raw) return result;
  const isLua = lang === 'lua';
  const isJs = isJsLike(lang);
  const isHtml = lang === 'html';
  if (!isLua && !isJs && !isHtml) {
    result.frameworks = detectFrameworks(raw);
    return result;
  }

  const src = isLua ? stripLuaComments(raw) : isJs ? stripJsComments(raw) : stripHtmlComments(raw);
  const lineAt = makeLineLookup(src);
  const name = (arg) => resolveName(arg.name, resourceName);
  const hint = (level, message, index) => {
    if (result.hints.length < 40) result.hints.push({ level, message, line: index == null ? null : lineAt(index) });
  };
  result.frameworks = detectFrameworks(src);

  const runtimeJs = isJs && side !== 'nui';

  if (isLua || runtimeJs) {
    const rules = isLua
      ? [
          ['RegisterNetEvent', 'handler', 'net'],
          ['RegisterServerEvent', 'handler', 'net'],
          ['AddEventHandler', 'handler', 'local'],
          ['TriggerServerEvent|TriggerLatentServerEvent', 'trigger', 'c2s'],
          ['TriggerClientEvent|TriggerLatentClientEvent', 'trigger', 's2c'],
          ['TriggerEvent', 'trigger', 'local'],
          ['ESX\\.TriggerServerCallback', 'cbTrigger', 'ESX'],
          ['ESX\\.RegisterServerCallback', 'cbRegister', 'ESX'],
          ['QBCore\\.Functions\\.TriggerCallback', 'cbTrigger', 'QBCore'],
          ['QBCore\\.Functions\\.CreateCallback', 'cbRegister', 'QBCore'],
          ['lib\\.callback(?:\\.await)?', 'cbTrigger', 'ox_lib'],
          ['lib\\.callback\\.register', 'cbRegister', 'ox_lib'],
          ['RegisterCommand', 'command', 'native'],
          ['QBCore\\.Commands\\.Add', 'command', 'QBCore'],
          ['ESX\\.RegisterCommand', 'command', 'ESX'],
          ['lib\\.addCommand', 'command', 'ox_lib'],
          ['exports', 'exportDef', null],
          ['Register[Nn][Uu][Ii]Callback', 'nuiCallback', null],
        ]
      : [
          ['onNet', 'handler', 'net'],
          ['on', 'handler', 'local'],
          ['addNetEventHandler', 'handler', 'net'],
          ['addEventHandler', 'handler', 'local'],
          ['emitNet', 'trigger', side === 'server' ? 's2c' : 'c2s'],
          ['TriggerServerEvent', 'trigger', 'c2s'],
          ['TriggerClientEvent', 'trigger', 's2c'],
          ['emit|TriggerEvent', 'trigger', 'local'],
          ['RegisterCommand', 'command', 'native'],
          ['exports', 'exportDef', null],
          ['RegisterNuiCallbackType|RegisterNuiCallback', 'nuiCallback', null],
        ];

    for (const [callee, type, extra] of rules) {
      for (const call of findCalls(src, callee, isLua ? 'lua' : 'js')) {
        if (!call.arg) continue;
        const entry = { name: name(call.arg), line: lineAt(call.index), dynamic: call.arg.dynamic };
        if (type === 'handler') pushUnique(result.handlers, { ...entry, kind: extra });
        else if (type === 'trigger') result.triggers.push({ ...entry, kind: extra });
        else if (type === 'cbTrigger') result.callbacksTriggered.push({ ...entry, fw: extra });
        else if (type === 'cbRegister') result.callbacksRegistered.push({ ...entry, fw: extra });
        else if (type === 'command') pushUnique(result.commands, { ...entry, via: extra });
        else if (type === 'exportDef') pushUnique(result.exportsDefined, entry);
        else if (type === 'nuiCallback') pushUnique(result.nuiCallbacks, entry);
      }
    }

    if (runtimeJs) {
      // JS NUI callbacks are registered with on('__cfx_nui:name'); surface them as NUI callbacks.
      result.handlers = result.handlers.filter((h) => {
        if (!h.name.startsWith('__cfx_nui:')) return true;
        pushUnique(result.nuiCallbacks, { name: h.name.slice('__cfx_nui:'.length), line: h.line });
        return false;
      });
    }

    // Key mappings: RegisterKeyMapping('+command', 'Description', 'keyboard', 'E')
    const keyRe = /(?<![\w.:$])RegisterKeyMapping\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*,\s*(['"])(.*?)\7/g;
    let km;
    while ((km = keyRe.exec(src))) {
      result.keymaps.push({ command: km[2], description: km[4], mapper: km[6], key: km[8], line: lineAt(km.index) });
    }

    // SendNUIMessage({ action = 'open' }) → message names the NUI page should handle.
    const sendRe = /(?<![\w.:$])SendN[Uu][Ii]Message\s*\(/g;
    let sm;
    while ((sm = sendRe.exec(src))) {
      const names = messageNamesAfter(src, sm.index + sm[0].length);
      if (names.length === 0) result.nuiMessagesSent.push({ name: null, line: lineAt(sm.index) });
      for (const n of names) pushUnique(result.nuiMessagesSent, { name: n, line: lineAt(sm.index) });
    }

    // Exports used from other resources.
    const exportUseRes = isLua
      ? [/(?<![\w.:$])exports\s*\[\s*(['"])([^'"\n]+)\1\s*\]\s*:\s*([A-Za-z_]\w*)/g, /(?<![\w.:$])exports\.([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g]
      : [/(?<![\w.:$])exports\s*\[\s*(['"])([^'"\n]+)\1\s*\]\s*\.\s*([A-Za-z_$][\w$]*)/g, /(?<![\w.:$])exports\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g];
    for (const re of exportUseRes) {
      let em;
      while ((em = re.exec(src))) {
        const bracket = em.length === 4;
        const resource = bracket ? em[2] : em[1];
        const fn = bracket ? em[3] : em[2];
        result.exportsUsed.push({ resource, fn, line: lineAt(em.index) });
      }
    }

    // Threads and loops.
    result.threads = (src.match(/(?<![\w:$])(?:Citizen\.)?CreateThread\s*\(|(?<![\w.:$])setTick\s*\(/g) || []).length;

    if (isLua) {
      const blocks = stripLuaComments(raw, { blankStrings: true });
      const loopRe = /\bwhile\s+true\s+do\b/g;
      let lm;
      while ((lm = loopRe.exec(blocks))) {
        const bodyStart = lm.index + lm[0].length;
        const bodyEnd = luaBlockEnd(blocks, bodyStart);
        const body = src.slice(bodyStart, bodyEnd);
        if (!/(?<![\w])(?:Citizen\.)?Wait\s*\(|coroutine\.yield\s*\(/.test(body)) {
          hint('warn', 'while true loop without Wait() — this will freeze the game/server', lm.index);
        }
      }
      let waits = 0;
      const waitRe = /(?<![\w.:$])(?:Citizen\.)?Wait\s*\(\s*0\s*\)/g;
      let wm;
      while ((wm = waitRe.exec(src)) && waits < 3) {
        waits++;
        hint('info', 'Wait(0) runs every frame — keep the loop tiny or use a dynamic sleep when idle', wm.index);
      }
      const gp = /(?<![\w.:$])GetPlayerPed\s*\(\s*-1\s*\)/.exec(src);
      if (gp) hint('info', 'GetPlayerPed(-1) → PlayerPedId() is faster and clearer', gp.index);
      const rse = /(?<![\w.:$])RegisterServerEvent\s*\(/.exec(src);
      if (rse) hint('info', 'RegisterServerEvent is deprecated — use RegisterNetEvent', rse.index);
      const gdbc = /(?<![\w.:$])GetDistanceBetweenCoords\s*\(/.exec(src);
      if (gdbc) hint('info', 'GetDistanceBetweenCoords is slow — use #(coordsA - coordsB) vector math', gdbc.index);
    }

    // Natives that only exist on one side are a classic FiveM mistake.
    const wrongSide = side === 'server' ? CLIENT_ONLY : side === 'client' ? SERVER_ONLY : [];
    for (const fn of wrongSide) {
      const m = new RegExp(String.raw`(?<![\w.:$])${fn}\s*\(`).exec(src);
      if (m) {
        const where = side === 'server' ? 'client' : 'server';
        let advice = '';
        if (fn === 'TriggerServerEvent') advice = ' — on the server use TriggerEvent instead';
        if (fn === 'TriggerClientEvent') advice = ' — from the client use TriggerServerEvent and let the server relay it';
        hint('warn', `${fn} is ${where}-only but this script runs on the ${side}${advice}`, m.index);
      }
    }

    // Functions defined here (outline) and global natives/API calls used.
    const defined = new Set();
    const fnRes = isLua
      ? [/(?:^|[^\w.:])(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(/g, /(?:^|[^\w.:])(?:local\s+)?([A-Za-z_][\w.]*)\s*=\s*function\s*\(/g]
      : [/(?:^|[^\w$.])function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g];
    for (const re of fnRes) {
      let fm;
      while ((fm = re.exec(src))) {
        const fnName = fm[1];
        defined.add(fnName.split(/[.:]/).pop());
        pushUnique(result.functions, { name: fnName, line: lineAt(fm.index + fm[0].indexOf(fnName)) });
      }
    }
    result.functions.sort((a, b) => a.line - b.line);
    const counts = new Map();
    const nativeRe = /(?<![\w.:$])([A-Z][A-Za-z0-9_]{2,})\s*\(/g;
    let nm;
    while ((nm = nativeRe.exec(src))) {
      const n = nm[1];
      if (defined.has(n) || (!isLua && NON_NATIVE_JS.has(n))) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    result.natives = [...counts.entries()].map(([n, count]) => ({ name: n, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  if (isJs || isHtml) {
    // NUI side: fetch(`https://${GetParentResourceName()}/name`) and friends.
    const fetchRes = [
      /fetch\s*\(\s*`https?:\/\/\$\{[^}]+\}\/([\w\-:.\/]+)`/g,
      /fetch\s*\(\s*(['"])https?:\/\/[\w\-]+\/([\w\-:.\/]+)\1/g,
      /(['"])https?:\/\/\1\s*\+\s*GetParentResourceName\(\)\s*\+\s*(['"])\/([\w\-:.\/]+)\2/g,
      /\$\.post\s*\(\s*(['"`])https?:\/\/(?:[\w\-]+|\$\{[^}]+\})\/([\w\-:.\/]+)\1/g,
      new RegExp(String.raw`(?<![\w.$])(?:${NUI_HELPERS})\s*(?:<[^>]*>)?\s*\(\s*(['"\`])([\w\-:.\/]+)\1`, 'g'),
    ];
    for (const re of fetchRes) {
      let fm;
      while ((fm = re.exec(src))) {
        const cb = fm[fm.length - 1];
        pushUnique(result.nuiFetches, { name: cb, line: lineAt(fm.index) });
      }
    }
    const listens = /addEventListener\s*\(\s*['"`]message['"`]|window\.onmessage|\.on\s*\(\s*['"`]message['"`]|useNuiEvent/.test(src);
    if (listens) {
      const msgRes = [
        /\.(?:action|type|event|app)\s*===?\s*(['"`])([^'"`\n]+)\1/g,
        /(['"`])([^'"`\n]+)\1\s*===?\s*[\w.]+\.(?:action|type|event|app)\b/g,
        /\bcase\s+(['"`])([^'"`\n]+)\1\s*:/g,
        /(?<![\w.$])useNuiEvent\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`\n]+)\1/g,
      ];
      for (const re of msgRes) {
        let mm;
        while ((mm = re.exec(src))) pushUnique(result.nuiMessagesHandled, { name: mm[2], line: lineAt(mm.index) });
      }
    }
  }

  if (isHtml) {
    const incRe = /<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)\s*=\s*(['"])([^'"]+)\1/gi;
    let im;
    while ((im = incRe.exec(src))) {
      if (/^(https?:)?\/\//i.test(im[2]) || im[2].startsWith('data:')) continue;
      result.includes.push({ src: im[2], line: lineAt(im.index) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------------------------
// Roles

const NUI_DIRS = new Set(['html', 'ui', 'nui', 'web', 'dist', 'build', 'public', 'client_ui', 'interface', 'app']);

/** Best guess of a file's role from its path, used when no manifest says otherwise. */
export function inferRole(relPath, lang) {
  const p = String(relPath || '').toLowerCase().replace(/\\/g, '/');
  const segs = p.split('/');
  const base = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  const ext = extOf(base);
  if (isManifestName(base)) return 'manifest';
  if (lang === 'cfg') return 'cfg';
  if (lang === 'sql') return 'sql';
  if (ext === 'meta' || ext === 'ymt' || (lang === 'xml' && dirs.includes('data'))) return 'meta';
  if (lang === 'markdown' || /^(readme|license|changelog)/.test(base)) return 'doc';
  const inNui = dirs.some((d) => NUI_DIRS.has(d));
  if (lang === 'html' || lang === 'css' || lang === 'scss' || lang === 'less') return 'nui';
  if (isJsLike(lang) && inNui) return 'nui';
  if (lang === 'lua' || isJsLike(lang) || lang === 'csharp') {
    if (dirs.includes('locales') || dirs.includes('locale') || dirs.includes('lang')) return 'locale';
    if (/^config/.test(base) || dirs.includes('config') || dirs.includes('configs')) return 'config';
    if (dirs.some((d) => d === 'client' || d === 'cl' || d.startsWith('client')) || /^(cl_|client)/.test(base)) return 'client';
    if (dirs.some((d) => d === 'server' || d === 'sv' || d.startsWith('server')) || /^(sv_|server)/.test(base)) return 'server';
    if (dirs.some((d) => d === 'shared' || d === 'sh' || d === 'common') || /^(sh_|shared)/.test(base)) return 'shared';
    return 'other';
  }
  if (lang === 'json') return 'data';
  return 'other';
}

export function sideOfRole(role) {
  if (role === 'client' || role === 'server' || role === 'shared' || role === 'nui') return role;
  if (role === 'config' || role === 'locale') return 'shared';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Board-wide graph

const BUILTIN_EVENTS = new Set([
  'onResourceStart', 'onResourceStop', 'onResourceStarting', 'onClientResourceStart', 'onClientResourceStop',
  'onServerResourceStart', 'onServerResourceStop', 'playerConnecting', 'playerDropped', 'playerJoining',
  'playerSpawned', 'playerActivated', 'gameEventTriggered', 'populationPedCreating', 'entityCreated',
  'entityCreating', 'entityRemoved', 'weaponDamageEvent', 'explosionEvent', 'startProjectileEvent', 'ptFxEvent',
  'removeAllWeaponsEvent', 'giveWeaponEvent', 'removeWeaponEvent', 'clearPedTasksEvent', 'respawnPlayerPedEvent',
  'chatMessage', 'rconCommand', '__cfx_internal:commandFallback', 'onPlayerJoining', 'onPlayerDropped',
  'playerEnteredScope', 'playerLeftScope',
]);

const EXTERNAL_PREFIXES = [
  'chat:', 'baseevents:', 'esx:', 'esx_', 'QBCore:', 'qb-', 'qbx_', 'ox_', 'ox:', 'txAdmin:', 'txsv:',
  'pma-voice:', 'hardcap:', 'spawnmanager:', 'mapmanager:', 'sessionmanager:', 'skinchanger:',
];

export function classifyEvent(name) {
  if (BUILTIN_EVENTS.has(name)) return 'builtin';
  if (EXTERNAL_PREFIXES.some((p) => name.startsWith(p))) return 'framework';
  return 'custom';
}

function normalizePath(p) {
  const out = [];
  for (const seg of String(p).replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

const sideMatches = (want, side) => side == null || want.includes(side);

/**
 * Analyze every file on the board together.
 *
 * files: [{ id, name, path (relative to its resource root), resourceId, resourceName, content, lang }]
 * Returns per-file roles + analysis, per-resource summaries, auto-detected links and a problems list.
 */
export function buildGraph(files, { resourceCards = new Map() } = {}) {
  const fileInfo = new Map();
  const resources = new Map();
  const links = new Map();
  const problems = [];

  const byResource = new Map();
  for (const f of files) {
    const key = f.resourceId || null;
    if (!key) continue;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key).push(f);
  }

  const addLink = (from, to, kind, label, extra = {}) => {
    if (!from || !to || from === to) return;
    const id = `auto:${kind}:${from}:${to}`;
    let link = links.get(id);
    if (!link) {
      link = { id, from, to, kind, auto: true, names: [], ...extra };
      links.set(id, link);
    }
    if (label && !link.names.includes(label)) link.names.push(label);
  };

  // 1. Resources: parse manifests and assign roles from them.
  for (const [resourceId, resFiles] of byResource) {
    const manifestFile = resFiles.find((f) => isManifestName(f.path) && !f.path.includes('/'));
    const resourceName = resFiles[0].resourceName || resourceId;
    const summary = {
      id: resourceId,
      name: resourceName,
      manifestFileId: manifestFile?.id || null,
      manifest: null,
      frameworks: new Set(),
      scripts: { client: [], server: [], shared: [] },
      commands: [],
      keymaps: [],
      exports: [],
      events: { handled: 0, triggered: 0 },
      callbacks: 0,
      nui: false,
      escrow: resFiles.some((f) => extOf(f.path) === 'fxap'),
      dependencies: [],
      hints: [],
    };
    resources.set(resourceId, summary);
    const resHint = (level, message, fileId = summary.manifestFileId, line = null) => {
      summary.hints.push({ level, message, fileId, line });
    };

    if (!manifestFile) continue;
    const manifest = parseManifest(manifestFile.content || '', manifestFile.path);
    summary.manifest = manifest;
    const paths = resFiles.map((f) => f.path);
    const fileByPath = new Map(resFiles.map((f) => [f.path.toLowerCase(), f]));
    const roleFromManifest = new Map();

    for (const list of ['shared', 'client', 'server']) {
      for (const { value, line } of manifest[list]) {
        if (isExternalPattern(value)) continue;
        const matched = matchPattern(value, paths);
        if (matched.length === 0) resHint('warn', `${list}_script '${value}' does not match any file`, manifestFile.id, line);
        for (const p of matched) {
          const f = fileByPath.get(p.toLowerCase());
          if (!f || f === manifestFile) continue;
          const prev = roleFromManifest.get(f.id);
          roleFromManifest.set(f.id, prev && prev !== list ? 'shared' : list);
          summary.scripts[list].push(f.id);
          addLink(manifestFile.id, f.id, `manifest-${list}`, `${list}_script`);
        }
      }
    }

    const filesListed = new Set();
    for (const { value } of manifest.files) {
      for (const p of matchPattern(value, paths)) filesListed.add(p.toLowerCase());
    }
    if (manifest.uiPage && !/^(https?|nui):\/\//i.test(manifest.uiPage)) {
      const uiPath = normalizePath(manifest.uiPage);
      const uiFile = fileByPath.get(uiPath.toLowerCase());
      summary.nui = true;
      if (!uiFile) resHint('warn', `ui_page '${manifest.uiPage}' was not found`, manifestFile.id, manifest.lines.ui_page);
      else {
        addLink(manifestFile.id, uiFile.id, 'manifest-ui', 'ui_page');
        if (!filesListed.has(uiPath.toLowerCase())) {
          resHint('warn', `ui_page '${manifest.uiPage}' must also be listed in files { }`, manifestFile.id, manifest.lines.ui_page);
        }
      }
    }
    for (const f of resFiles) {
      if (filesListed.has(f.path.toLowerCase()) && !roleFromManifest.has(f.id)) {
        const lang = f.lang || detectLanguage(f.path);
        if (['html', 'css', 'scss', 'javascript', 'typescript', 'jsx', 'tsx'].includes(lang)) roleFromManifest.set(f.id, 'nui');
      }
    }
    summary.roleFromManifest = roleFromManifest;
    summary.filesListed = filesListed;

    // Manifest-level hints.
    if (manifest.legacy) resHint('warn', '__resource.lua is legacy — rename to fxmanifest.lua and add fx_version', manifestFile.id, 1);
    if (!manifest.fxVersion) resHint('warn', "Missing fx_version — add fx_version 'cerulean'", manifestFile.id, 1);
    else if (['adamant', 'bodacious'].includes(manifest.fxVersion)) {
      resHint('info', `fx_version '${manifest.fxVersion}' is old — 'cerulean' is the current version`, manifestFile.id, manifest.lines.fx_version);
    }
    if (manifest.games.length === 0 && !manifest.legacy) resHint('warn', "Missing game — add game 'gta5' (or 'rdr3')", manifestFile.id, 1);
    if (!manifest.lua54 && resFiles.some((f) => extOf(f.path) === 'lua' && !isManifestName(f.path))) {
      resHint('info', "lua54 'yes' is not set — Lua 5.4 is faster and adds <const>/<close>", manifestFile.id, 1);
    }
    if (summary.escrow) resHint('info', 'Escrow-protected resource (.fxap) — some scripts are encrypted', manifestFile.id, null);
    summary.dependencies = [...new Set([...manifest.dependencies.map((d) => d.value), ...manifest.externalRefs])];
  }

  // 2. Per-file role + analysis.
  for (const f of files) {
    const lang = f.lang || detectLanguage(f.path || f.name);
    const res = f.resourceId ? resources.get(f.resourceId) : null;
    let role = res?.roleFromManifest?.get(f.id);
    let roleSource = role ? 'manifest' : 'path';
    if (role === 'shared' && /^config/i.test((f.path || f.name).split('/').pop())) role = 'config';
    if (!role) role = inferRole(f.path || f.name, lang);
    const side = sideOfRole(role);
    const analysis = analyzeScript(f.content, { lang, side, resourceName: f.resourceName || res?.name || null });
    const info = { id: f.id, role, roleSource, side, lang, analysis, resourceId: f.resourceId || null, unloaded: false };
    fileInfo.set(f.id, info);

    if (res && res.manifest && (lang === 'lua' || (isJsLike(lang) && role !== 'nui')) && roleSource === 'path' && role !== 'manifest') {
      const listed = res.filesListed?.has(String(f.path).toLowerCase());
      if (!listed && !String(f.path).toLowerCase().includes('node_modules/')) {
        info.unloaded = true;
        analysis.hints.unshift({ level: 'warn', message: 'Not loaded by fxmanifest — add it to client_scripts, server_scripts or shared_scripts', line: null });
      }
    }
    if (res) {
      for (const fw of analysis.frameworks) res.frameworks.add(fw);
      for (const c of analysis.commands) res.commands.push({ ...c, fileId: f.id });
      for (const k of analysis.keymaps) res.keymaps.push({ ...k, fileId: f.id });
      for (const e of analysis.exportsDefined) res.exports.push(e.name);
      res.events.handled += analysis.handlers.length;
      res.events.triggered += analysis.triggers.length;
      res.callbacks += analysis.callbacksRegistered.length + analysis.callbacksTriggered.length;
      if (role === 'nui') res.nui = true;
    }
  }
  for (const res of resources.values()) {
    if (res.manifest) {
      for (const fw of detectFrameworks(res.manifest.entries.map((e) => e.values.join(' ')).join('\n'))) res.frameworks.add(fw);
      for (const e of [...res.manifest.exports, ...res.manifest.serverExports]) if (!res.exports.includes(e.value)) res.exports.push(e.value);
    }
  }

  // 3. Event index.
  const events = new Map();
  const eventEntry = (n) => {
    if (!events.has(n)) events.set(n, { name: n, handlers: [], triggers: [], kind: classifyEvent(n) });
    return events.get(n);
  };
  for (const [id, info] of fileInfo) {
    for (const h of info.analysis.handlers) eventEntry(h.name).handlers.push({ fileId: id, line: h.line, kind: h.kind, side: info.side });
    for (const t of info.analysis.triggers) eventEntry(t.name).triggers.push({ fileId: id, line: t.line, kind: t.kind, side: info.side });
  }

  for (const ev of events.values()) {
    for (const t of ev.triggers) {
      let wanted;
      if (t.kind === 'c2s') wanted = ['server', 'shared'];
      else if (t.kind === 's2c') wanted = ['client', 'shared'];
      else if (t.side === 'shared' || t.side == null) wanted = ['client', 'server', 'shared'];
      else wanted = [t.side, 'shared'];
      const targets = ev.handlers.filter((h) => sideMatches(wanted, h.side));
      for (const h of targets) addLink(t.fileId, h.fileId, `event-${t.kind}`, ev.name);
      t.resolved = targets.length > 0;
      if (!t.resolved && ev.kind === 'custom') {
        const info = fileInfo.get(t.fileId);
        const ownNs = (() => {
          const resName = info.resourceId ? resources.get(info.resourceId)?.name : null;
          const ns = ev.name.split(':')[0];
          return !ev.name.includes(':') || (resName && ns === resName);
        })();
        if (ownNs) {
          const sideText = t.kind === 'c2s' ? 'server' : t.kind === 's2c' ? 'client' : 'local';
          info.analysis.hints.push({ level: 'warn', message: `No ${sideText} handler found for event '${ev.name}'`, line: t.line });
        }
      }
    }
  }

  // 4. Callbacks (ESX / QBCore / ox_lib), matched by name.
  const cbRegs = new Map();
  for (const [id, info] of fileInfo) {
    for (const c of info.analysis.callbacksRegistered) {
      if (!cbRegs.has(c.name)) cbRegs.set(c.name, []);
      cbRegs.get(c.name).push(id);
    }
  }
  for (const [id, info] of fileInfo) {
    for (const c of info.analysis.callbacksTriggered) {
      const regs = cbRegs.get(c.name) || [];
      for (const r of regs) addLink(id, r, 'callback', c.name);
      if (regs.length === 0 && classifyEvent(c.name) === 'custom') {
        info.analysis.hints.push({ level: 'info', message: `Callback '${c.name}' is not registered on this board`, line: c.line });
      }
    }
  }

  // 5. NUI: Lua SendNUIMessage → JS message handlers; JS fetch → Lua RegisterNUICallback.
  const sameScope = (a, b) => (a.resourceId && b.resourceId ? a.resourceId === b.resourceId : true);
  const infos = [...fileInfo.values()];
  for (const a of infos) {
    for (const msg of a.analysis.nuiMessagesSent) {
      if (!msg.name) continue;
      for (const b of infos) {
        if (b === a || !sameScope(a, b)) continue;
        if (b.analysis.nuiMessagesHandled.some((h) => h.name === msg.name)) addLink(a.id, b.id, 'nui-message', msg.name);
      }
    }
    for (const fetch of a.analysis.nuiFetches) {
      const targets = infos.filter((b) => b !== a && sameScope(a, b) && b.analysis.nuiCallbacks.some((c) => c.name === fetch.name));
      for (const b of targets) addLink(a.id, b.id, 'nui-callback', fetch.name);
      if (targets.length === 0) a.analysis.hints.push({ level: 'warn', message: `NUI callback '${fetch.name}' has no RegisterNUICallback`, line: fetch.line });
    }
  }

  // 6. Exports between resources.
  const resourceByName = new Map([...resources.values()].map((r) => [r.name, r]));
  for (const a of infos) {
    for (const use of a.analysis.exportsUsed) {
      const res = resourceByName.get(use.resource);
      if (!res) continue;
      const definers = infos.filter((b) => b.resourceId === res.id && b.analysis.exportsDefined.some((e) => e.name === use.fn));
      const label = `${use.resource}:${use.fn}`;
      if (definers.length) for (const b of definers) addLink(a.id, b.id, 'export', label);
      else if (resourceCards.get(res.id)) addLink(a.id, resourceCards.get(res.id), 'export', label);
      else if (res.manifestFileId) addLink(a.id, res.manifestFileId, 'export', label);
    }
  }

  // 7. HTML includes (<script src>, <link href>) inside a resource.
  const pathIndex = new Map();
  for (const f of files) if (f.resourceId) pathIndex.set(`${f.resourceId}|${String(f.path).toLowerCase()}`, f.id);
  for (const f of files) {
    const info = fileInfo.get(f.id);
    if (!info || !info.analysis.includes.length || !f.resourceId) continue;
    for (const inc of info.analysis.includes) {
      let target = inc.src.split(/[?#]/)[0];
      let resId = f.resourceId;
      const nui = /^nui:\/\/([^/]+)\/(.+)$/i.exec(target);
      if (nui) {
        resId = resourceByName.get(nui[1])?.id;
        target = nui[2];
      } else target = target.startsWith('/') ? target.slice(1) : `${dirOf(f.path)}/${target}`;
      const id = resId && pathIndex.get(`${resId}|${normalizePath(target).toLowerCase()}`);
      if (id) addLink(f.id, id, 'include', inc.src);
    }
  }

  // 8. Problems list (warnings first).
  for (const res of resources.values()) {
    for (const h of res.hints) problems.push({ ...h, resourceId: res.id });
  }
  for (const info of fileInfo.values()) {
    for (const h of info.analysis.hints) problems.push({ ...h, fileId: info.id, resourceId: info.resourceId });
  }
  problems.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));

  for (const res of resources.values()) {
    res.frameworks = [...res.frameworks].sort();
    delete res.roleFromManifest;
    delete res.filesListed;
  }

  return { files: fileInfo, resources, links: [...links.values()], events, problems };
}
