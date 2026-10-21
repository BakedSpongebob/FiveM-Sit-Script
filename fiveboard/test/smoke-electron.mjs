// End-to-end smoke test: launches FiveBoard, imports this repo's sit script, checks the FiveM
// analysis, edits and saves a file, then screenshots the window.
//
//   npm install --no-save playwright-core
//   node test/smoke-electron.mjs                                  # dev build (node_modules/electron)
//   node test/smoke-electron.mjs --exe dist/win-unpacked/FiveBoard.exe --shot smoke.png
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const exe = arg('--exe');
const shotPath = arg('--shot');

const { _electron: electron } = require('playwright-core');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiveboard-smoke-'));
const userData = path.join(tmp, 'userdata');
const resource = path.join(tmp, 'resources', 'sit');
fs.mkdirSync(resource, { recursive: true });
for (const f of ['fxmanifest.lua', 'client.lua']) fs.copyFileSync(path.join(repoRoot, f), path.join(resource, f));

const sandboxArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
const app = await electron.launch({
  executablePath: exe ? path.resolve(exe) : require('electron'),
  args: exe ? sandboxArgs : [...sandboxArgs, appDir],
  env: { ...process.env, FIVEBOARD_USER_DATA: userData },
  timeout: 60000,
});
const errors = [];
const step = (msg) => console.log(`  ✓ ${msg}`);

try {
  const win = await app.firstWindow();
  win.on('pageerror', (err) => errors.push(err.message));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForFunction(() => window.fiveboard?.store.board, null, { timeout: 30000 });
  step(`app started on ${process.platform}`);

  await win.evaluate((root) => window.fiveboard.importFolder(root), path.join(tmp, 'resources'));
  await win.waitForFunction(() => window.fiveboard.store.graph?.resources.size > 0, null, { timeout: 15000 });
  const result = await win.evaluate(() => {
    const s = window.fiveboard.store;
    const client = s.board.items.find((i) => i.type === 'file' && i.name === 'client.lua');
    const info = s.graph.files.get(client.id);
    return {
      clientId: client.id,
      clientPath: client.path,
      role: info.role,
      commands: info.analysis.commands.map((c) => c.name),
      manifestLink: s.autoLinks.some((l) => l.kind === 'manifest-client' && l.to === client.id),
    };
  });
  assert.equal(result.role, 'client');
  assert.deepEqual(result.commands, ['sit', 'stand']);
  assert.ok(result.manifestLink, 'fxmanifest → client.lua yarn');
  assert.equal(path.normalize(result.clientPath), path.join(resource, 'client.lua'));
  step('imported the sit script: client role, /sit and /stand, manifest yarn');

  await win.evaluate((id) => window.fiveboard.openEditor(id, 1), result.clientId);
  await win.waitForSelector('.CodeMirror-focused', { timeout: 10000 });
  await win.keyboard.type('-- saved from the FiveBoard smoke test\n');
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    window.fiveboard.run('editor:save');
  });
  await win.waitForFunction((id) => window.fiveboard.store.itemMap.get(id).dirty === false, result.clientId, { timeout: 10000 });
  const onDisk = fs.readFileSync(path.join(resource, 'client.lua'), 'utf8');
  assert.ok(onDisk.startsWith('-- saved from the FiveBoard smoke test'), 'edit written to disk');
  step('edited client.lua in the code editor and saved it to disk');

  if (shotPath) {
    await win.evaluate(() => window.fiveboard.run('view:fit'));
    await win.waitForTimeout(800);
    await win.screenshot({ path: shotPath });
    step(`screenshot saved to ${shotPath}`);
  }
  assert.deepEqual(errors, [], 'no errors in the app console');
  step('no console errors');
} finally {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
