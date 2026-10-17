/** Pure state, reducer and renderer for the "new workspace" form (Directory, Label). No I/O. */

import nodePath from 'node:path';
import { applyDirectorySuggestion, lastSeparatorIndex } from './workspace.mjs';

export const FIELDS = ['directory', 'label'];
const LABELS = ['Directory', 'Label'];
const LABEL_W = 11;

export function createWorkspaceForm({ directory = '', pathApi = nodePath } = {}) {
  return {
    pathApi,
    values: { directory, label: '' },
    cursors: { directory: directory.length, label: 0 },
    focus: 0,
    highlight: -1,
    suggestions: { forValue: null, list: [] },
    status: '',
  };
}

export const setStatus = (state, status) => ({ ...state, status });

/** Stores ranked subdirectory names for `forValue`; ignored when the Directory text has moved on. */
export function setSuggestions(state, forValue, list) {
  if (forValue !== state.values.directory) return state;
  return { ...state, suggestions: { forValue, list: [...list] }, highlight: -1 };
}

const lastSegment = (state) => {
  const text = state.values.directory;
  return text.slice(lastSeparatorIndex(text, state.pathApi) + 1);
};

/** Suggestions shown under Directory (only while it is focused and the list is current). */
export function suggestionsFor(state) {
  if (FIELDS[state.focus] !== 'directory') return [];
  if (state.suggestions.forValue !== state.values.directory) return [];
  const { list } = state.suggestions;
  return list.length === 1 && list[0] === lastSegment(state) ? [] : list;
}

function edited(state, field, value, cursor) {
  return {
    ...state,
    values: { ...state.values, [field]: value },
    cursors: { ...state.cursors, [field]: cursor },
    highlight: -1,
    status: '',
  };
}
const moved = (state, field, cursor) => ({ ...state, cursors: { ...state.cursors, [field]: cursor } });
const focused = (state, focus) => ({ ...state, focus, highlight: -1 });

function acceptTarget(state) {
  const list = suggestionsFor(state);
  if (!list.length) return undefined;
  if (state.highlight >= 0) return list[Math.min(state.highlight, list.length - 1)];
  return list[0] === lastSegment(state) ? undefined : list[0];
}

const accept = (state, name) => {
  const text = applyDirectorySuggestion({ input: state.values.directory, name, pathApi: state.pathApi });
  return edited(state, 'directory', text, text.length);
};

function submit(state) {
  if (!state.values.directory.trim()) return { state: { ...state, focus: 0, status: 'Directory is required' } };
  return { state: { ...state, status: '' }, effect: 'submit' };
}

/** `update(state, key) -> { state, effect? }`; effect is 'submit' or 'cancel'. */
export function update(state, key) {
  const field = FIELDS[state.focus];
  const text = state.values[field];
  const cur = state.cursors[field];
  const list = suggestionsFor(state);
  switch (key.name) {
    case 'char':
      return { state: edited(state, field, text.slice(0, cur) + key.ch + text.slice(cur), cur + key.ch.length) };
    case 'backspace':
      return { state: cur > 0 ? edited(state, field, text.slice(0, cur - 1) + text.slice(cur), cur - 1) : state };
    case 'delete':
      return { state: cur < text.length ? edited(state, field, text.slice(0, cur) + text.slice(cur + 1), cur) : state };
    case 'ctrl-u':
      return { state: edited(state, field, '', 0) };
    case 'left':
      return { state: moved(state, field, Math.max(0, cur - 1)) };
    case 'right': {
      const target = cur === text.length ? acceptTarget(state) : undefined;
      if (target !== undefined) return { state: accept(state, target) };
      return { state: moved(state, field, Math.min(text.length, cur + 1)) };
    }
    case 'home':
    case 'ctrl-a':
      return { state: moved(state, field, 0) };
    case 'end':
    case 'ctrl-e':
      return { state: moved(state, field, text.length) };
    case 'tab': {
      const target = acceptTarget(state);
      if (target !== undefined) return { state: accept(state, target) };
      return { state: focused(state, (state.focus + 1) % FIELDS.length) };
    }
    case 'shift-tab':
      return { state: focused(state, (state.focus + FIELDS.length - 1) % FIELDS.length) };
    case 'down':
      if (list.length) return { state: { ...state, highlight: Math.min(state.highlight + 1, list.length - 1) } };
      return { state: focused(state, Math.min(state.focus + 1, FIELDS.length - 1)) };
    case 'up':
      if (list.length && state.highlight >= 0) return { state: { ...state, highlight: state.highlight - 1 } };
      return { state: focused(state, Math.max(state.focus - 1, 0)) };
    case 'enter':
      if (list.length && state.highlight >= 0) return { state: accept(state, list[Math.min(state.highlight, list.length - 1)]) };
      if (state.focus < FIELDS.length - 1) return { state: focused(state, state.focus + 1) };
      return submit(state);
    case 'ctrl-s':
      return submit(state);
    case 'escape':
      if (state.highlight >= 0) return { state: { ...state, highlight: -1 } };
      return { state, effect: 'cancel' };
    case 'ctrl-c':
      return { state, effect: 'cancel' };
    default:
      return { state };
  }
}

const fit = (s, n) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Visible slice of `value` for a field `w` cells wide, keeping the cursor in view. */
function scrollWindow(value, cursor, w) {
  if (value.length <= w - 1) return { text: value, col: cursor };
  const n = w - 1;
  const start = Math.max(0, cursor - n + 1);
  let text = value.slice(start, start + n);
  if (start > 0) text = `…${text.slice(1)}`;
  if (start + n < value.length) text = `${text.slice(0, -1)}…`;
  return { text, col: cursor - start };
}

/** `render(state, { columns, color }) -> { text, cursor: { row, col } }` (1-based cursor). */
export function render(state, { columns = 80, color = true } = {}) {
  const W = Math.max(30, columns - 1);
  const IW = W - 4;
  const VW = IW - LABEL_W;
  const sgr = (code, t) => (color && t ? `\x1b[${code}m${t}\x1b[0m` : t);
  const row = (parts) => {
    const used = parts.reduce((n, p) => n + p.t.length, 0);
    return `│ ${parts.map((p) => (p.st ? sgr(p.st, p.t) : p.t)).join('')}${' '.repeat(Math.max(0, IW - used))} │`;
  };
  const lines = [];
  let cursor = { row: 2, col: 3 + LABEL_W };
  const suggestions = suggestionsFor(state);

  const title = 'New workspace';
  lines.push(`╭─ ${sgr('1', title)} ${'─'.repeat(W - 5 - title.length)}╮`);
  FIELDS.forEach((name, i) => {
    const isFocus = state.focus === i;
    const win = scrollWindow(state.values[name], state.cursors[name], VW);
    lines.push(row([{ t: LABELS[i].padEnd(LABEL_W), st: isFocus ? '1;36' : '2' }, { t: win.text }]));
    if (isFocus) cursor = { row: lines.length, col: 3 + LABEL_W + win.col };
    if (name === 'directory' && suggestions.length) {
      const items = suggestions.map((s, k) => (k === state.highlight ? `▸ ${s}` : s));
      const joined = items.join('  ');
      const parts = [{ t: ' '.repeat(LABEL_W) }];
      if (joined.length > VW) parts.push({ t: fit(joined, VW), st: '2' });
      else items.forEach((t, k) => {
        if (k) parts.push({ t: '  ' });
        parts.push({ t, st: k === state.highlight ? '1;36' : '2' });
      });
      lines.push(row(parts));
    }
  });
  lines.push(row([]));
  lines.push(row([{ t: fit(state.status, IW), st: '31' }]));
  lines.push(`╰${'─'.repeat(W - 2)}╯`);
  const hint = suggestions.length
    ? '↑↓ pick · Tab/→ accept · Enter next/create · Esc cancel'
    : '↑↓/Tab move · Enter next/create · Esc cancel';
  lines.push(sgr('2', fit(` ${hint}`, W)));
  return { text: lines.join('\r\n'), cursor };
}
