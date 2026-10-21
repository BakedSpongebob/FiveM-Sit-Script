const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The renderer only ever sees this narrow, promise-based API.
contextBridge.exposeInMainWorld('api', {
  info: () => invoke('app:info'),
  ready: () => invoke('app:ready'),
  flushed: () => invoke('app:flushed'),
  closeWindow: () => invoke('window:close'),
  showAppMenu: (x, y) => invoke('window:menu', x, y),
  setTheme: (theme) => invoke('window:theme', theme),
  onFlush: (cb) => subscribe('app:flush', cb),
  onOpenFile: (cb) => subscribe('app:open-file', cb),
  onMenu: (cb) => subscribe('menu:command', cb),
  onFsChanged: (cb) => subscribe('fs:changed', cb),

  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value),
  },

  dialog: {
    openFolder: () => invoke('dialog:openFolder'),
    openFiles: (opts) => invoke('dialog:openFiles', opts),
    saveFile: (opts) => invoke('dialog:saveFile', opts),
    confirm: (opts) => invoke('dialog:confirm', opts),
  },

  fs: {
    stat: (p) => invoke('fs:stat', p),
    scan: (root, opts) => invoke('fs:scan', root, opts),
    readFile: (p, opts) => invoke('fs:readFile', p, opts),
    readImage: (p) => invoke('fs:readImage', p),
    writeFile: (p, content) => invoke('fs:writeFile', p, content),
    watch: (root) => invoke('fs:watch', root),
    unwatch: (root) => invoke('fs:unwatch', root),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    },
  },

  shell: {
    reveal: (p) => invoke('shell:reveal', p),
    openPath: (p) => invoke('shell:openPath', p),
    openExternal: (url) => invoke('shell:openExternal', url),
  },

  boards: {
    list: () => invoke('boards:list'),
    load: (id) => invoke('boards:load', id),
    save: (board) => invoke('boards:save', board),
    remove: (id) => invoke('boards:delete', id),
    exportBoard: (board) => invoke('boards:export', board),
    importDialog: () => invoke('boards:importDialog'),
    importFile: (p) => invoke('boards:importFile', p),
  },
});
