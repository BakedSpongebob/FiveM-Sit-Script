// Runs the FiveM analyzer over every file card on the board whenever file contents change.
import { store, subscribe, setGraph } from './store.js';
import { buildGraph } from './fivem/analyzer.js';

let timer = null;

export function initAnalysis() {
  subscribe((changes) => {
    if (changes.has('content') || changes.has('board')) scheduleAnalysis(changes.has('board') ? 0 : 350);
  });
}

export function scheduleAnalysis(delay = 350) {
  clearTimeout(timer);
  timer = setTimeout(runAnalysis, delay);
}

export function runAnalysis() {
  clearTimeout(timer);
  if (!store.board) return;
  const files = [];
  const resourceCards = new Map();
  for (const it of store.board.items) {
    if (it.type === 'resource' && it.resourceId) resourceCards.set(it.resourceId, it.id);
    if (it.type !== 'file') continue;
    files.push({
      id: it.id,
      name: it.name,
      path: it.resRelPath || it.relPath || it.name,
      resourceId: it.resourceId || null,
      resourceName: it.resourceName || null,
      content: it.kind === 'binary' ? '' : it.content || '',
      lang: it.lang,
    });
  }
  const t0 = performance.now();
  const graph = buildGraph(files, { resourceCards });
  graph.ms = Math.round(performance.now() - t0);
  setGraph(graph, graph.links);
}
