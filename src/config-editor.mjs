/**
 * Pure state, reducer and renderer for the interactive config editor. No I/O.
 * Views form a stack: main (directories and projects) > project (name, directory, layout) > entry.
 * List mode moves a selection; Enter on a text row opens a one-line editor for it.
 */

import nodePath from 'node:path';
import { DEFAULT_DIRECTORY } from './config.mjs';
import {
  WILDCARD,
  addEntry,
  addProject,
  describeEntry,
  describeProject,
  entryTitle,
  getLayout,
  getProject,
  moveEntry,
  projectKeys,
  removeEntry,
  removeProject,
  renameProject,
  serializeConfig,
  setDirectory,
  setEntryField,
  setProjectDirectory,
  setRepoDirectory,
  validateDraft,
} from './config-edit.mjs';

const LABEL_W = 18;
const SPLITS = ['tab', 'right', 'down'];

/**
 * `files`: `{ userFile, repoFile? }` paths shown to the user and used in error messages.
 * `draft`: `{ user, repo }` parsed objects (`repo` null outside a repository).
 * `saved`: the serialized text currently on disk per file (null when the file does not exist).
 */
export function createEditor({ draft, files, repoRoot, saved, pathApi = nodePath }) {
  const state = {
    draft,
    files,
    repoRoot,
    pathApi,
    saved: { ...saved },
    stack: [{ view: 'main', sel: 0 }],
    edit: null,
    pick: null,
    pending: null,
    status: '',
    error: '',
  };
  return { ...state, error: validateDraft(draft, validationContext(state)) };
}

const validationContext = (state) => ({
  userFile: state.files.userFile,
  repoFile: state.files.repoFile,
  repoRoot: state.repoRoot,
  pathApi: state.pathApi,
});

const top = (state) => state.stack[state.stack.length - 1];

/** Text of each file that would be written now; a missing repo file is only written once it has content. */
function texts(state) {
  const out = { user: serializeConfig(state.draft.user) };
  if (state.draft.repo !== null) {
    const empty = !Object.keys(state.draft.repo).length;
    out.repo = empty && state.saved.repo == null ? null : serializeConfig(state.draft.repo);
  }
  return out;
}

/** Files whose content differs from what was loaded or last saved: `[{ which, file, text }]`. */
export function pendingWrites(state) {
  const now = texts(state);
  const writes = [];
  if (now.user !== state.saved.user) writes.push({ which: 'user', file: state.files.userFile, text: now.user });
  if (state.draft.repo !== null && now.repo !== null && now.repo !== state.saved.repo) {
    writes.push({ which: 'repo', file: state.files.repoFile, text: now.repo });
  }
  return writes;
}

export const isDirty = (state) => pendingWrites(state).length > 0;

/** Records a successful save of `writes` (from `pendingWrites`). */
export function markSaved(state, writes) {
  const saved = { ...state.saved };
  for (const w of writes) saved[w.which] = w.text;
  return { ...state, saved, status: 'Saved', pending: null };
}

export const setStatus = (state, status) => ({ ...state, status });

const projectTitle = (key) => (key === WILDCARD ? '* (every other repository)' : key);

/**
 * Rows of the current view. Kinds: `heading` (not selectable), `text` (editable value),
 * `choice` (cycles through `options`), `link` (opens a view or adds an item).
 */
export function rowsFor(state) {
  const view = top(state);
  const { draft } = state;
  if (view.view === 'main') {
    const rows = [
      { kind: 'text', id: 'directory', label: 'Default directory', value: draft.user.directory ?? '', placeholder: DEFAULT_DIRECTORY },
    ];
    if (draft.repo !== null) {
      rows.push({ kind: 'text', id: 'repoDirectory', label: 'This repository', value: draft.repo.directory ?? '', placeholder: 'not set' });
    }
    rows.push({ kind: 'heading', label: 'Projects' });
    for (const key of projectKeys(draft)) {
      rows.push({ kind: 'link', id: 'project', key, label: projectTitle(key), detail: describeProject(getProject(draft, key)) });
    }
    rows.push({ kind: 'link', id: 'addProject', label: '+ Add project' });
    return rows;
  }
  if (view.view === 'project') {
    const project = getProject(draft, view.key);
    const rows = [
      { kind: 'text', id: 'name', label: 'Name', value: view.key },
      { kind: 'text', id: 'projectDirectory', label: 'Directory', value: project.directory ?? '', placeholder: 'inherits default' },
      { kind: 'heading', label: 'Layout' },
    ];
    getLayout(draft, view.key).forEach((entry, i) => {
      rows.push({ kind: 'link', id: 'entry', index: i, label: String(i), detail: describeEntry(entry, i) });
    });
    rows.push({ kind: 'link', id: 'addEntry', label: '+ Add entry' });
    return rows;
  }
  const layout = getLayout(draft, view.key);
  const entry = layout[view.index] ?? {};
  const i = view.index;
  // "Opens as" comes first: changing it adds or removes rows, and none of them may shift it.
  const rows = [];
  if (i > 0) rows.push({ kind: 'choice', id: 'split', label: 'Opens as', value: entry.split ?? 'tab', options: SPLITS });
  rows.push({ kind: 'text', id: 'command', label: 'Command', value: entry.command ?? '', placeholder: 'plain shell' });
  if (i === 0 || entry.split === undefined) {
    rows.push({ kind: 'text', id: 'label', label: 'Tab label', value: entry.label ?? '', placeholder: 'none' });
  }
  rows.push({ kind: 'text', id: 'cwd', label: 'Cwd', value: entry.cwd ?? '', placeholder: 'worktree root' });
  if (i > 0 && entry.split !== undefined) {
    rows.push({ kind: 'text', id: 'ratio', label: 'Ratio', value: entry.ratio === undefined ? '' : String(entry.ratio), placeholder: 'herdr default' });
    const options = layout.slice(0, i).map((_, j) => ({ value: j, label: `${j} · ${entryTitle(layout, j)}` }));
    const from = Number.isInteger(entry.from) ? entry.from : i - 1;
    rows.push({ kind: 'pick', id: 'from', label: 'Split from', value: from, options });
  }
  return rows;
}

const selectable = (rows) => rows.map((r, i) => (r.kind === 'heading' ? -1 : i)).filter((i) => i >= 0);

/** Index of the selected row, clamped to the selectable rows of the current view. */
export function selectedIndex(state) {
  const options = selectable(rowsFor(state));
  const sel = top(state).sel;
  return options.includes(sel) ? sel : options.reduce((best, i) => (i <= sel ? i : best), options[0]);
}

const withTop = (state, patch) => ({ ...state, stack: [...state.stack.slice(0, -1), { ...top(state), ...patch }] });

function moveSelection(state, delta) {
  const options = selectable(rowsFor(state));
  const at = options.indexOf(selectedIndex(state));
  const next = options[Math.max(0, Math.min(options.length - 1, at + delta))];
  return withTop(state, { sel: next });
}

/** Applies a draft change, revalidates and clears transient messages. */
function changed(state, draft) {
  const next = { ...state, draft, pending: null, status: '' };
  return { ...next, error: validateDraft(draft, validationContext(next)) };
}

const push = (state, view) => ({ ...state, stack: [...state.stack, { ...view, sel: 0 }], pending: null, status: '' });
const pop = (state) => ({ ...state, stack: state.stack.slice(0, -1), pending: null, status: '' });

function startEdit(state, row, text = row.value) {
  return { ...state, edit: { id: row.id, text, cursor: text.length }, pending: null, status: '' };
}

/** Commits the open text edit to the draft; on an invalid value the editor stays open with the error. */
function commitEdit(state) {
  const { id, text } = state.edit;
  const view = top(state);
  const { draft } = state;
  let next;
  try {
    switch (id) {
      case 'directory':
        return { state: { ...changed(state, setDirectory(draft, text)), edit: null } };
      case 'repoDirectory':
        return { state: { ...changed(state, setRepoDirectory(draft, text)), edit: null } };
      case 'newProject': {
        const key = text.trim();
        next = { ...changed(state, addProject(draft, key)), edit: null };
        next = withTop(next, { sel: rowsFor(next).findIndex((r) => r.id === 'project' && r.key === key) });
        return { state: push(next, { view: 'project', key }) };
      }
      case 'name': {
        const key = text.trim();
        return { state: withTop({ ...changed(state, renameProject(draft, view.key, key)), edit: null }, { key }) };
      }
      case 'projectDirectory':
        return { state: { ...changed(state, setProjectDirectory(draft, view.key, text)), edit: null } };
      default:
        return { state: { ...changed(state, setEntryField(draft, view.key, view.index, id, text)), edit: null } };
    }
  } catch (e) {
    return { state: { ...state, status: e.message } };
  }
}

/** One-line text editor keys while `state.edit` is open. */
function updateEdit(state, key) {
  const { text, cursor: cur } = state.edit;
  const set = (t, c) => ({ state: { ...state, edit: { ...state.edit, text: t, cursor: c }, status: '' } });
  switch (key.name) {
    case 'char':
      return set(text.slice(0, cur) + key.ch + text.slice(cur), cur + key.ch.length);
    case 'backspace':
      return cur > 0 ? set(text.slice(0, cur - 1) + text.slice(cur), cur - 1) : { state };
    case 'delete':
      return cur < text.length ? set(text.slice(0, cur) + text.slice(cur + 1), cur) : { state };
    case 'ctrl-u':
      return set('', 0);
    case 'left':
      return set(text, Math.max(0, cur - 1));
    case 'right':
      return set(text, Math.min(text.length, cur + 1));
    case 'home':
    case 'ctrl-a':
      return set(text, 0);
    case 'end':
    case 'ctrl-e':
      return set(text, text.length);
    case 'enter':
    case 'tab':
      return commitEdit(state);
    case 'escape':
    case 'ctrl-c':
      return { state: { ...state, edit: null, status: '' } };
    default:
      return { state };
  }
}

const optionValue = (o) => (typeof o === 'object' ? o.value : o);

/** Keeps the selection on the row `id` after the rows of the view changed. */
function reselect(state, id) {
  const index = rowsFor(state).findIndex((r) => r.id === id);
  return index < 0 ? state : withTop(state, { sel: index });
}

/** Sets a choice or pick row; picking the previous entry as `from` removes the key (it is the default). */
function choose(state, row, value) {
  const view = top(state);
  const text = row.id === 'from' ? (value === view.index - 1 ? '' : String(value)) : value;
  return reselect(changed(state, setEntryField(state.draft, view.key, view.index, row.id, text)), row.id);
}

function cycle(state, row, delta) {
  const values = row.options.map(optionValue);
  return choose(state, row, values[(values.indexOf(row.value) + delta + values.length) % values.length]);
}

/** Opens the vertical option list of a pick row with the current value highlighted. */
const openPick = (state, row) => ({
  ...state,
  pick: { id: row.id, index: Math.max(0, row.options.findIndex((o) => o.value === row.value)) },
  pending: null,
  status: '',
});

function updatePick(state, key, row) {
  const n = row.options.length;
  const to = (index) => ({ state: { ...state, pick: { ...state.pick, index } } });
  switch (key.name) {
    case 'up':
    case 'shift-tab':
      return to(Math.max(0, state.pick.index - 1));
    case 'down':
    case 'tab':
      return to(Math.min(n - 1, state.pick.index + 1));
    case 'char':
      if (key.ch === 'k') return to(Math.max(0, state.pick.index - 1));
      if (key.ch === 'j') return to(Math.min(n - 1, state.pick.index + 1));
      return { state };
    case 'home':
      return to(0);
    case 'end':
      return to(n - 1);
    case 'enter':
      return { state: choose({ ...state, pick: null }, row, row.options[state.pick.index].value) };
    case 'escape':
    case 'ctrl-c':
      return { state: { ...state, pick: null } };
    default:
      return { state };
  }
}

function activate(state, row) {
  switch (row.kind) {
    case 'text':
      return startEdit(state, row);
    case 'choice':
      return cycle(state, row, 1);
    case 'pick':
      return openPick(state, row);
    default:
      break;
  }
  if (row.id === 'project') return push(state, { view: 'project', key: row.key });
  if (row.id === 'entry') return push(state, { view: 'entry', key: top(state).key, index: row.index });
  if (row.id === 'addProject') {
    return startEdit(state, { id: 'newProject', value: '' });
  }
  if (row.id === 'addEntry') {
    const view = top(state);
    const next = changed(state, addEntry(state.draft, view.key));
    const index = getLayout(next.draft, view.key).length - 1;
    return push(next, { view: 'entry', key: view.key, index });
  }
  return state;
}

/** `d` asks for confirmation; a second `d` on the same row deletes it. */
function remove(state, row) {
  const target = row.id === 'project' ? `project:${row.key}` : row.id === 'entry' ? `entry:${row.index}` : null;
  if (!target) return state;
  if (state.pending !== target) {
    const what = row.id === 'project' ? `project "${row.key}"` : `entry ${row.index}`;
    return { ...state, pending: target, status: `Press d again to delete ${what}` };
  }
  const view = top(state);
  const draft = row.id === 'project' ? removeProject(state.draft, row.key) : removeEntry(state.draft, view.key, row.index);
  return { ...changed(state, draft), status: 'Deleted' };
}

function move(state, row, delta) {
  if (row.id !== 'entry') return state;
  const view = top(state);
  const draft = moveEntry(state.draft, view.key, row.index, delta);
  if (draft === state.draft) return state;
  return moveSelection(changed(state, draft), delta);
}

/** Leaving the editor with unsaved changes needs a second press. */
function quit(state) {
  if (!isDirty(state) || state.pending === 'quit') return { state, effect: 'quit' };
  return { state: { ...state, pending: 'quit', status: 'Unsaved changes: Ctrl+S saves, press again to discard' } };
}

function save(state) {
  if (state.error) return { state: { ...state, status: 'Fix the error before saving' } };
  if (!isDirty(state)) return { state: { ...state, status: 'No changes' } };
  return { state: { ...state, pending: null }, effect: 'save' };
}

/** `update(state, key) -> { state, effect? }`; effect is 'save' or 'quit'. */
export function update(state, key) {
  if (state.edit) return updateEdit(state, key);
  const rows = rowsFor(state);
  const row = rows[selectedIndex(state)];
  if (state.pick) return updatePick(state, key, row);
  const cycles = row.kind === 'choice' || row.kind === 'pick';
  switch (key.name) {
    case 'up':
    case 'shift-tab':
      return { state: moveSelection({ ...state, pending: null }, -1) };
    case 'down':
    case 'tab':
      return { state: moveSelection({ ...state, pending: null }, 1) };
    case 'home':
      return { state: withTop(state, { sel: 0 }) };
    case 'end':
      return { state: withTop(state, { sel: rows.length - 1 }) };
    case 'enter':
      return { state: activate(state, row) };
    case 'left':
    case 'right':
      return { state: cycles ? cycle(state, row, key.name === 'left' ? -1 : 1) : state };
    case 'delete':
      return { state: remove(state, row) };
    case 'ctrl-s':
      return save(state);
    case 'escape':
      return state.stack.length > 1 ? { state: pop(state) } : quit(state);
    case 'ctrl-c':
      return quit(state);
    case 'char':
      switch (key.ch) {
        case 'j':
          return { state: moveSelection({ ...state, pending: null }, 1) };
        case 'k':
          return { state: moveSelection({ ...state, pending: null }, -1) };
        case 'J':
          return { state: move(state, row, 1) };
        case 'K':
          return { state: move(state, row, -1) };
        case 'd':
          return { state: remove(state, row) };
        case 'a': {
          const add = rows.find((r) => r.id === 'addProject' || r.id === 'addEntry');
          return { state: add ? activate(state, add) : state };
        }
        case 'q':
          return quit(state);
        case ' ':
          return { state: cycles ? cycle(state, row, 1) : state };
        default:
          return { state };
      }
    default:
      return { state };
  }
}

const fit = (s, n) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Like `fit`, but keeps the end (file names are at the end of a path). */
const fitEnd = (s, n) => (n <= 0 ? '' : s.length > n ? `…${s.slice(s.length - n + 1)}` : s);

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

function breadcrumb(state) {
  const parts = ['Worktree config'];
  for (const v of state.stack.slice(1)) {
    parts.push(v.view === 'project' ? projectTitle(v.key) : `entry ${v.index}`);
  }
  return parts.join(' › ');
}

const HINTS = {
  main: '↑↓ move · Enter open/edit · a add · d delete · Ctrl+S save · Esc quit',
  project: '↑↓ move · Enter open/edit · a add entry · d delete · J/K reorder · Ctrl+S save · Esc back',
  entry: '↑↓ move · Enter edit/choose · ←→ change · Ctrl+S save · Esc back',
  pick: '↑↓ choose · Enter apply · Esc cancel',
};

/**
 * `render(state, { columns, rows, color }) -> { text, cursor }`; `cursor` is `{ row, col }` (1-based)
 * while a text edit is open, otherwise null (the caller hides the terminal cursor).
 */
export function render(state, { columns = 80, rows: height = 24, color = true } = {}) {
  const W = Math.max(40, columns - 1);
  const IW = W - 4;
  const VW = IW - LABEL_W - 2;
  const sgr = (code, t) => (color && t ? `\x1b[${code}m${t}\x1b[0m` : t);
  const line = (parts) => {
    const used = parts.reduce((n, p) => n + p.t.length, 0);
    return `│ ${parts.map((p) => (p.st ? sgr(p.st, p.t) : p.t)).join('')}${' '.repeat(Math.max(0, IW - used))} │`;
  };
  const rows = rowsFor(state);
  const sel = selectedIndex(state);
  const view = top(state);
  const editingNew = state.edit?.id === 'newProject';
  let items = editingNew ? [...rows.slice(0, -1), { kind: 'text', id: 'newProject', label: 'New project', value: '' }] : rows;
  let selRow = editingNew ? items.length - 1 : sel;
  if (state.pick) {
    // The open pick list is drawn as extra rows under its field; the highlighted option is "selected".
    const options = rows[sel].options.map((o, k) => ({ kind: 'option', label: o.label, current: o.value === rows[sel].value, k }));
    items = [...rows.slice(0, sel + 1), ...options, ...rows.slice(sel + 1)];
    selRow = sel + 1 + state.pick.index;
  }

  // Box chrome: title, file line, blank, two error lines, status, bottom border, hint.
  const visible = Math.max(3, height - 8);
  const offset = Math.max(0, Math.min(selRow - visible + 1, items.length - visible));
  const lines = [];
  let cursor = null;

  const title = fit(breadcrumb(state) + (isDirty(state) ? ' *' : ''), W - 6);
  lines.push(`╭─ ${sgr('1', title)} ${'─'.repeat(Math.max(0, W - 5 - title.length))}╮`);
  const file = view.view === 'main' ? state.files.userFile : `projects["${view.key}"] in ${state.files.userFile}`;
  lines.push(line([{ t: fitEnd(file, IW), st: '2' }]));
  lines.push(line([]));
  items.slice(offset, offset + visible).forEach((row, k) => {
    const i = offset + k;
    const isSel = i === selRow;
    const isOwner = state.pick && i === sel;
    const mark = isSel ? '▸ ' : '  ';
    if (row.kind === 'heading') {
      lines.push(line([{ t: '  ' }, { t: fit(row.label, IW - 2), st: '1' }]));
      return;
    }
    if (row.kind === 'option') {
      const text = `${isSel ? '▸ ' : '  '}${row.label}${row.current ? '  (current)' : ''}`;
      lines.push(line([{ t: ' '.repeat(LABEL_W + 2) }, { t: fit(text, VW), st: isSel ? '1;36' : '2' }]));
      return;
    }
    if (row.kind === 'link') {
      const label = row.detail === undefined ? row.label : `${row.label} `.padEnd(row.id === 'entry' ? 3 : LABEL_W);
      const detail = row.detail === undefined ? '' : fit(row.detail, IW - 2 - label.length);
      lines.push(line([{ t: mark, st: '36' }, { t: label, st: isSel ? '1;36' : '' }, { t: detail, st: '2' }]));
      return;
    }
    const label = fit(row.label, LABEL_W - 1).padEnd(LABEL_W);
    if (state.edit && isSel) {
      const win = scrollWindow(state.edit.text, state.edit.cursor, VW);
      lines.push(line([{ t: mark, st: '36' }, { t: label, st: '1;36' }, { t: win.text, st: '4' }]));
      cursor = { row: lines.length, col: 5 + LABEL_W + win.col };
      return;
    }
    let value = row.value;
    if (row.kind === 'choice') value = row.options.map((o) => (o === row.value ? `[${o}]` : ` ${o} `)).join(' ');
    if (row.kind === 'pick') value = `${row.options.find((o) => o.value === row.value)?.label ?? row.value} ▾`;
    const shown = value ? { t: fit(value, VW) } : { t: fit(row.placeholder ?? '', VW), st: '2' };
    const active = isSel || isOwner;
    lines.push(line([{ t: active ? '▸ ' : '  ', st: '36' }, { t: label, st: active ? '1;36' : '2' }, shown]));
  });
  while (lines.length < 3 + visible) lines.push(line([]));
  // Errors wrap onto a second line: the useful part (what is wrong) usually comes last.
  lines.push(line([{ t: state.error.slice(0, IW), st: '31' }]));
  lines.push(line([{ t: fit(state.error.slice(IW), IW), st: '31' }]));
  lines.push(line([{ t: fit(state.status, IW), st: state.status === 'Saved' ? '32' : '33' }]));
  lines.push(`╰${'─'.repeat(W - 2)}╯`);
  const hint = state.edit ? 'Enter/Tab apply · Esc cancel · Ctrl+U clear' : HINTS[state.pick ? 'pick' : view.view];
  lines.push(sgr('2', fit(` ${hint}`, W)));
  return { text: lines.join('\r\n'), cursor };
}
