// First-run board that explains the basics using the board itself.
import { uid } from './util.js';

export function welcomeBoard(board) {
  const title = { id: uid('t'), type: 'text', x: -40, y: -330, w: 620, h: 64, z: 1, text: 'Welcome to FiveBoard', size: 'xl', color: 'grey' };
  const subtitle = { id: uid('t'), type: 'text', x: -40, y: -262, w: 720, h: 36, z: 2, text: 'A planning board and code space for FiveM scripting.', size: 'm', color: 'grey' };
  const basics = {
    id: uid('n'), type: 'note', x: -40, y: -170, w: 330, h: 250, z: 3, color: 'yellow',
    text: 'The basics\n\n• Double-click empty space → sticky note\n• Drag a card’s pin onto another card → yarn\n• Scroll to pan · pinch or ⌘-scroll to zoom\n• Right-click anything for options',
  };
  const drop = {
    id: uid('n'), type: 'note', x: 350, y: -150, w: 340, h: 280, z: 4, color: 'blue',
    text: 'Map out your code\n\nDrag a resource folder — or your whole server resources/ folder — onto the board (or press ⇧⌘O).\n\nFolders become frames, files become cards, and colored yarn shows manifests, events, callbacks, NUI and exports.',
  };
  const checklist = {
    id: uid('k'), type: 'checklist', x: 760, y: -170, w: 300, h: 230, z: 5, title: 'Getting started', color: 'green',
    entries: [
      { id: uid('c'), text: 'Import a FiveM resource folder (⇧⌘O)', done: false },
      { id: uid('c'), text: 'Double-click a file card to edit it', done: false },
      { id: uid('c'), text: 'Search events & code with ⌘K', done: false },
      { id: uid('c'), text: 'Create a resource from a template (⇧⌘N)', done: false },
      { id: uid('c'), text: 'Export it into your server’s resources folder', done: false },
    ],
  };
  const ideas = {
    id: uid('n'), type: 'note', x: 140, y: 200, w: 320, h: 190, z: 6, color: 'pink',
    text: 'Ideas for the sit script\n\n- /sit on chairs and benches, not just the floor\n- Pick a sit animation\n- Keybind with RegisterKeyMapping',
  };
  const tip = {
    id: uid('n'), type: 'note', x: 580, y: 210, w: 330, h: 200, z: 7, color: 'grey',
    text: 'Tip\n\nSelect a file card to see its FiveM details in the inspector: events it handles and triggers, commands, NUI callbacks, natives used and problems found.',
  };
  const yarn = (from, to, color = '#e5484d', label = '') => ({ id: uid('l'), from: from.id, to: to.id, color, label, style: 'solid' });
  return {
    ...board,
    name: 'Welcome',
    viewport: { x: 160, y: 420, zoom: 0.82 },
    items: [title, subtitle, basics, drop, checklist, ideas, tip],
    links: [yarn(basics, drop), yarn(drop, checklist, '#e5484d', 'then'), yarn(ideas, tip, '#d6409f')],
  };
}
