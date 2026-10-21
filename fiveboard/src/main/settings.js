import fs from 'node:fs';
import path from 'node:path';

// Small JSON settings file in the user data folder. Reads are cached; writes are debounced.
export class Settings {
  constructor(getFile) {
    this.getFile = getFile;
    this.data = null;
    this.timer = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(fs.readFileSync(this.getFile(), 'utf8'));
    } catch {
      this.data = {};
    }
    return this.data;
  }

  get(key) {
    const data = this.load();
    return key === undefined ? { ...data } : data[key];
  }

  set(key, value) {
    this.load()[key] = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
    return true;
  }

  flush() {
    clearTimeout(this.timer);
    const file = this.getFile();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.data || {}, null, 2));
    } catch (err) {
      console.error('Failed to write settings', err);
    }
  }
}
