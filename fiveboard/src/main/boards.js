import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function summarize(board) {
  const items = Array.isArray(board.items) ? board.items : [];
  return {
    id: board.id,
    name: board.name || 'Untitled board',
    updatedAt: board.updatedAt || Date.now(),
    createdAt: board.createdAt || Date.now(),
    itemCount: items.length,
    fileCount: items.filter((i) => i.type === 'file').length,
  };
}

// Boards live as one JSON file each in <userData>/boards, plus an index for fast listing.
export class BoardStore {
  constructor(getDir) {
    this.getDir = getDir;
    this.index = null;
    this.writes = new Map();
  }

  fileFor(id) {
    if (!ID_RE.test(id)) throw new Error('Invalid board id');
    return path.join(this.getDir(), `${id}.json`);
  }

  async ensureDir() {
    await fsp.mkdir(this.getDir(), { recursive: true });
  }

  async loadIndex() {
    if (this.index) return this.index;
    await this.ensureDir();
    const indexFile = path.join(this.getDir(), 'index.json');
    try {
      this.index = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
      if (!Array.isArray(this.index)) throw new Error('bad index');
    } catch {
      // Rebuild the index from the board files on disk.
      this.index = [];
      const names = await fsp.readdir(this.getDir());
      for (const name of names) {
        if (!name.endsWith('.json') || name === 'index.json') continue;
        try {
          const board = JSON.parse(await fsp.readFile(path.join(this.getDir(), name), 'utf8'));
          if (board && board.id) this.index.push(summarize(board));
        } catch {
          /* skip unreadable board */
        }
      }
      await this.writeIndex();
    }
    return this.index;
  }

  async writeIndex() {
    await atomicWrite(path.join(this.getDir(), 'index.json'), JSON.stringify(this.index, null, 2));
  }

  async list() {
    const index = await this.loadIndex();
    return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id) {
    try {
      return JSON.parse(await fsp.readFile(this.fileFor(id), 'utf8'));
    } catch {
      return null;
    }
  }

  async save(board) {
    if (!board || !ID_RE.test(board.id || '')) throw new Error('Invalid board');
    await this.ensureDir();
    // Serialize writes per board so a slow write never lands after a newer one.
    const prev = this.writes.get(board.id) || Promise.resolve();
    const next = prev.then(async () => {
      await atomicWrite(this.fileFor(board.id), JSON.stringify(board));
      const index = await this.loadIndex();
      const summary = summarize(board);
      const at = index.findIndex((b) => b.id === board.id);
      if (at >= 0) index[at] = summary;
      else index.push(summary);
      await this.writeIndex();
      return summary;
    });
    this.writes.set(board.id, next.catch(() => {}));
    return next;
  }

  async remove(id) {
    await fsp.rm(this.fileFor(id), { force: true });
    const index = await this.loadIndex();
    this.index = index.filter((b) => b.id !== id);
    await this.writeIndex();
    return true;
  }

  async importFile(filePath) {
    const board = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    if (!board || !Array.isArray(board.items)) throw new Error('This file is not a FiveBoard board');
    // Imported boards always get a fresh id so they never overwrite an existing one.
    board.id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    board.updatedAt = Date.now();
    await this.save(board);
    return board;
  }
}

async function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, contents, 'utf8');
  await fsp.rename(tmp, file);
}
