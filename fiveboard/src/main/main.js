import { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildMenu } from './menu.js';
import { scanDirectory, readFileForBoard, readImageAsDataUrl } from './scanner.js';
import { BoardStore } from './boards.js';
import { WatchManager } from './watcher.js';
import { Settings } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const APP_HOST = 'fiveboard';
const APP_ORIGIN = `app://${APP_HOST}`;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const CODEMIRROR_DIR = path.dirname(require.resolve('codemirror/package.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

if (process.env.FIVEBOARD_USER_DATA) app.setPath('userData', process.env.FIVEBOARD_USER_DATA);

const isWin = process.platform === 'win32';
// Colors for the Windows caption buttons drawn over our own title bar.
const TITLEBAR = {
  dark: { color: '#202125', symbolColor: '#e8e9eb', height: 48 },
  light: { color: '#f7f7f8', symbolColor: '#1c1d21', height: 48 },
};

// One window per user: opening a .fiveboard file in Explorer hands it to the running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const boardFileArg = (argv) => argv.find((a) => /\.fiveboard$/i.test(a));

const boards = new BoardStore(() => path.join(app.getPath('userData'), 'boards'));
const settings = new Settings(() => path.join(app.getPath('userData'), 'settings.json'));
const watcher = new WatchManager();

let mainWindow = null;
let rendererReady = false;
let allowClose = false;
let appQuitting = false;
const pendingOpenFiles = [];

function resolveAppFile(urlPathname) {
  let base = RENDERER_DIR;
  let rel = urlPathname.replace(/^\/+/, '') || 'index.html';
  if (rel.startsWith('vendor/codemirror/')) {
    base = CODEMIRROR_DIR;
    rel = rel.slice('vendor/codemirror/'.length);
  }
  const full = path.normalize(path.join(base, rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveAppFile(decodeURIComponent(url.pathname));
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fsp.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  const bounds = settings.get('windowBounds') || { width: 1440, height: 900 };
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'FiveBoard',
    backgroundColor: '#1b1c1f',
    icon: isMac ? undefined : path.join(__dirname, '..', '..', 'build', 'icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    titleBarOverlay: isWin ? TITLEBAR[settings.get('theme') === 'light' ? 'light' : 'dark'] : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (settings.get('windowMaximized')) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    settings.set('windowMaximized', mainWindow.isMaximized());
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) settings.set('windowBounds', mainWindow.getBounds());
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Never navigate away from the app; open web links in the default browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    // Give the renderer a moment to flush its autosave before the window goes away.
    if (allowClose || !rendererReady) return;
    event.preventDefault();
    requestFlush().finally(() => {
      allowClose = true;
      if (appQuitting) app.quit();
      else mainWindow?.close();
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    allowClose = false;
    watcher.unwatchAll();
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

let flushResolver = null;
function requestFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      flushResolver = null;
      resolve();
    }, 2500);
    flushResolver = () => {
      clearTimeout(timer);
      flushResolver = null;
      resolve();
    };
    mainWindow.webContents.send('app:flush');
  });
}

function sendMenuCommand(command, payload) {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.webContents.send('menu:command', { command, payload });
}

function isTrustedSender(event) {
  const url = event.senderFrame?.url || '';
  return url.startsWith(APP_ORIGIN + '/');
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    return fn(event, ...args);
  });
}

function registerIpc() {
  handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    userData: app.getPath('userData'),
    home: app.getPath('home'),
  }));
  handle('app:ready', () => {
    rendererReady = true;
    const files = pendingOpenFiles.splice(0);
    return { openFiles: files };
  });
  handle('app:flushed', () => {
    flushResolver?.();
  });
  handle('window:close', () => mainWindow?.close());
  // Windows has no menu bar (the title bar is ours), so the app menu pops up from a button.
  handle('window:menu', (_e, x, y) => {
    Menu.getApplicationMenu()?.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
  });
  handle('window:theme', (_e, theme) => {
    if (!mainWindow) return;
    const t = theme === 'light' ? 'light' : 'dark';
    mainWindow.setBackgroundColor(t === 'light' ? '#f1f2f4' : '#1b1c1f');
    if (isWin) mainWindow.setTitleBarOverlay(TITLEBAR[t]);
  });

  handle('settings:get', (_e, key) => settings.get(key));
  handle('settings:set', (_e, key, value) => settings.set(key, value));

  handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a folder or FiveM resource',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('dialog:openFiles', async (_e, opts = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Add files to the board',
      properties: ['openFile', 'multiSelections'],
      filters: opts.filters,
    });
    return res.canceled ? [] : res.filePaths;
  });
  handle('dialog:saveFile', async (_e, opts = {}) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: opts.title || 'Save file',
      defaultPath: opts.defaultPath,
      filters: opts.filters,
    });
    return res.canceled ? null : res.filePath;
  });
  handle('dialog:confirm', async (_e, opts = {}) => {
    const res = await dialog.showMessageBox(mainWindow, {
      type: opts.type || 'question',
      message: opts.message || 'Are you sure?',
      detail: opts.detail,
      buttons: opts.buttons || ['OK', 'Cancel'],
      defaultId: 0,
      cancelId: (opts.buttons || ['OK', 'Cancel']).length - 1,
    });
    return res.response;
  });

  handle('fs:stat', async (_e, p) => {
    try {
      const s = await fsp.stat(p);
      return { exists: true, isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return { exists: false };
    }
  });
  handle('fs:scan', (_e, root, opts) => scanDirectory(path.normalize(root), opts));
  handle('fs:readFile', (_e, p, opts) => readFileForBoard(path.normalize(p), opts));
  handle('fs:readImage', (_e, p) => readImageAsDataUrl(path.normalize(p)));
  handle('fs:writeFile', async (_e, rawPath, content) => {
    if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) throw new Error('A full file path is required');
    const p = path.normalize(rawPath);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, content, 'utf8');
    const s = await fsp.stat(p);
    return { size: s.size, mtimeMs: s.mtimeMs };
  });
  handle('fs:watch', (event, root) => watcher.watch(root, event.sender));
  handle('fs:unwatch', (_e, root) => watcher.unwatch(root));

  handle('shell:reveal', (_e, p) => shell.showItemInFolder(path.normalize(p)));
  handle('shell:openPath', (_e, p) => shell.openPath(path.normalize(p)));
  handle('shell:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^(https?:\/\/|vscode:\/\/)/i.test(url)) return shell.openExternal(url);
    return false;
  });

  handle('boards:list', () => boards.list());
  handle('boards:load', (_e, id) => boards.load(id));
  handle('boards:save', (_e, board) => boards.save(board));
  handle('boards:delete', (_e, id) => boards.remove(id));
  handle('boards:export', async (_e, board) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export board',
      defaultPath: `${(board.name || 'board').replace(/[\\/:*?"<>|]/g, '-')}.fiveboard`,
      filters: [{ name: 'FiveBoard board', extensions: ['fiveboard'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, JSON.stringify(board), 'utf8');
    return res.filePath;
  });
  handle('boards:importDialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a board',
      properties: ['openFile'],
      filters: [{ name: 'FiveBoard board', extensions: ['fiveboard', 'json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return boards.importFile(res.filePaths[0]);
  });
  handle('boards:importFile', (_e, p) => boards.importFile(p));
}

function openBoardFile(filePath) {
  if (mainWindow && rendererReady) mainWindow.webContents.send('app:open-file', filePath);
  else pendingOpenFiles.push(filePath);
}

// macOS delivers double-clicked files as an event; Windows passes them on the command line.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openBoardFile(filePath);
});

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const file = boardFileArg(argv.slice(1));
  if (file) openBoardFile(file);
});

{
  const file = boardFileArg(process.argv.slice(1));
  if (file) pendingOpenFiles.push(file);
}

app.whenReady().then(() => {
  if (!gotLock) return;
  app.setName('FiveBoard');
  if (isWin) app.setAppUserModelId('com.fiveboard.app');
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  app.setAboutPanelOptions({
    applicationName: 'FiveBoard',
    applicationVersion: app.getVersion(),
    copyright: 'A planning board and code space for FiveM scripting.',
    iconPath,
  });
  // Packaged apps get their icon from the bundle; in development show it in the Dock too.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath);
  registerAppProtocol();
  registerIpc();
  Menu.setApplicationMenu(buildMenu(sendMenuCommand));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  // The window close handler flushes the autosave, then re-issues the quit.
  appQuitting = true;
});

app.on('will-quit', () => {
  settings.flush();
  watcher.unwatchAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
