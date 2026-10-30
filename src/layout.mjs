import nodePath from 'node:path';

/** Pure argv builders for the herdr CLI calls used by layouts. */
export const buildPaneListArgs = (workspaceId) => ['pane', 'list', '--workspace', workspaceId];

export function buildSplitArgs({ paneId, direction, cwd, ratio }) {
  const args = ['pane', 'split', paneId, '--direction', direction, '--cwd', cwd];
  if (ratio !== undefined) args.push('--ratio', String(ratio));
  args.push('--no-focus');
  return args;
}

export function buildTabCreateArgs({ workspaceId, cwd, label }) {
  const args = ['tab', 'create', '--workspace', workspaceId, '--cwd', cwd];
  if (label) args.push('--label', label);
  return args;
}

/** `label` is a single argv element. */
export const buildTabRenameArgs = (tabId, label) => ['tab', 'rename', tabId, label];

/** `command` is a single argv element: herdr types it into the pane's shell and presses Enter. */
export const buildRunArgs = (paneId, command) => ['pane', 'run', paneId, command];

function parseJson(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse ${what} output as JSON`);
  }
}

/** Workspace id from `herdr worktree create` stdout (`result.workspace.workspace_id`). */
export function parseWorkspaceId(stdout) {
  const id = parseJson(stdout, 'worktree create')?.result?.workspace?.workspace_id;
  if (typeof id !== 'string' || !id) throw new Error('worktree create output has no workspace id');
  return id;
}

/** Root pane and its tab: the focused pane if any, else the first one. */
export function parseRootPane(stdout) {
  const panes = parseJson(stdout, 'pane list')?.result?.panes;
  const usable = Array.isArray(panes) ? panes.filter((p) => p && typeof p.pane_id === 'string' && p.pane_id) : [];
  const pane = usable.find((p) => p.focused) ?? usable[0];
  if (!pane) throw new Error('pane list returned no panes');
  return { paneId: pane.pane_id, tabId: typeof pane.tab_id === 'string' && pane.tab_id ? pane.tab_id : undefined };
}

export const parseRootPaneId = (stdout) => parseRootPane(stdout).paneId;

export function parseSplitPaneId(stdout) {
  const id = parseJson(stdout, 'pane split')?.result?.pane?.pane_id;
  if (typeof id !== 'string' || !id) throw new Error('pane split output has no pane id');
  return id;
}

/** Root pane of a freshly created tab (`result.root_pane.pane_id`). */
export function parseTabRootPaneId(stdout) {
  const id = parseJson(stdout, 'tab create')?.result?.root_pane?.pane_id;
  if (typeof id !== 'string' || !id) throw new Error('tab create output has no root pane id');
  return id;
}

/** Absolute cwd for each entry (worktree root when unset), re-checked to stay inside the worktree. */
export function resolveLayoutCwds({ layout, worktreePath, pathApi = nodePath }) {
  const root = pathApi.resolve(worktreePath);
  return layout.map((e) => {
    if (!e.cwd) return root;
    const abs = pathApi.resolve(root, e.cwd);
    const rel = pathApi.relative(root, abs);
    if (rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) {
      throw new Error(`Layout cwd escapes the worktree: ${e.cwd}`);
    }
    return abs;
  });
}

/**
 * Applies a validated layout (entries without `split` open a new tab) to a worktree's workspace.
 * The workspace is `workspaceId`, else the one in `createOutput` (`herdr worktree create|open` stdout).
 * Ports: herdr(args) -> {stdout}, fs {isDirectory(path) -> boolean}.
 * Returns { paneIds } (index-aligned with `layout`).
 */
export async function applyLayout({ layout, worktreePath, createOutput, workspaceId: givenId, herdr, fs, pathApi = nodePath }) {
  const workspaceId = givenId ?? parseWorkspaceId(createOutput);
  const cwds = resolveLayoutCwds({ layout, worktreePath, pathApi });
  for (let i = 0; i < cwds.length; i += 1) {
    if (!(await fs.isDirectory(cwds[i]))) throw new Error(`Layout entry ${i} cwd does not exist: ${cwds[i]}`);
  }
  const root = pathApi.resolve(worktreePath);
  const { paneId: rootId, tabId: rootTabId } = parseRootPane((await herdr(buildPaneListArgs(workspaceId))).stdout);
  if (layout[0].label && !rootTabId) throw new Error('Cannot label the root tab: pane list returned no tab_id');
  const paneIds = [rootId];
  if (layout[0].label) await herdr(buildTabRenameArgs(rootTabId, layout[0].label));
  if (cwds[0] !== root) await herdr(buildRunArgs(rootId, `cd "${cwds[0]}"`));
  if (layout[0].command) await herdr(buildRunArgs(rootId, layout[0].command));
  for (let i = 1; i < layout.length; i += 1) {
    const e = layout[i];
    let id;
    if (e.split === undefined) {
      id = parseTabRootPaneId((await herdr(buildTabCreateArgs({ workspaceId, cwd: cwds[i], label: e.label }))).stdout);
    } else {
      const split = await herdr(buildSplitArgs({ paneId: paneIds[e.from], direction: e.split, cwd: cwds[i], ratio: e.ratio }));
      id = parseSplitPaneId(split.stdout);
    }
    paneIds.push(id);
    if (e.command) await herdr(buildRunArgs(id, e.command));
  }
  return { paneIds };
}
