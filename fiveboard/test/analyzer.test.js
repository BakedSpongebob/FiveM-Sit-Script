import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseManifest,
  analyzeScript,
  buildGraph,
  globToRegExp,
  inferRole,
  detectLanguage,
  stripLuaComments,
} from '../src/renderer/js/fivem/analyzer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

test('parses a modern fxmanifest', () => {
  const m = parseManifest(`
    fx_version 'cerulean'
    game 'gta5'
    lua54 'yes'
    author 'me'
    description "Test resource"
    version '1.2.0'

    shared_scripts { '@ox_lib/init.lua', 'config.lua' }
    client_scripts {
      'client/*.lua', -- all client files
    }
    server_script 'server/main.lua'
    ui_page 'html/index.html'
    files { 'html/index.html', 'html/**/*' }
    dependencies { 'oxmysql', 'ox_lib' }
    data_file 'DLC_ITYP_REQUEST' 'stream/props.ytyp'
    --[[ server_script 'ignored.lua' ]]
  `);
  assert.equal(m.fxVersion, 'cerulean');
  assert.deepEqual(m.games, ['gta5']);
  assert.equal(m.lua54, true);
  assert.equal(m.meta.description, 'Test resource');
  assert.deepEqual(m.shared.map((s) => s.value), ['@ox_lib/init.lua', 'config.lua']);
  assert.deepEqual(m.client.map((s) => s.value), ['client/*.lua']);
  assert.deepEqual(m.server.map((s) => s.value), ['server/main.lua']);
  assert.equal(m.uiPage, 'html/index.html');
  assert.deepEqual(m.dependencies.map((d) => d.value), ['oxmysql', 'ox_lib']);
  assert.deepEqual(m.dataFiles[0], { type: 'DLC_ITYP_REQUEST', path: 'stream/props.ytyp', line: 17 });
  assert.deepEqual(m.externalRefs, ['ox_lib']);
});

test('parses the sit script manifest in this repository', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'fxmanifest.lua'), 'utf8');
  const m = parseManifest(src);
  assert.equal(m.fxVersion, 'cerulean');
  assert.deepEqual(m.games, ['gta5']);
  assert.deepEqual(m.client.map((s) => s.value), ['client.lua']);
});

test('glob patterns follow FiveM rules', () => {
  assert.ok(globToRegExp('client/*.lua').test('client/main.lua'));
  assert.ok(!globToRegExp('client/*.lua').test('client/sub/main.lua'));
  assert.ok(globToRegExp('client/**/*.lua').test('client/sub/deep/main.lua'));
  assert.ok(globToRegExp('client/**/*.lua').test('client/main.lua'));
  assert.ok(globToRegExp('html/**').test('html/img/logo.png'));
  assert.ok(globToRegExp('Client.lua').test('client.lua'));
});

test('finds events, commands, callbacks and exports in Lua', () => {
  const a = analyzeScript(
    `
    -- TriggerServerEvent('commented:out')
    RegisterCommand('sit', function() TriggerServerEvent('sit:server:sat', 1) end, false)
    RegisterNetEvent('sit:client:notify', function(msg) end)
    AddEventHandler('onResourceStart', function(res) end)
    TriggerEvent('chat:addMessage', { args = { 'hi' } })
    TriggerServerEvent(GetCurrentResourceName() .. ':server:ping')
    ESX.TriggerServerCallback('shop:getItems', function(items) end)
    local time = lib.callback.await('clock:getTime', false)
    exports('IsSitting', function() return true end)
    local QBCore = exports['qb-core']:GetCoreObject()
    exports.ox_inventory:openInventory('stash', 'x')
    RegisterKeyMapping('+sit', 'Sit down', 'keyboard', 'X')
  `,
    { lang: 'lua', side: 'client', resourceName: 'sitter' },
  );
  assert.deepEqual(a.commands.map((c) => c.name), ['sit']);
  assert.deepEqual(
    a.triggers.map((t) => [t.name, t.kind]),
    [
      ['sit:server:sat', 'c2s'],
      ['sitter:server:ping', 'c2s'],
      ['chat:addMessage', 'local'],
    ],
  );
  assert.deepEqual(a.handlers.map((h) => h.name), ['sit:client:notify', 'onResourceStart']);
  assert.deepEqual(a.callbacksTriggered.map((c) => [c.name, c.fw]), [['shop:getItems', 'ESX'], ['clock:getTime', 'ox_lib']]);
  assert.deepEqual(a.exportsDefined.map((e) => e.name), ['IsSitting']);
  assert.deepEqual(a.exportsUsed.map((e) => `${e.resource}:${e.fn}`), ['qb-core:GetCoreObject', 'ox_inventory:openInventory']);
  assert.deepEqual(a.keymaps[0], { command: '+sit', description: 'Sit down', mapper: 'keyboard', key: 'X', line: 13 });
  assert.ok(a.frameworks.includes('QBCore'));
  assert.ok(a.frameworks.includes('ox_lib'));
});

test('flags common FiveM mistakes', () => {
  const server = analyzeScript(
    `
    CreateThread(function()
      while true do
        local ped = GetPlayerPed(-1)
      end
    end)
    TriggerServerEvent('oops')
  `,
    { lang: 'lua', side: 'server' },
  );
  const messages = server.hints.map((h) => h.message);
  assert.ok(messages.some((m) => m.startsWith('while true loop without Wait()')));
  assert.ok(messages.some((m) => m.startsWith('GetPlayerPed(-1)')));
  assert.ok(messages.some((m) => m.startsWith('TriggerServerEvent is client-only')));
  assert.ok(messages.some((m) => m.startsWith('PlayerPedId') === false));

  const ok = analyzeScript(
    `
    CreateThread(function()
      while true do
        if IsControlJustPressed(0, 38) then print('E') end
        Wait(0)
      end
    end)
  `,
    { lang: 'lua', side: 'client' },
  );
  assert.ok(!ok.hints.some((h) => h.level === 'warn'));
  assert.ok(ok.hints.some((h) => h.message.startsWith('Wait(0)')));
  assert.equal(ok.threads, 1);
});

test('detects NUI messages and callbacks on both sides', () => {
  const lua = analyzeScript(
    `
    local function setOpen(state)
      SetNuiFocus(state, state)
      SendNUIMessage({ action = state and 'open' or 'close' })
    end
    RegisterNUICallback('close', function(data, cb) setOpen(false) cb('ok') end)
  `,
    { lang: 'lua', side: 'client' },
  );
  assert.deepEqual(lua.nuiMessagesSent.map((m) => m.name), ['open', 'close']);
  assert.deepEqual(lua.nuiCallbacks.map((m) => m.name), ['close']);
  assert.deepEqual(lua.functions.map((f) => f.name), ['setOpen']);

  const js = analyzeScript(
    `
    window.addEventListener('message', (event) => {
      if (event.data.action === 'open') show();
      switch (event.data.action) { case 'close': hide(); break; }
    });
    fetch(\`https://\${GetParentResourceName()}/close\`, { method: 'POST' });
    $.post('https://myres/buy', JSON.stringify({}));
  `,
    { lang: 'javascript', side: 'nui' },
  );
  assert.deepEqual(js.nuiMessagesHandled.map((m) => m.name).sort(), ['close', 'open']);
  assert.deepEqual(js.nuiFetches.map((m) => m.name), ['close', 'buy']);
});

test('builds the cross-file graph for a resource', () => {
  const files = [
    {
      id: 'm', path: 'fxmanifest.lua', resourceId: 'r1', resourceName: 'shop',
      content: "fx_version 'cerulean'\ngame 'gta5'\nlua54 'yes'\nclient_script 'client/main.lua'\nserver_script 'server/main.lua'\nui_page 'html/index.html'\nfiles { 'html/*' }",
    },
    {
      id: 'c', path: 'client/main.lua', resourceId: 'r1', resourceName: 'shop',
      content: "RegisterCommand('shop', function() SendNUIMessage({ action = 'open' }) TriggerServerEvent('shop:server:buy', 'water') end)\nRegisterNetEvent('shop:client:bought', function() end)\nRegisterNUICallback('close', function(_, cb) cb(1) end)",
    },
    {
      id: 's', path: 'server/main.lua', resourceId: 'r1', resourceName: 'shop',
      content: "RegisterNetEvent('shop:server:buy', function(item) TriggerClientEvent('shop:client:bought', source, item) end)\nRegisterNetEvent('shop:server:never', function() end)",
    },
    { id: 'h', path: 'html/index.html', resourceId: 'r1', resourceName: 'shop', content: '<script src="app.js"></script>' },
    {
      id: 'j', path: 'html/app.js', resourceId: 'r1', resourceName: 'shop',
      content: "window.addEventListener('message', (e) => { if (e.data.action === 'open') {} });\nfetch(`https://${GetParentResourceName()}/close`)",
    },
    { id: 'x', path: 'client/unused.lua', resourceId: 'r1', resourceName: 'shop', content: 'print(1)' },
  ];
  const g = buildGraph(files);
  const kinds = g.links.map((l) => `${l.kind}:${l.from}->${l.to}`).sort();
  assert.deepEqual(kinds, [
    'event-c2s:c->s',
    'event-s2c:s->c',
    'include:h->j',
    'manifest-client:m->c',
    'manifest-server:m->s',
    'manifest-ui:m->h',
    'nui-callback:j->c',
    'nui-message:c->j',
  ]);
  assert.equal(g.files.get('c').role, 'client');
  assert.equal(g.files.get('s').role, 'server');
  assert.equal(g.files.get('j').role, 'nui');
  assert.equal(g.files.get('x').unloaded, true);
  const shop = g.resources.get('r1');
  assert.deepEqual(shop.commands.map((c) => c.name), ['shop']);
  assert.equal(shop.manifest.fxVersion, 'cerulean');
  assert.ok(!shop.hints.some((h) => h.level === 'warn'), JSON.stringify(shop.hints));
});

test('analyzes the real sit script from this repository', () => {
  const manifest = fs.readFileSync(path.join(repoRoot, 'fxmanifest.lua'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'client.lua'), 'utf8');
  const g = buildGraph([
    { id: 'm', path: 'fxmanifest.lua', resourceId: 'sit', resourceName: 'FiveM-Sit-Script', content: manifest },
    { id: 'c', path: 'client.lua', resourceId: 'sit', resourceName: 'FiveM-Sit-Script', content: client },
  ]);
  const c = g.files.get('c');
  assert.equal(c.role, 'client');
  assert.deepEqual(c.analysis.commands.map((x) => x.name), ['sit', 'stand']);
  assert.ok(c.analysis.natives.some((n) => n.name === 'TaskStartScenarioInPlace'));
  assert.ok(g.links.some((l) => l.kind === 'manifest-client' && l.from === 'm' && l.to === 'c'));
  assert.ok(g.resources.get('sit').hints.some((h) => h.message.startsWith("lua54 'yes'")));
});

test('role inference and language detection', () => {
  assert.equal(inferRole('client/cl_main.lua', 'lua'), 'client');
  assert.equal(inferRole('server/sv_db.lua', 'lua'), 'server');
  assert.equal(inferRole('config.lua', 'lua'), 'config');
  assert.equal(inferRole('web/src/App.tsx', 'tsx'), 'nui');
  assert.equal(inferRole('sql/install.sql', 'sql'), 'sql');
  assert.equal(inferRole('data/vehicles.meta', 'xml'), 'meta');
  assert.equal(detectLanguage('server.cfg'), 'cfg');
  assert.equal(detectLanguage('handling.meta'), 'xml');
  assert.equal(detectLanguage('fxmanifest.lua'), 'lua');
});

test('comment stripping keeps line numbers', () => {
  const src = "a = 1 -- comment\n--[[ block\ncomment ]] b = '--not a comment'\n";
  const out = stripLuaComments(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes("'--not a comment'"));
  assert.ok(!out.includes('block'));
});

test('resource templates analyze cleanly (no warnings, full round trip)', async () => {
  const { SCAFFOLDS, fillTemplate } = await import('../src/renderer/js/fivem/snippets.js');
  for (const tpl of SCAFFOLDS) {
    const files = tpl.files.map((f, i) => ({ id: `f${i}`, path: f.relPath, resourceId: 'r', resourceName: 'demo', content: fillTemplate(f.content, 'demo') }));
    const g = buildGraph(files);
    const warns = g.problems.filter((p) => p.level === 'warn');
    assert.deepEqual(warns, [], `${tpl.id} template should have no warnings`);
    const id = (rel) => files.find((f) => f.path === rel).id;
    const has = (kind, from, to) => g.links.some((l) => l.kind === kind && l.from === id(from) && l.to === id(to));
    assert.ok(has('event-c2s', 'client/main.lua', 'server/main.lua'), `${tpl.id}: client → server`);
    assert.ok(has('event-s2c', 'server/main.lua', 'client/main.lua'), `${tpl.id}: server → client`);
    if (tpl.id === 'nui') {
      assert.ok(has('nui-callback', 'html/script.js', 'client/main.lua'));
      assert.ok(has('nui-message', 'client/main.lua', 'html/script.js'));
    }
  }
});
