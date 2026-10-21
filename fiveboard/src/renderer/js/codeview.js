// Syntax highlighting for file cards (static, via CodeMirror's runMode) plus mode lookup for the editor.
import { NATIVES } from './fivem/natives.js';

const CM = window.CodeMirror;

const CFG_COMMANDS = new Set([
  'ensure', 'start', 'stop', 'restart', 'refresh', 'exec', 'set', 'sets', 'setr', 'seta', 'add_ace', 'remove_ace',
  'add_principal', 'remove_principal', 'endpoint_add_tcp', 'endpoint_add_udp', 'sv_hostname', 'sv_maxclients',
  'sv_licenseKey', 'sv_endpointprivacy', 'sv_scriptHookAllowed', 'sv_enforceGameBuild', 'sv_projectName',
  'sv_projectDesc', 'sv_master1', 'sv_lan', 'load_server_icon', 'steam_webApiKey', 'rcon_password', 'onesync',
  'sv_pureLevel', 'sv_enableNetworkedSounds', 'sv_filterRequestControl', 'sv_authMaxVariance', 'sv_authMinTrust',
  'sv_requestParanoia', 'sv_endpoints', 'locale', 'tags', 'banner_detail', 'banner_connecting', 'con_miniconChannels',
]);

let defined = false;

function defineModes() {
  if (defined || !CM) return;
  defined = true;

  // server.cfg: commands at the start of a line, strings, comments, ACE principals.
  CM.defineMode('fivem-cfg', () => ({
    startState: () => ({ first: true }),
    token(stream, state) {
      if (stream.sol()) state.first = true;
      if (stream.eatSpace()) return null;
      if (stream.match(/^(#|\/\/)/)) {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
        state.first = false;
        return 'string';
      }
      if (stream.match(/^-?\d+(?:\.\d+)?(?![\w.])/)) {
        state.first = false;
        return 'number';
      }
      if (stream.match(/^[^\s"#]+/)) {
        const word = stream.current();
        const wasFirst = state.first;
        state.first = false;
        if (wasFirst) return CFG_COMMANDS.has(word) ? 'keyword' : 'def';
        if (/^(true|false|on|off|yes|no|allow|deny)$/i.test(word)) return 'atom';
        if (/^(group|identifier|resource|command|builtin)\./.test(word)) return 'variable-2';
        return null;
      }
      stream.next();
      return null;
    },
    lineComment: '#',
  }));
  CM.defineMIME('text/x-fivem-cfg', 'fivem-cfg');

  // Lua with FiveM natives and runtime helpers highlighted.
  const specials = NATIVES.map(([name]) => name).concat([
    'Citizen\\.CreateThread', 'Citizen\\.Wait', 'Citizen\\.SetTimeout', 'vector2', 'vector3', 'vector4', 'vec2',
    'vec3', 'vec4', 'quat', 'json\\.encode', 'json\\.decode', 'exports', 'source', 'joaat', 'promise\\.new',
    'Citizen\\.Await', 'msgpack\\.pack', 'msgpack\\.unpack', 'AddStateBagChangeHandler',
  ]);
  CM.defineMIME('text/x-fivem-lua', { name: 'lua', specials });
}

export function modeFor(lang) {
  defineModes();
  switch (lang) {
    case 'lua': return 'text/x-fivem-lua';
    case 'javascript': return 'text/javascript';
    case 'jsx': return 'text/jsx';
    case 'typescript': return 'text/typescript';
    case 'tsx': return 'text/typescript-jsx';
    case 'json': return 'application/json';
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'scss': return 'text/x-scss';
    case 'less': return 'text/x-less';
    case 'xml': return 'application/xml';
    case 'markdown': return 'text/x-markdown';
    case 'sql': return 'text/x-mysql';
    case 'yaml': return 'text/x-yaml';
    case 'toml': return 'text/x-toml';
    case 'shell': return 'text/x-sh';
    case 'properties': return 'text/x-properties';
    case 'csharp': return 'text/x-csharp';
    case 'python': return 'text/x-python';
    case 'cfg': return 'text/x-fivem-cfg';
    default: return 'text/plain';
  }
}

export const LANG_LABEL = {
  lua: 'LUA', javascript: 'JS', jsx: 'JSX', typescript: 'TS', tsx: 'TSX', json: 'JSON', html: 'HTML', css: 'CSS',
  scss: 'SCSS', less: 'LESS', xml: 'XML', markdown: 'MD', sql: 'SQL', yaml: 'YAML', toml: 'TOML', shell: 'SH',
  properties: 'INI', csharp: 'C#', python: 'PY', cfg: 'CFG', text: 'TXT',
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cleanStyle = (style) => style.replace(/[^\w\- ]/g, '').trim().split(/\s+/).map((s) => `cm-${s}`).join(' ');

/**
 * Render highlighted code with line numbers into `el`. All text is escaped; only CodeMirror's
 * token class names (sanitised) become markup.
 */
export function renderPreview(el, text, lang, { maxLines = 1500 } = {}) {
  const source = String(text ?? '');
  let shown = source;
  let hidden = 0;
  let count = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 && ++count > maxLines) {
      shown = source.slice(0, i);
      hidden = source.split('\n').length - maxLines;
      break;
    }
  }
  const parts = ['<span class="l">'];
  const mode = modeFor(lang);
  try {
    CM.runMode(shown, mode, (token, style) => {
      if (token === '\n') {
        parts.push('</span><span class="l">');
        return;
      }
      const esc = escapeHtml(token);
      parts.push(style ? `<span class="${cleanStyle(style)}">${esc}</span>` : esc);
    });
  } catch {
    parts.length = 1;
    parts.push(escapeHtml(shown).split('\n').join('</span><span class="l">'));
  }
  parts.push('</span>');
  if (hidden > 0) parts.push(`<span class="l more">… ${hidden} more lines — open in the editor to see everything</span>`);
  el.innerHTML = parts.join('');
}
