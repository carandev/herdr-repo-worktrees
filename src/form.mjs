import nodePath from 'node:path';
import { validateBranch } from './slug.mjs';
import { resolveWorktreePath } from './path.mjs';

/** Pure state, reducer and renderer for the "new worktree" form. No I/O. */

export const FIELDS = ['branch', 'base', 'path'];
export const MAX_SUGGESTIONS = 5;
const LABELS = ['Branch', 'Base ref', 'Path'];
const LABEL_W = 11;

export function createForm({ repoName, repoRoot, directory, layout = [], layoutKey, refs = [], pathApi = nodePath }) {
  return {
    repoName, repoRoot, directory, layout, layoutKey, refs, pathApi,
    values: { branch: '', base: '', path: '' },
    cursors: { branch: 0, base: 0, path: 0 },
    focus: 0,
    highlight: -1,
    status: '',
  };
}

export const setStatus = (state, status) => ({ ...state, status });

// --- refs ---------------------------------------------------------------

/**
 * Parses `git for-each-ref --format=%(refname) refs/heads refs/remotes` into
 * `{ name, local }`, dropping symbolic `<remote>/HEAD` entries and bare remote names.
 */
export function parseRefs(stdout) {
  const seen = new Set();
  const refs = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const ref = line.trim();
    let entry;
    if (ref.startsWith('refs/heads/')) {
      entry = { name: ref.slice('refs/heads/'.length), local: true };
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      if (!name.includes('/') || name.endsWith('/HEAD')) continue;
      entry = { name, local: false };
    }
    if (entry?.name && !seen.has(entry.name)) {
      seen.add(entry.name);
      refs.push(entry);
    }
  }
  return refs;
}

/** Up to `limit` names: prefix matches first, then substring matches; locals before remotes. */
export function rankRefs(refs, query, limit = MAX_SUGGESTIONS) {
  const q = String(query ?? '').trim().toLowerCase();
  const ordered = [...refs.filter((r) => r.local), ...refs.filter((r) => !r.local)];
  if (!q) return ordered.slice(0, limit).map((r) => r.name);
  const lower = (r) => r.name.toLowerCase();
  const prefix = ordered.filter((r) => lower(r).startsWith(q));
  const substring = ordered.filter((r) => !lower(r).startsWith(q) && lower(r).includes(q));
  return [...prefix, ...substring].slice(0, limit).map((r) => r.name);
}

/** Suggestions shown under Base ref (only while it is focused). */
export function suggestionsFor(state) {
  if (FIELDS[state.focus] !== 'base') return [];
  const list = rankRefs(state.refs, state.values.base);
  return list.length === 1 && list[0] === state.values.base ? [] : list;
}

// --- derived values -----------------------------------------------------

export function branchError(state) {
  if (!state.values.branch.trim()) return null;
  try {
    validateBranch(state.values.branch);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Absolute default checkout path for the current Branch text, or null when it is not valid. */
export function defaultPath(state) {
  try {
    const branch = validateBranch(state.values.branch);
    return resolveWorktreePath({ repoRoot: state.repoRoot, directory: state.directory, branch, pathApi: state.pathApi });
  } catch {
    return null;
  }
}

export function targetPath(state) {
  const typed = state.values.path.trim();
  return typed ? state.pathApi.resolve(state.repoRoot, typed) : defaultPath(state);
}

/** `{ message, focus }` for the first invalid field, or null. */
function validate(state) {
  if (!state.values.branch.trim()) return { message: 'Branch is required', focus: 0 };
  try {
    validateBranch(state.values.branch);
  } catch (e) {
    return { message: e.message, focus: 0 };
  }
  if (state.values.base.trim()) {
    try {
      validateBranch(state.values.base);
    } catch (e) {
      return { message: `Base ref: ${e.message}`, focus: 1 };
    }
  }
  return null;
}

// --- reducer ------------------------------------------------------------

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
  return state.values.base ? list[0] : undefined;
}

const accept = (state, text) => edited(state, 'base', text, text.length);

function submit(state) {
  const problem = validate(state);
  if (problem) return { state: { ...focused(state, problem.focus), status: problem.message } };
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
      if (target !== undefined && target !== text) return { state: accept(state, target) };
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
      if (target !== undefined && target !== text) return { state: accept(state, target) };
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

// --- rendering ----------------------------------------------------------

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function layoutLine(state) {
  if (!state.layout.length) return 'Layout: none';
  const tabs = 1 + state.layout.slice(1).filter((e) => e.split === undefined).length;
  return `Layout: ${state.layoutKey ?? '?'} · ${plural(tabs, 'tab')}, ${plural(state.layout.length, 'pane')}`;
}

/**
 * `render(state, { columns, color }) -> { text, cursor: { row, col } }` (1-based cursor).
 * Lines are joined with CRLF; with `color: false` no SGR codes are emitted.
 */
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

  const title = fit(`New worktree · ${state.repoName}`, W - 6);
  lines.push(`╭─ ${sgr('1', title)} ${'─'.repeat(W - 5 - title.length)}╮`);

  const suggestions = suggestionsFor(state);
  const bErr = branchError(state);
  const def = defaultPath(state);
  FIELDS.forEach((name, i) => {
    const isFocus = state.focus === i;
    const label = { t: LABELS[i].padEnd(LABEL_W), st: isFocus ? '1;36' : '2' };
    const value = state.values[name];
    const parts = [label];
    if (name === 'path' && !value) {
      if (def) parts.push({ t: fit(state.pathApi.relative(state.repoRoot, def).split(state.pathApi.sep).join('/'), VW), st: '2' });
      if (isFocus) cursor = { row: lines.length + 1, col: 3 + LABEL_W };
    } else {
      const win = scrollWindow(value, state.cursors[name], VW);
      parts.push({ t: win.text });
      if (name === 'branch' && bErr && value.length < VW) {
        const room = VW - value.length - 1;
        if (room >= 10) parts.push({ t: ` ${fit(`✗ ${bErr}`, room)}`, st: '31' });
      }
      if (isFocus) cursor = { row: lines.length + 1, col: 3 + LABEL_W + win.col };
    }
    lines.push(row(parts));
    if (name === 'base' && suggestions.length) {
      const items = suggestions.map((s, k) => (k === state.highlight ? `▸ ${s}` : s));
      const joined = items.join('  ');
      const parts2 = [{ t: ' '.repeat(LABEL_W) }];
      if (joined.length > VW) parts2.push({ t: fit(joined, VW), st: '2' });
      else items.forEach((t, k) => {
        if (k) parts2.push({ t: '  ' });
        parts2.push({ t, st: k === state.highlight ? '1;36' : '2' });
      });
      lines.push(row(parts2));
    }
  });

  lines.push(row([]));
  const target = targetPath(state);
  lines.push(row([{ t: fit(`→ ${target ?? ''}`.trimEnd(), IW), st: '32' }]));
  lines.push(row([{ t: fit(layoutLine(state), IW), st: '2' }]));
  lines.push(row([{ t: fit(state.status, IW), st: '31' }]));
  lines.push(`╰${'─'.repeat(W - 2)}╯`);
  const hint = suggestions.length
    ? '↑↓ pick · Tab/→ accept · Enter next/create · Esc cancel'
    : '↑↓/Tab move · Enter next/create · Esc cancel';
  lines.push(sgr('2', fit(` ${hint}`, W)));
  return { text: lines.join('\r\n'), cursor };
}
