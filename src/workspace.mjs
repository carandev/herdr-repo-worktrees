import nodePath from 'node:path';
import { stripVerbatimPrefix } from './context.mjs';
import { MAX_SUGGESTIONS } from './form.mjs';

/** Pure logic for "new workspace in a chosen directory". I/O goes through injected ports. */

const isObj = (v) => v !== null && typeof v === 'object';
const str = (v) => (typeof v === 'string' && v ? v : undefined);

/**
 * Directory the source workspace is in: its cwd first, then the worktree checkout, then the repo root.
 * Unlike extractContext's startDirs, a linked worktree prefills its own checkout, not the main repo.
 */
export function workspaceSourceDir(ctx) {
  const root = isObj(ctx) ? ctx : {};
  const ws = isObj(root.workspace) ? root.workspace : {};
  const wt = isObj(ws.worktree) ? ws.worktree : isObj(root.worktree) ? root.worktree : {};
  const dir = [ws.cwd, root.cwd, wt.checkout_path, wt.repo_root].map(str).find(Boolean);
  return stripVerbatimPrefix(dir);
}

/**
 * Resolves the typed Directory to an absolute, existing directory.
 * Ports: fs.isDirectory(path) -> boolean. `home` and `pathApi` are injectable.
 */
export async function resolveWorkspaceDir({ input, baseDir, home, fs, pathApi = nodePath }) {
  let typed = stripVerbatimPrefix(String(input ?? '').trim());
  if (!typed) throw new Error('Directory is required');
  if (typed === '~' || /^~[\\/]/.test(typed)) typed = pathApi.join(home, typed.slice(1));
  const resolved = pathApi.resolve(baseDir, typed);
  if (!(await fs.isDirectory(resolved))) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

// --- directory autocomplete ---------------------------------------------


const isWin = (pathApi) => pathApi.sep === '\\';

/** Index of the last path separator in `input` (both `/` and `\` on win32), or -1. */
export function lastSeparatorIndex(input, pathApi = nodePath) {
  const text = String(input ?? '');
  const slash = text.lastIndexOf('/');
  return isWin(pathApi) ? Math.max(slash, text.lastIndexOf('\\')) : slash;
}

/**
 * Splits typed Directory text into the absolute directory to list and the partial last segment.
 * `parentDir` is null when there is nothing sensible to list (empty input or a bare `~`).
 */
export function splitDirectoryInput({ input, baseDir, home, pathApi = nodePath }) {
  const typed = stripVerbatimPrefix(String(input ?? '').trimStart());
  if (!typed || typed === '~') return { parentDir: null, prefix: typed };
  const idx = lastSeparatorIndex(typed, pathApi);
  if (idx < 0) return { parentDir: pathApi.resolve(baseDir), prefix: typed };
  let head = typed.slice(0, idx + 1);
  if (/^~[\\/]/.test(head)) head = pathApi.join(home, head.slice(1));
  return { parentDir: pathApi.resolve(baseDir, head), prefix: typed.slice(idx + 1) };
}

/**
 * Up to `limit` directory names: prefix matches first, then substring matches, each alphabetical.
 * Case-insensitive on win32; dot-directories only when the prefix starts with a dot.
 */
export function rankDirectoryNames(names, prefix, { pathApi = nodePath, limit = MAX_SUGGESTIONS } = {}) {
  const fold = isWin(pathApi) ? (s) => s.toLowerCase() : (s) => s;
  const q = fold(String(prefix ?? ''));
  const visible = names.filter((n) => q.startsWith('.') || !n.startsWith('.'));
  const byName = (a, b) => (fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...visible].sort(byName);
  const starts = sorted.filter((n) => fold(n).startsWith(q));
  const contains = sorted.filter((n) => !fold(n).startsWith(q) && fold(n).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Replaces the last segment of the typed text with `name` plus a trailing separator. */
export function applyDirectorySuggestion({ input, name, pathApi = nodePath }) {
  const text = String(input ?? '');
  return `${text.slice(0, lastSeparatorIndex(text, pathApi) + 1)}${name}${pathApi.sep}`;
}

/** Wraps `readDirs(dir) -> names[]` with a per-directory cache; failures list as empty. */
export function createSubdirLister(readDirs) {
  const cache = new Map();
  return (dir) => {
    if (!cache.has(dir)) {
      cache.set(dir, Promise.resolve().then(() => readDirs(dir)).then((names) => names ?? [], () => []));
    }
    return cache.get(dir);
  };
}

export function buildWorkspaceCreateArgs({ cwd, label }) {
  const args = ['workspace', 'create', '--cwd', cwd, '--focus'];
  const text = String(label ?? '').trim();
  if (text) args.push('--label', text);
  return args;
}

/** Ports: fs {isDirectory}, herdr(args) -> {stdout}. Failures carry herdr's own message. */
export async function executeWorkspaceCreate({ input, label, baseDir, home, fs, herdr, pathApi = nodePath }) {
  const cwd = await resolveWorkspaceDir({ input, baseDir, home, fs, pathApi });
  try {
    const { stdout } = await herdr(buildWorkspaceCreateArgs({ cwd, label }));
    return { cwd, output: stdout };
  } catch (e) {
    const detail = [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).find(Boolean) ?? e.message;
    throw new Error(`herdr workspace create failed: ${detail}`);
  }
}
