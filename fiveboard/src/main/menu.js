import { app, BrowserWindow, Menu, dialog, shell } from 'electron';

// Single-letter board shortcuts are handled by the renderer; the menu only displays them.
const hint = (accelerator) => ({ accelerator, registerAccelerator: false });

export function buildMenu(send) {
  const isMac = process.platform === 'darwin';
  const cmd = (command, payload) => () => send(command, payload);

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: cmd('help:shortcuts') },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Board', accelerator: 'CmdOrCtrl+N', click: cmd('board:new') },
        { label: 'Open Board File…', accelerator: 'CmdOrCtrl+O', click: cmd('board:import') },
        { label: 'Export Board…', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('board:export') },
        { type: 'separator' },
        { label: 'Import Folder / Resource…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('workspace:import') },
        { label: 'Add Files…', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('files:add') },
        { label: 'Rescan Workspaces', accelerator: 'CmdOrCtrl+Shift+R', click: cmd('workspace:rescan') },
        { type: 'separator' },
        { label: 'Save File', accelerator: 'CmdOrCtrl+S', click: cmd('editor:save') },
        { label: 'Save All Files', accelerator: 'CmdOrCtrl+Alt+S', click: cmd('editor:saveAll') },
        { label: 'Close Editor Tab', accelerator: 'CmdOrCtrl+W', click: cmd('editor:closeTab') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: cmd('items:duplicate') },
        { label: 'Delete Selection', ...hint('Backspace'), click: cmd('items:delete') },
        { label: 'Group Selection in Frame', accelerator: 'CmdOrCtrl+G', click: cmd('items:group') },
        { label: 'Connect Selection with Yarn', accelerator: 'CmdOrCtrl+L', click: cmd('items:connect') },
        { type: 'separator' },
        { label: 'Search Board…', accelerator: 'CmdOrCtrl+K', click: cmd('search:open') },
        { label: 'Search in Files…', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search:files') },
      ],
    },
    {
      label: 'Insert',
      submenu: [
        { label: 'Sticky Note', ...hint('N'), click: cmd('insert:note') },
        { label: 'Text', ...hint('T'), click: cmd('insert:text') },
        { label: 'Checklist', ...hint('L'), click: cmd('insert:checklist') },
        { label: 'Frame', ...hint('G'), click: cmd('insert:frame') },
        { label: 'Link…', ...hint('U'), click: cmd('insert:link') },
        { label: 'Image…', ...hint('I'), click: cmd('insert:image') },
        { type: 'separator' },
        { label: 'New FiveM Resource…', accelerator: 'CmdOrCtrl+Shift+N', click: cmd('fivem:scaffold') },
        { label: 'FiveM Snippet…', accelerator: 'CmdOrCtrl+Shift+I', click: cmd('fivem:snippet') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: cmd('view:zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: cmd('view:zoomOut') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: cmd('view:zoomReset') },
        { label: 'Zoom to Fit', accelerator: 'CmdOrCtrl+1', click: cmd('view:fit') },
        { label: 'Zoom to Selection', accelerator: 'CmdOrCtrl+2', click: cmd('view:fitSelection') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: cmd('view:sidebar') },
        { label: 'Toggle Inspector', accelerator: 'CmdOrCtrl+I', click: cmd('view:inspector') },
        { label: 'Toggle Code Editor', accelerator: 'CmdOrCtrl+E', click: cmd('view:editor') },
        { label: 'Toggle Minimap', accelerator: 'CmdOrCtrl+M', click: cmd('view:minimap') },
        { type: 'separator' },
        { label: 'Yarn: Pinned (classic, on top)', click: cmd('view:yarnStyle', 'pinned') },
        { label: 'Yarn: Clean (behind cards)', click: cmd('view:yarnStyle', 'clean') },
        { type: 'separator' },
        { label: 'Theme: Graphite', click: cmd('view:theme', 'dark') },
        { label: 'Theme: Silver', click: cmd('view:theme', 'light') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Developer',
          submenu: [
            { role: 'reload', accelerator: 'CmdOrCtrl+Alt+R' },
            { role: 'toggleDevTools' },
          ],
        },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: cmd('help:shortcuts') }, { type: 'separator' }]),
        { label: 'FiveM Documentation', click: () => shell.openExternal('https://docs.fivem.net/docs/') },
        { label: 'FiveM Natives Reference', click: () => shell.openExternal('https://docs.fivem.net/natives/') },
        { label: 'Cfx.re Forum', click: () => shell.openExternal('https://forum.cfx.re/') },
        ...(isMac
          ? []
          : [
              { type: 'separator' },
              {
                label: 'About FiveBoard',
                click: () => dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
                  title: 'About FiveBoard',
                  message: 'FiveBoard',
                  detail: `Version ${app.getVersion()}\nA planning board and code space for FiveM scripting.`,
                }),
              },
            ]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
