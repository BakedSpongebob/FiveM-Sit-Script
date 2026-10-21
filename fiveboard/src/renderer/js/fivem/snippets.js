// FiveM starter templates. `{{name}}` is replaced with the resource name.

const manifestBasic = `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '{{name}}'
description 'A new FiveM resource'
author 'You'
version '1.0.0'

shared_scripts {
    'config.lua',
}

client_scripts {
    'client/*.lua',
}

server_scripts {
    'server/*.lua',
}
`;

const manifestNui = `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '{{name}}'
description 'A FiveM resource with an NUI page'
author 'You'
version '1.0.0'

shared_scripts {
    'config.lua',
}

client_scripts {
    'client/*.lua',
}

server_scripts {
    'server/*.lua',
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
}
`;

const config = `Config = {}

Config.Debug = false
Config.Command = '{{name}}'
Config.Location = vector3(-268.5, -957.8, 31.2)
`;

const clientMain = `-- Runs on every player's game client.

local function notify(message)
    TriggerEvent('chat:addMessage', {
        color = { 120, 180, 255 },
        args = { '{{name}}', message },
    })
end

RegisterCommand(Config.Command, function(source, args)
    -- Ask the server to do something; the server decides if it is allowed.
    TriggerServerEvent('{{name}}:server:hello', args[1])
end, false)

RegisterNetEvent('{{name}}:client:reply', function(message)
    notify(message)
end)
`;

const serverMain = `-- Runs once on the server.

RegisterNetEvent('{{name}}:server:hello', function(text)
    local src = source
    -- Never trust data from clients: validate types and values here.
    if type(text) ~= 'string' then text = 'there' end

    local reply = ('Hello %s, you said: %s'):format(GetPlayerName(src), text)
    TriggerClientEvent('{{name}}:client:reply', src, reply)
end)

AddEventHandler('onResourceStart', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then return end
    print(('[%s] started'):format(resourceName))
end)
`;

const clientNui = `-- Opens and closes the NUI page in html/.

local isOpen = false

local function setOpen(state)
    isOpen = state
    SetNuiFocus(state, state)
    SendNUIMessage({ action = state and 'open' or 'close' })
end

RegisterCommand(Config.Command, function()
    setOpen(not isOpen)
end, false)

RegisterNUICallback('close', function(data, cb)
    setOpen(false)
    cb('ok')
end)

-- The page asks Lua to say hello; Lua forwards it to the server.
RegisterNUICallback('hello', function(data, cb)
    TriggerServerEvent('{{name}}:server:hello', data.text)
    cb('ok')
end)

-- The server's reply is passed back to the page.
RegisterNetEvent('{{name}}:client:reply', function(message)
    SendNUIMessage({ action = 'reply', text = message })
end)
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="app" class="hidden">
        <h1>{{name}}</h1>
        <p>Press <kbd>Esc</kbd> to close.</p>
        <p id="reply"></p>
        <button id="hello">Say hello</button>
        <button id="close">Close</button>
    </div>
    <script src="script.js"></script>
</body>
</html>
`;

const css = `* { box-sizing: border-box; }

body {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: transparent;
}

#app {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 24px 32px;
    border-radius: 12px;
    background: rgba(24, 25, 28, 0.92);
    color: #eee;
}

.hidden { display: none; }
`;

const js = `const app = document.getElementById('app');
const reply = document.getElementById('reply');

// Messages sent from Lua with SendNUIMessage arrive here.
window.addEventListener('message', (event) => {
    const data = event.data;
    if (data.action === 'open') app.classList.remove('hidden');
    if (data.action === 'close') app.classList.add('hidden');
    if (data.action === 'reply') reply.textContent = data.text;
});

// Calls a RegisterNUICallback handler in the client script.
function fetchNui(name, payload = {}) {
    return fetch(\`https://\${GetParentResourceName()}/\${name}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
    });
}

document.getElementById('hello').addEventListener('click', () => fetchNui('hello', { text: 'hi from the NUI' }));
document.getElementById('close').addEventListener('click', () => fetchNui('close'));
document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape') fetchNui('close');
});
`;

export const SCAFFOLDS = [
  {
    id: 'basic',
    title: 'Client + server resource',
    description: 'fxmanifest, config, a command, a client → server → client event round trip',
    files: [
      { relPath: 'fxmanifest.lua', content: manifestBasic },
      { relPath: 'config.lua', content: config },
      { relPath: 'client/main.lua', content: clientMain },
      { relPath: 'server/main.lua', content: serverMain },
    ],
  },
  {
    id: 'nui',
    title: 'Resource with NUI page',
    description: 'Everything above plus an HTML/CSS/JS interface wired with SendNUIMessage and RegisterNUICallback',
    files: [
      { relPath: 'fxmanifest.lua', content: manifestNui },
      { relPath: 'config.lua', content: config },
      { relPath: 'client/main.lua', content: clientNui },
      { relPath: 'server/main.lua', content: serverMain },
      { relPath: 'html/index.html', content: html },
      { relPath: 'html/style.css', content: css },
      { relPath: 'html/script.js', content: js },
    ],
  },
];

export const SNIPPETS = [
  {
    id: 'thread-marker',
    title: 'Marker + interaction loop',
    category: 'Client',
    file: 'marker.lua',
    content: `-- Draws a marker near a location and reacts to E, sleeping when the player is far away.
local location = vector3(-268.5, -957.8, 31.2)

CreateThread(function()
    while true do
        local sleep = 1000
        local coords = GetEntityCoords(PlayerPedId())
        local distance = #(coords - location)

        if distance < 20.0 then
            sleep = 0
            DrawMarker(2, location.x, location.y, location.z, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.3, 0.3, 255, 255, 255, 160, false, true, 2, false, nil, nil, false)

            if distance < 1.5 and IsControlJustPressed(0, 38) then -- 38 = E
                TriggerServerEvent('myresource:server:interact')
            end
        end

        Wait(sleep)
    end
end)
`,
  },
  {
    id: 'blip',
    title: 'Map blip',
    category: 'Client',
    file: 'blip.lua',
    content: `CreateThread(function()
    local blip = AddBlipForCoord(-268.5, -957.8, 31.2)
    SetBlipSprite(blip, 52)
    SetBlipColour(blip, 2)
    SetBlipScale(blip, 0.8)
    SetBlipAsShortRange(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName('My Shop')
    EndTextCommandSetBlipName(blip)
end)
`,
  },
  {
    id: 'spawn-vehicle',
    title: 'Spawn a vehicle (client)',
    category: 'Client',
    file: 'vehicle.lua',
    content: `local function spawnVehicle(modelName)
    local model = joaat(modelName)
    if not IsModelInCdimage(model) or not IsModelAVehicle(model) then
        return print(('Unknown vehicle model: %s'):format(modelName))
    end

    RequestModel(model)
    while not HasModelLoaded(model) do Wait(0) end

    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    local vehicle = CreateVehicle(model, coords.x, coords.y, coords.z, GetEntityHeading(ped), true, false)
    TaskWarpPedIntoVehicle(ped, vehicle, -1)
    SetModelAsNoLongerNeeded(model)
    return vehicle
end

RegisterCommand('car', function(_, args)
    spawnVehicle(args[1] or 'adder')
end, false)
`,
  },
  {
    id: 'animation',
    title: 'Play an animation',
    category: 'Client',
    file: 'anim.lua',
    content: `local function playAnim(dict, name, duration, flag)
    RequestAnimDict(dict)
    while not HasAnimDictLoaded(dict) do Wait(0) end
    TaskPlayAnim(PlayerPedId(), dict, name, 8.0, -8.0, duration or -1, flag or 49, 0.0, false, false, false)
    RemoveAnimDict(dict)
end

RegisterCommand('wave', function()
    playAnim('friends@frj@ig_1', 'wave_a', 3000, 49)
end, false)
`,
  },
  {
    id: 'keymapping',
    title: 'Rebindable key (RegisterKeyMapping)',
    category: 'Client',
    file: 'keybind.lua',
    content: `-- Players can rebind this in Settings → Key Bindings → FiveM.
RegisterCommand('+myaction', function()
    print('pressed')
end, false)

RegisterCommand('-myaction', function()
    print('released')
end, false)

RegisterKeyMapping('+myaction', 'Do my action', 'keyboard', 'F7')
`,
  },
  {
    id: 'statebag',
    title: 'State bags (sync data)',
    category: 'Shared',
    file: 'statebags.lua',
    content: `-- Server: attach replicated data to a player.
-- Player(source).state:set('job', 'police', true)

-- Client: read it or react to changes.
AddStateBagChangeHandler('job', nil, function(bagName, key, value)
    local player = GetPlayerFromStateBagName(bagName)
    if player ~= PlayerId() then return end
    print(('My job is now %s'):format(value))
end)

print(LocalPlayer.state.job)
`,
  },
  {
    id: 'server-event',
    title: 'Validated server event',
    category: 'Server',
    file: 'server_event.lua',
    content: `RegisterNetEvent('myresource:server:buy', function(item, amount)
    local src = source
    -- Validate everything the client sends: type, range, distance, permissions.
    if type(item) ~= 'string' or type(amount) ~= 'number' then return end
    amount = math.floor(amount)
    if amount < 1 or amount > 10 then return end

    local ped = GetPlayerPed(src)
    local coords = GetEntityCoords(ped)
    if #(coords - vector3(-268.5, -957.8, 31.2)) > 10.0 then
        return print(('[%s] %s tried to buy from too far away'):format(GetCurrentResourceName(), GetPlayerName(src)))
    end

    TriggerClientEvent('myresource:client:bought', src, item, amount)
end)
`,
  },
  {
    id: 'ace-command',
    title: 'Admin-only command (ACE)',
    category: 'Server',
    file: 'admin.lua',
    content: `-- server.cfg: add_ace group.admin command.announce allow
RegisterCommand('announce', function(source, args)
    local message = table.concat(args, ' ')
    TriggerClientEvent('chat:addMessage', -1, { color = { 255, 80, 80 }, args = { 'Announcement', message } })
end, true) -- true = restricted to players with the ACE permission
`,
  },
  {
    id: 'oxmysql',
    title: 'oxmysql queries',
    category: 'Server',
    file: 'database.lua',
    content: `-- fxmanifest: server_script '@oxmysql/lib/MySQL.lua'

local function getPlayerRow(identifier)
    return MySQL.single.await('SELECT * FROM users WHERE identifier = ?', { identifier })
end

local function addMoney(identifier, amount)
    return MySQL.update.await('UPDATE users SET money = money + ? WHERE identifier = ?', { amount, identifier })
end
`,
  },
  {
    id: 'esx',
    title: 'ESX: player + callback',
    category: 'Framework',
    file: 'esx_server.lua',
    content: `local ESX = exports['es_extended']:getSharedObject()

ESX.RegisterServerCallback('myresource:getMoney', function(source, cb)
    local xPlayer = ESX.GetPlayerFromId(source)
    cb(xPlayer and xPlayer.getMoney() or 0)
end)

-- Client side:
-- ESX.TriggerServerCallback('myresource:getMoney', function(money) print(money) end)
`,
  },
  {
    id: 'qbcore',
    title: 'QBCore: player + callback',
    category: 'Framework',
    file: 'qb_server.lua',
    content: `local QBCore = exports['qb-core']:GetCoreObject()

QBCore.Functions.CreateCallback('myresource:server:getCitizenId', function(source, cb)
    local Player = QBCore.Functions.GetPlayer(source)
    cb(Player and Player.PlayerData.citizenid or nil)
end)

-- Client side:
-- QBCore.Functions.TriggerCallback('myresource:server:getCitizenId', function(cid) print(cid) end)
`,
  },
  {
    id: 'oxlib',
    title: 'ox_lib: callback + notify',
    category: 'Framework',
    file: 'oxlib.lua',
    content: `-- fxmanifest: shared_script '@ox_lib/init.lua'

-- Server
lib.callback.register('myresource:getTime', function(source)
    return os.time()
end)

-- Client
-- local time = lib.callback.await('myresource:getTime', false)
-- lib.notify({ title = 'Server time', description = tostring(time), type = 'inform' })
`,
  },
  {
    id: 'export',
    title: 'Export a function',
    category: 'Shared',
    file: 'exports.lua',
    content: `-- In this resource:
exports('IsBusy', function()
    return false
end)

-- From another resource:
-- local busy = exports['myresource']:IsBusy()
`,
  },
  {
    id: 'server-cfg',
    title: 'server.cfg starter',
    category: 'Config',
    file: 'server.cfg',
    content: `# Network endpoints
endpoint_add_tcp "0.0.0.0:30120"
endpoint_add_udp "0.0.0.0:30120"

sv_hostname "My FiveM Server"
sv_maxclients 48
sets tags "roleplay, default"

# Default resources
ensure mapmanager
ensure chat
ensure spawnmanager
ensure sessionmanager
ensure basic-gamemode
ensure hardcap

# Your resources
ensure myresource

# Permissions
add_ace group.admin command allow
# add_principal identifier.fivem:1234567 group.admin

# sv_licenseKey "changeme"
`,
  },
];

export function fillTemplate(text, name) {
  return text.split('{{name}}').join(name);
}
