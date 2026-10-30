import nodePath from 'node:path';
import { applyLayout } from './layout.mjs';
import { stripVerbatimPrefix } from './context.mjs';

/** Pure logic for opening an existing worktree and (re)applying a layout. I/O goes through injected ports. */

const str = (v) => (typeof v === 'string' && v ? v : undefined);

export const buildWorktreeListArgs = (repoRoot) => ['worktree', 'list', '--cwd', repoRoot];

export const buildWorktreeOpenArgs = ({ repoRoot, worktreePath }) =>
  ['worktree', 'open', '--cwd', repoRoot, '--path', worktreePath, '--focus'];

function parseJson(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse ${what} output as JSON`);
  }
}

/**
 * Worktrees from `herdr worktree list` stdout, without bare or prunable ones.
 * Items: { path, branch?, linked, openWorkspaceId? }.
 */
export function parseWorktreeList(stdout, { pathApi = nodePath } = {}) {
  const list = parseJson(stdout, 'worktree list')?.result?.worktrees;
  if (!Array.isArray(list)) return [];
  return list
    .filter((w) => w && str(w.path) && !w.is_bare && !w.is_prunable)
    .map((w) => ({
      path: pathApi.resolve(stripVerbatimPrefix(w.path)),
      branch: str(w.branch),
      linked: Boolean(w.is_linked_worktree),
      openWorkspaceId: str(w.open_workspace_id),
    }));
}

/** Items whose branch or path contains `query` (case-insensitive); order is kept. */
export function filterWorktrees(items, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => [i.branch, i.path].some((s) => s?.toLowerCase().includes(q)));
}

const herdrDetail = (e) => [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).find(Boolean) ?? e.message;

/**
 * Opens (and focuses) an existing worktree. The layout is applied only when Herdr opened a new
 * workspace; an already open one is just focused. A layout failure is reported, never thrown.
 * Ports: herdr(args) -> {stdout}, fs {isDirectory}.
 */
export async function executeOpenWorktree({ repoRoot, worktreePath, layout, herdr, fs, pathApi = nodePath }) {
  let stdout;
  try {
    ({ stdout } = await herdr(buildWorktreeOpenArgs({ repoRoot, worktreePath })));
  } catch (e) {
    throw new Error(`herdr worktree open failed: ${herdrDetail(e)}`);
  }
  const opened = parseJson(stdout, 'worktree open')?.result ?? {};
  const result = { worktreePath, workspaceId: str(opened.workspace?.workspace_id), alreadyOpen: opened.already_open === true };
  if (!result.alreadyOpen && layout?.length) {
    try {
      const { paneIds } = await applyLayout({ layout, worktreePath, createOutput: stdout, herdr, fs, pathApi });
      result.layoutPaneIds = paneIds;
    } catch (e) {
      result.layoutError = e.message;
    }
  }
  return result;
}

/**
 * Applies `layout` to an already open workspace rooted at `worktreePath`.
 * A workspace with more than one tab is treated as already laid out and left untouched.
 */
export async function executeApplyLayout({ layout, worktreePath, workspaceId, herdr, fs, pathApi = nodePath }) {
  if (!layout?.length) throw new Error('No layout configured for this repository');
  if (!workspaceId) throw new Error('Could not determine the current workspace');
  const tabCount = parseJson((await herdr(['workspace', 'get', workspaceId])).stdout, 'workspace get')
    ?.result?.workspace?.tab_count;
  if (!Number.isInteger(tabCount)) throw new Error(`Could not read the tab count of workspace ${workspaceId}`);
  if (tabCount > 1) throw new Error(`Workspace already has ${tabCount} tabs; layout not applied`);
  return applyLayout({ layout, worktreePath, workspaceId, herdr, fs, pathApi });
}
