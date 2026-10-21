import fs from 'node:fs';
import path from 'node:path';
import { IGNORED_NAMES } from './scanner.js';

// Watches imported workspace folders and tells the renderer which files changed on disk.
export class WatchManager {
  constructor() {
    this.watchers = new Map();
  }

  watch(root, webContents) {
    if (typeof root !== 'string' || this.watchers.has(root)) return true;
    let watcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (_type, filename) => {
        if (!filename) return;
        const rel = filename.split(path.sep).join('/');
        if (rel.split('/').some((part) => IGNORED_NAMES.has(part))) return;
        entry.pending.add(rel);
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const paths = [...entry.pending];
          entry.pending.clear();
          if (!webContents.isDestroyed()) webContents.send('fs:changed', { root, paths });
        }, 350);
      });
    } catch (err) {
      console.warn('Could not watch', root, err.message);
      return false;
    }
    const entry = { watcher, pending: new Set(), timer: null };
    watcher.on('error', () => this.unwatch(root));
    this.watchers.set(root, entry);
    return true;
  }

  unwatch(root) {
    const entry = this.watchers.get(root);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.watcher.close();
    this.watchers.delete(root);
  }

  unwatchAll() {
    for (const root of [...this.watchers.keys()]) this.unwatch(root);
  }
}
