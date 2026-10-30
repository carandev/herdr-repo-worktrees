/** Pure state, reducer and renderer for the "open worktree" picker (filter + list). No I/O. */

import nodePath from 'node:path';
import { filterWorktrees } from './open-worktree.mjs';

const LABEL_W = 9;

/** Starts on the first linked worktree that is not open yet (the likely target), else the first. */
export function createPicker({ items, repoRoot, repoName = '', pathApi = nodePath }) {
  const start = items.findIndex((i) => i.linked && !i.openWorkspaceId);
  return { items, repoRoot, repoName, pathApi, query: '', index: Math.max(0, start), status: '' };
}

export const setStatus = (state, status) => ({ ...state, status });

export const visibleItems = (state) => filterWorktrees(state.items, state.query);

export const selected = (state) => visibleItems(state)[state.index];

const filtered = (state, query) => ({ ...state, query, index: 0, status: '' });

/** `update(state, key) -> { state, effect? }`; effect is 'submit' or 'cancel'. */
export function update(state, key) {
  const count = visibleItems(state).length;
  switch (key.name) {
    case 'char':
      return { state: filtered(state, state.query + key.ch) };
    case 'backspace':
      return { state: state.query ? filtered(state, state.query.slice(0, -1)) : state };
    case 'ctrl-u':
      return { state: filtered(state, '') };
    case 'down':
    case 'tab':
      return { state: { ...state, index: Math.min(state.index + 1, Math.max(0, count - 1)) } };
    case 'up':
    case 'shift-tab':
      return { state: { ...state, index: Math.max(state.index - 1, 0) } };
    case 'enter':
      if (!count) return { state: setStatus(state, 'No matching worktree') };
      return { state: setStatus(state, ''), effect: 'submit' };
    case 'escape':
      if (state.query) return { state: filtered(state, '') };
      return { state, effect: 'cancel' };
    case 'ctrl-c':
      return { state, effect: 'cancel' };
    default:
      return { state };
  }
}

const fit = (s, n) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Path shown for an item: relative to the repo root when inside it (`.` for the root), else absolute. */
function displayPath(state, item) {
  const { pathApi } = state;
  const rel = pathApi.relative(pathApi.resolve(state.repoRoot), item.path);
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) return item.path;
  return rel;
}

/** `render(state, { columns, rows, color }) -> { text, cursor: { row, col } }` (1-based cursor). */
export function render(state, { columns = 80, rows = 24, color = true } = {}) {
  const W = Math.max(30, columns - 1);
  const IW = W - 4;
  const sgr = (code, t) => (color && t ? `\x1b[${code}m${t}\x1b[0m` : t);
  const row = (parts) => {
    const used = parts.reduce((n, p) => n + p.t.length, 0);
    return `│ ${parts.map((p) => (p.st ? sgr(p.st, p.t) : p.t)).join('')}${' '.repeat(Math.max(0, IW - used))} │`;
  };
  const lines = [];
  const title = fit(state.repoName ? `Open worktree · ${state.repoName}` : 'Open worktree', W - 6);
  lines.push(`╭─ ${sgr('1', title)} ${'─'.repeat(Math.max(0, W - 5 - title.length))}╮`);
  const query = fit(state.query, IW - LABEL_W - 1);
  lines.push(row([{ t: 'Filter'.padEnd(LABEL_W), st: '1;36' }, { t: query }]));
  const cursor = { row: lines.length, col: 3 + LABEL_W + query.length };
  lines.push(row([]));

  const list = visibleItems(state);
  if (!list.length) {
    lines.push(row([{ t: state.items.length ? 'No matching worktree' : 'No worktrees', st: '2' }]));
  } else {
    const maxRows = Math.max(3, rows - 8);
    const start = Math.min(Math.max(0, state.index - maxRows + 1), Math.max(0, list.length - maxRows));
    const branchW = Math.min(Math.max(...list.map((i) => (i.branch ?? '(detached)').length)), Math.floor(IW / 2));
    list.slice(start, start + maxRows).forEach((item, k) => {
      const isSel = start + k === state.index;
      const branch = fit(item.branch ?? '(detached)', branchW).padEnd(branchW);
      const mark = item.openWorkspaceId ? '  open' : '';
      const where = fit(displayPath(state, item), IW - 2 - branchW - 2 - mark.length);
      lines.push(row([
        { t: isSel ? '▸ ' : '  ', st: '1;36' },
        { t: branch, st: isSel ? '1;36' : '' },
        { t: '  ' },
        { t: where, st: '2' },
        { t: mark, st: '32' },
      ]));
    });
  }
  lines.push(row([]));
  lines.push(row([{ t: fit(state.status, IW), st: '31' }]));
  lines.push(`╰${'─'.repeat(W - 2)}╯`);
  lines.push(sgr('2', fit(' Type to filter · ↑↓ pick · Enter open · Esc clear/cancel', W)));
  return { text: lines.join('\r\n'), cursor };
}
