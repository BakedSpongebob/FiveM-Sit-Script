import fsp from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_NAMES = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.DS_Store', 'Thumbs.db', '.vscode', '.idea',
  '__MACOSX', '.cache', '.turbo', '.next', '.parcel-cache', 'cache', 'txData',
]);

const TEXT_EXT = new Set([
  'lua', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'md', 'markdown', 'txt', 'cfg', 'yml', 'yaml', 'toml', 'xml', 'meta', 'sql', 'sh', 'bat', 'cmd', 'ps1',
  'ini', 'env', 'cs', 'csproj', 'sln', 'py', 'vue', 'svelte', 'gitignore', 'gitattributes', 'editorconfig',
  'prettierrc', 'eslintrc', 'babelrc', 'npmrc', 'lock', 'log', 'csv', 'ymt', 'dat', 'gxt', 'properties',
]);

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

// GTA V / FiveM streamed assets and other formats that never contain readable text.
const BINARY_EXT = new Set([
  'ytd', 'ydr', 'yft', 'ybn', 'ymap', 'ytyp', 'ycd', 'ydd', 'ynv', 'ynd', 'ypt', 'yld', 'ysc', 'awc', 'rel',
  'rpf', 'gfx', 'fxap', 'dll', 'exe', 'so', 'dylib', 'pdb', 'zip', 'rar', '7z', 'gz', 'tar', 'mp3', 'ogg', 'wav',
  'mp4', 'webm', 'mov', 'm4a', 'flac', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'ico', 'psd', 'pdf', 'blend', 'fbx',
  'obj', 'dds', 'tga', 'bin', 'db', 'sqlite', 'wasm', 'jar', 'class',
]);

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml',
};

const DEFAULTS = {
  maxFiles: 2500,
  maxDepth: 14,
  maxTextBytes: 400 * 1024,
  maxTotalTextBytes: 64 * 1024 * 1024,
  maxImageBytes: 400 * 1024,
  maxImages: 40,
};

export function extOf(name) {
  const base = name.toLowerCase();
  if (base.startsWith('.') && base.indexOf('.', 1) === -1) return base.slice(1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : '';
}

function looksBinary(buf) {
  const len = Math.min(buf.length, 8000);
  if (len === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 7 || (c > 13 && c < 32)) suspicious++;
  }
  return suspicious / len > 0.1;
}

async function readText(full, size, maxBytes) {
  if (size <= maxBytes) {
    const buf = await fsp.readFile(full);
    if (looksBinary(buf)) return { binary: true };
    return { content: buf.toString('utf8'), truncated: false };
  }
  const fh = await fsp.open(full, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const slice = buf.subarray(0, bytesRead);
    if (looksBinary(slice)) return { binary: true };
    return { content: slice.toString('utf8'), truncated: true };
  } finally {
    await fh.close();
  }
}

function sortEntries(a, b) {
  const rank = (n) => (n === 'fxmanifest.lua' || n === '__resource.lua' ? 0 : 1);
  return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Walk a folder and return a tree with file contents, ready to be laid out on the board.
 * Text files carry their content, small images a data URL, everything else only metadata.
 */
export async function scanDirectory(root, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const ignore = new Set([...IGNORED_NAMES, ...(opts.ignore || [])]);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error('Not a folder');

  const state = { files: 0, dirs: 0, skipped: 0, textBytes: 0, images: 0, limited: false };

  async function walk(dir, rel, depth) {
    const node = { name: rel ? path.basename(dir) : path.basename(root), relPath: rel, dirs: [], files: [] };
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return node;
    }
    dirents.sort(sortEntries);
    for (const d of dirents) {
      if (ignore.has(d.name) || d.isSymbolicLink()) {
        state.skipped++;
        continue;
      }
      const full = path.join(dir, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (depth >= opts.maxDepth) {
          state.skipped++;
          continue;
        }
        state.dirs++;
        node.dirs.push(await walk(full, childRel, depth + 1));
        continue;
      }
      if (!d.isFile()) continue;
      if (state.files >= opts.maxFiles) {
        state.limited = true;
        state.skipped++;
        continue;
      }
      state.files++;
      node.files.push(await describeFile(full, childRel, d.name, opts, state));
    }
    return node;
  }

  const tree = await walk(root, '', 0);
  return {
    root,
    name: path.basename(root),
    tree,
    stats: {
      files: state.files,
      dirs: state.dirs,
      skipped: state.skipped,
      limited: state.limited,
      textBytes: state.textBytes,
    },
  };
}

async function describeFile(full, relPath, name, opts, state) {
  const ext = extOf(name);
  let s;
  try {
    s = await fsp.stat(full);
  } catch {
    return { name, relPath, path: full, kind: 'binary', size: 0, ext, unreadable: true };
  }
  const base = { name, relPath, path: full, size: s.size, mtimeMs: s.mtimeMs, ext };

  if (IMAGE_EXT.has(ext)) {
    if (s.size <= opts.maxImageBytes && state.images < opts.maxImages) {
      state.images++;
      const buf = await fsp.readFile(full);
      return { ...base, kind: 'image', dataUrl: `data:${IMAGE_MIME[ext]};base64,${buf.toString('base64')}` };
    }
    return { ...base, kind: 'binary', isImage: true };
  }
  if (BINARY_EXT.has(ext)) return { ...base, kind: 'binary' };

  // Known text types are read directly; unknown types are sniffed for binary content.
  if (state.textBytes >= opts.maxTotalTextBytes) return { ...base, kind: 'text', content: null, omitted: true };
  if (!TEXT_EXT.has(ext) && s.size > 2 * 1024 * 1024) return { ...base, kind: 'binary' };
  try {
    const res = await readText(full, s.size, opts.maxTextBytes);
    if (res.binary) return { ...base, kind: 'binary' };
    state.textBytes += res.content.length;
    return { ...base, kind: 'text', content: res.content, truncated: res.truncated };
  } catch {
    return { ...base, kind: 'binary', unreadable: true };
  }
}

/** Read a single file for a board card (text content, image data URL, or metadata only). */
export async function readFileForBoard(full, options = {}) {
  const opts = { ...DEFAULTS, maxImageBytes: 8 * 1024 * 1024, maxImages: 1, ...options };
  return describeFile(full, path.basename(full), path.basename(full), opts, { textBytes: 0, images: 0 });
}

export async function readImageAsDataUrl(full) {
  const ext = extOf(full);
  if (!IMAGE_MIME[ext]) throw new Error('Not an image');
  const buf = await fsp.readFile(full);
  return `data:${IMAGE_MIME[ext]};base64,${buf.toString('base64')}`;
}
